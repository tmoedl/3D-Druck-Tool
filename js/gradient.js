// Farbverlauf zwischen zwei Filamenten über das Modell. Bemalt wird pro Dreieck;
// Zwischentöne entstehen durch ein Raster (wie beim Zeitungsdruck) mit einstellbarer Körnung.

export const PATTERNS = {
  dither: 'Raster (gleichmäßig)',
  noise: 'Rauschen (zufällig)',
  stripes: 'Streifen quer zum Verlauf',
};
export const CURVES = {
  linear: 'linear',
  smooth: 'weich (S-Kurve)',
  early: 'schnell beginnend',
  late: 'langsam beginnend',
};

// 8x8-Bayer-Matrix (rekursiv aus 2x2), Schwellen in (0,1)
const BAYER = (() => {
  let m = [[0, 2], [3, 1]];
  while (m.length < 8) {
    const n = m.length, r = [];
    for (let y = 0; y < 2 * n; y++) {
      r.push([]);
      for (let x = 0; x < 2 * n; x++) r[y].push(4 * m[y % n][x % n] + [[0, 2], [3, 1]][(y / n) | 0][(x / n) | 0]);
    }
    m = r;
  }
  return Float32Array.from(m.flat(), (v) => (v + 0.5) / 64);
})();

function hash3(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function curve(kind, t) {
  switch (kind) {
    case 'smooth': return t * t * (3 - 2 * t);
    case 'early': return 1 - (1 - t) * (1 - t);
    case 'late': return t * t;
    default: return t;
  }
}

// Orthonormale Achsen: d = Verlaufsrichtung, u/v senkrecht dazu
export function axes(dir) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / l, dir[1] / l, dir[2] / l];
  const h = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [h[1] * d[2] - h[2] * d[1], h[2] * d[0] - h[0] * d[2], h[0] * d[1] - h[1] * d[0]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  u = u.map((x) => x / lu);
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return { d, u, v };
}

// Ausdehnung des Modells entlang der Richtung d
export function extent(paint, d) {
  const V = paint.verts;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    const s = V[i] * d[0] + V[i + 1] * d[1] + V[i + 2] * d[2];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return [lo, hi];
}

// Anteil von Farbe B an der Position s (0..1)
export function amountAt(o, s) {
  const t = o.s1 > o.s0 ? (s - o.s0) / (o.s1 - o.s0) : s >= o.s0 ? 1 : 0;
  return curve(o.curve, Math.min(1, Math.max(0, t)));
}

// o: {a, b, dir, s0, s1, grain, pattern, curve, only (-1 = alle), base (Ausgangsfarben)}
// Schreibt paint.col, liefert die Zahl geänderter Dreiecke.
export function applyGradient(paint, o) {
  const { d, u, v } = axes(o.dir);
  const g = Math.max(0.01, o.grain);
  const C = paint.cen, N = paint.fn, col = paint.col, base = o.base || col;
  let changed = 0;
  for (let t = 0; t < paint.n; t++) {
    if (o.only >= 0 && base[t] !== o.only) continue;
    const x = C[3 * t], y = C[3 * t + 1], z = C[3 * t + 2];
    const s = x * d[0] + y * d[1] + z * d[2];
    const p = amountAt(o, s);
    let thr;
    if (p <= 0) thr = 1;
    else if (p >= 1) thr = 0;
    else if (o.pattern === 'stripes') {
      const f = s / g;
      thr = f - Math.floor(f);
    } else {
      const iu = Math.floor((x * u[0] + y * u[1] + z * u[2]) / g);
      const iv = Math.floor((x * v[0] + y * v[1] + z * v[2]) / g);
      const iw = Math.floor(s / g);
      if (o.pattern === 'noise') thr = hash3(iu, iv, iw);
      else {
        // Raster in der Ebene, die zur Fläche passt (sonst entstehen Streifen auf schrägen Seiten)
        const nx = N[3 * t], ny = N[3 * t + 1], nz = N[3 * t + 2];
        const au = Math.abs(nx * u[0] + ny * u[1] + nz * u[2]), av = Math.abs(nx * v[0] + ny * v[1] + nz * v[2]), ad = Math.abs(nx * d[0] + ny * d[1] + nz * d[2]);
        const [p1, p2] = ad >= au && ad >= av ? [iu, iv] : au >= av ? [iv, iw] : [iu, iw];
        thr = BAYER[(p2 & 7) * 8 + (p1 & 7)];
      }
    }
    const c = p > thr ? o.b : o.a;
    if (col[t] !== c) { col[t] = c; changed++; }
  }
  return changed;
}

// Kantenfilter fürs Unterteilen: nur Kanten im Übergangsbereich (plus eine Körnung Rand)
export function zoneFilter(o) {
  const { d } = axes(o.dir);
  const lo = Math.min(o.s0, o.s1) - o.grain, hi = Math.max(o.s0, o.s1) + o.grain;
  return (ax, ay, az, bx, by, bz) => {
    const sa = ax * d[0] + ay * d[1] + az * d[2], sb = bx * d[0] + by * d[1] + bz * d[2];
    return Math.max(sa, sb) >= lo && Math.min(sa, sb) <= hi;
  };
}