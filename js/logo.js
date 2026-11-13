// Logo / Schild: Relief aus einem farbreduzierten Bild mit Profilen pro Farbe oder
// Bereich (flach, Fase, abgerundet, Kissen, Kontur), Grundplatte in frei wählbarer
// Form (auch dem Inhalt folgend) und Rahmen mit verschiedenen Profilen.
// Reines JS ohne three.js – damit auch ohne 3D-Ansicht testbar.

import { TRANSPARENT, labelAt } from './image.js';

const SQRT2 = Math.SQRT2;
const UNIT = 100; // Höhen intern in 1/100 mm (ganzzahlig -> exakte Vergleiche)

// ---------------------------------------------------------------- Profile
// Inhalt: Anteil 0..1 der eingestellten Höhe abhängig vom Abstand zum Rand des Bereichs
export const CONTENT_PROFILES = {
  flat: 'flach',
  chamfer: 'Fase',
  round: 'abgerundet',
  pillow: 'Kissen (gewölbt)',
  outline: 'nur Kontur',
};

function contentProfile(kind, dist, maxDist, size) {
  switch (kind) {
    case 'chamfer': return size > 0 ? Math.min(1, dist / size) : 1;
    case 'round': {
      if (!(size > 0)) return 1;
      const x = Math.min(1, dist / size);
      return Math.sqrt(1 - (1 - x) * (1 - x));
    }
    case 'pillow': {
      const x = Math.min(1, dist / Math.max(maxDist, 1e-6));
      return 0.15 + 0.85 * Math.sqrt(1 - (1 - x) * (1 - x));
    }
    case 'outline': return dist <= Math.max(size, 0) ? 1 : 0;
    default: return 1;
  }
}

// Rahmen: s = 0 an der Außenkante, 1 an der Innenkante
export const FRAME_STYLES = {
  none: 'kein Rahmen',
  flat: 'flach',
  shadow: 'modern mit Schattenfuge',
  double: 'doppelt',
  bevelIn: 'Fase nach innen',
  bevelOut: 'Fase nach außen',
  round: 'Rundstab',
  cove: 'Hohlkehle',
  steps: 'Stufen',
  groove: 'mit Rille',
  classic: 'klassischer Bilderrahmen',
};

const circ = (x) => Math.sqrt(Math.max(0, 1 - x * x));
export function frameProfile(kind, s) {
  switch (kind) {
    case 'shadow': return s < 0.78 ? 1 : 0;
    case 'double': return s < 0.38 ? 1 : s < 0.62 ? 0 : 0.75;
    case 'bevelIn': return s < 0.4 ? 1 : 1 - 0.8 * ((s - 0.4) / 0.6);
    case 'bevelOut': return s > 0.6 ? 1 : 0.2 + 0.8 * (s / 0.6);
    case 'round': return 0.2 + 0.8 * circ(2 * s - 1);
    case 'cove': return Math.max(0.15, 1 - circ(1 - s));
    case 'steps': return 1 - Math.min(2, Math.floor(s * 3)) * 0.3;
    case 'groove': return 1 - 0.7 * Math.max(0, 1 - Math.abs(s - 0.5) / 0.18);
    case 'classic':
      if (s < 0.28) return 0.75 + 0.25 * circ((s - 0.14) / 0.14);
      if (s < 0.78) return 0.35 + 0.4 * (1 - circ(1 - (s - 0.28) / 0.5));
      return 0.55;
    default: return 1;
  }
}

export const PLATE_SHAPES = {
  rect: 'Rechteck',
  circle: 'Kreis',
  ellipse: 'Oval',
  hexagon: 'Sechseck',
  contour: 'Kontur – folgt dem Inhalt',
};
export const CORNER_STYLES = { sharp: 'eckig', round: 'abgerundet', chamfer: 'abgeschrägt', notch: 'eingekerbt' };

// ---------------------------------------------------------------- Distanztransformation
// Exakte euklidische Distanz (Felzenszwalb/Huttenlocher), quadratisch, in Zellen.
// f: 0 = Quelle, INF = frei; wird überschrieben.
const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}
export function edt(f, w, h) {
  const n = Math.max(w, h);
  const tf = new Float64Array(n), td = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) tf[y] = f[y * w + x];
    edt1d(tf, h, td, v, z);
    for (let y = 0; y < h; y++) f[y * w + x] = td[y];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) tf[x] = f[o + x];
    edt1d(tf, w, td, v, z);
    for (let x = 0; x < w; x++) f[o + x] = td[x];
  }
  return f;
}
// Abstand (in Zellen) jeder Zelle zur nächsten Zelle mit src[i] != 0
function distTo(src, w, h) {
  const f = new Float64Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = src[i] ? 0 : INF;
  edt(f, w, h);
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]);
  return f;
}

// ---------------------------------------------------------------- Formen (Distanzfelder in mm, negativ = innen)
function sdBox(x, y, bx, by, corner, r) {
  const ax = Math.abs(x), ay = Math.abs(y);
  r = Math.max(0, Math.min(r, bx, by));
  if (corner === 'round' && r > 0) {
    const qx = ax - bx + r, qy = ay - by + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }
  const qx = ax - bx, qy = ay - by;
  const d0 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  if (corner === 'chamfer' && r > 0) return Math.max(d0, (ax + ay - (bx + by - r)) / SQRT2);
  if (corner === 'notch' && r > 0) return Math.max(d0, r - Math.hypot(ax - bx, ay - by));
  return d0;
}
function sdEllipse(x, y, A, B) {
  const k0 = Math.hypot(x / A, y / B), k1 = Math.hypot(x / (A * A), y / (B * B));
  return k1 < 1e-12 ? -Math.min(A, B) : (k0 * (k0 - 1)) / k1;
}
function sdHexagon(x, y, r) {
  // flache Kanten oben/unten, Inkreisradius r
  const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
  let px = Math.abs(x), py = Math.abs(y);
  const d = 2 * Math.min(kx * px + ky * py, 0);
  px -= d * kx; py -= d * ky;
  px -= Math.max(-kz * r, Math.min(kz * r, px)); py -= r;
  return Math.hypot(px, py) * Math.sign(py);
}

// ---------------------------------------------------------------- Standard-Einstellungen
export function defaultEffect() {
  return { profile: 'flat', h: 0, size: 0.6, slot: -1 };
}
export function defaultConfig() {
  return {
    widthMm: 80, cellMm: 0.25,
    plate: { shape: 'rect', corner: 'round', radius: 4, pad: 5, thickness: 2, smooth: 3, fillHoles: true, slot: 0, colorThrough: false },
    frame: { style: 'flat', width: 4, height: 1.2, slot: 1, through: false },
    line: { width: 0, offset: 1.5, height: 0.6, slot: 1 },
    hole: { count: 0, d: 4, edge: 3 },
  };
}

// ---------------------------------------------------------------- Höhenfeld
// q: Ergebnis von quantize(); colors: [{slot, removed, effect}] pro Bildfarbe;
// zones: [{u0,v0,u1,v1 (0..1, v nach unten), label (-1 = alle), effect}]
export function buildField(q, colors, zones, cfg) {
  const cs = Math.max(0.02, cfg.cellMm);
  const iw = Math.max(1, Math.round(cfg.widthMm / cs));
  const ih = Math.max(1, Math.round((iw * q.h) / q.w));
  const a = (iw * cs) / 2, b = (ih * cs) / 2;
  const P = cfg.plate, Fr = cfg.frame, Ln = cfg.line;
  const fw = Fr.style !== 'none' ? Math.max(0, Fr.width) : 0;
  const m = Math.max(0, P.pad) + fw;
  const shape = P.shape;

  // Ausdehnung der Platte (halbe Breite/Höhe) und Distanzfeld der Form
  let ex = a + m, ey = b + m, sd = null;
  if (shape === 'circle') {
    const R = Math.hypot(a, b) + m; ex = ey = R;
    sd = (x, y) => Math.hypot(x, y) - R;
  } else if (shape === 'ellipse') {
    const A = a * SQRT2 + m, B = b * SQRT2 + m; ex = A; ey = B;
    sd = (x, y) => sdEllipse(x, y, A, B);
  } else if (shape === 'hexagon') {
    const r = Math.max(b, 0.866025404 * a + 0.5 * b) + m;
    ex = r / 0.866025404; ey = r;
    sd = (x, y) => sdHexagon(x, y, r);
  } else if (shape !== 'contour') {
    sd = (x, y) => sdBox(x, y, ex, ey, P.corner, P.radius);
  }
  const Mx = Math.ceil((ex - a) / cs) + 2, My = Math.ceil((ey - b) / cs) + 2;
  const gw = iw + 2 * Mx, gh = ih + 2 * My, N = gw * gh;
  const cx = (i) => (i - Mx + 0.5) * cs - a; // Zellmitte in mm (Inhalt zentriert)
  const cy = (j) => (j - My + 0.5) * cs - b;

  // Bildfarbe und Effektgruppe pro Zelle (Gruppe = Farbe oder gezeichneter Bereich)
  const K = colors.length;
  const lab = new Uint8Array(N).fill(TRANSPARENT);
  const grp = new Int16Array(N).fill(-1);
  for (let j = My; j < My + ih; j++) {
    const v = 1 - (j - My + 0.5) / ih;
    for (let i = Mx; i < Mx + iw; i++) {
      const u = (i - Mx + 0.5) / iw;
      const l = labelAt(q, u, v);
      if (l === TRANSPARENT || !colors[l] || colors[l].removed) continue;
      const c = j * gw + i;
      lab[c] = l;
      let g = l;
      for (let z = zones.length - 1; z >= 0; z--) {
        const Z = zones[z];
        if ((Z.label < 0 || Z.label === l) && u >= Z.u0 && u <= Z.u1 && v >= Z.v0 && v <= Z.v1) { g = K + z; break; }
      }
      grp[c] = g;
    }
  }
  const effects = colors.map((c) => c.effect || defaultEffect()).concat(zones.map((z) => z.effect));

  // Plattenform -> Abstand t (mm) jeder Zelle zur Außenkante, > 0 = innen
  const t = new Float64Array(N);
  if (shape === 'contour') {
    const content = new Uint8Array(N);
    for (let c = 0; c < N; c++) content[c] = lab[c] !== TRANSPARENT ? 1 : 0;
    const D1 = distTo(content, gw, gh);
    const s = Math.max(0, P.smooth);
    // Schließen: um Abstand+Glättung erweitern, um Glättung wieder schrumpfen
    const closed = new Uint8Array(N);
    for (let c = 0; c < N; c++) closed[c] = D1[c] * cs - cs / 2 <= m + s ? 1 : 0;
    if (P.fillHoles) fillHoles(closed, gw, gh);
    const out = new Uint8Array(N);
    for (let c = 0; c < N; c++) out[c] = closed[c] ? 0 : 1;
    const E2 = distTo(out, gw, gh);
    for (let c = 0; c < N; c++) t[c] = E2[c] * cs - cs / 2 - s;
  } else {
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) t[j * gw + i] = -sd(cx(i), cy(j));
  }

  // Abstand jeder Inhaltszelle zum Rand ihres Bereichs (für die Profile)
  let D = null, comp = null, compMax = null;
  if (effects.some((e) => e.profile !== 'flat')) {
    const seed = new Uint8Array(N);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const c = j * gw + i, g = grp[c];
        if (g < 0 || i === 0 || j === 0 || i === gw - 1 || j === gh - 1 ||
          grp[c - 1] !== g || grp[c + 1] !== g || grp[c - gw] !== g || grp[c + gw] !== g) seed[c] = 1;
      }
    }
    D = distTo(seed, gw, gh);
    // Kissen: größter Abstand je zusammenhängendem Teil
    if (effects.some((e) => e.profile === 'pillow')) {
      const r = components(grp, gw, gh);
      comp = r.comp;
      compMax = new Float64Array(r.count);
      for (let c = 0; c < N; c++) if (comp[c] >= 0) compMax[comp[c]] = Math.max(compMax[comp[c]], (D[c] + 0.5) * cs);
    }
  }

  // Höhen (mm) und Filamente: S = Oberseite, L = unterhalb der Plattendicke
  const base = Math.max(0, P.thickness);
  const bgSlot = P.slot;
  const H = new Float64Array(N), S = new Uint8Array(N), L = new Uint8Array(N);
  const lineIn = fw + Math.max(0, Ln.offset), lineOut = lineIn + Math.max(0, Ln.width);
  for (let c = 0; c < N; c++) {
    const g = grp[c], tt = t[c];
    let h = 0, s = bgSlot, low = bgSlot;
    if (fw > 0 && tt > 0 && tt < fw) {
      h = base + Fr.height * frameProfile(Fr.style, tt / fw);
      s = Fr.slot; low = Fr.through ? Fr.slot : bgSlot;
    } else if (g >= 0) {
      const e = effects[g];
      const slot = e.slot >= 0 ? e.slot : colors[lab[c]].slot;
      const dist = D ? (D[c] + 0.5) * cs : 0;
      h = base + (e.h || 0) * contentProfile(e.profile, dist, comp ? compMax[comp[c]] : 0, e.size);
      s = slot; low = P.colorThrough ? slot : bgSlot;
    } else if (tt > 0) {
      h = base;
      if (Ln.width > 0 && tt >= lineIn && tt < lineOut) { h = base + Ln.height; s = Ln.slot; }
    }
    if (h > 0.004) { H[c] = h; S[c] = s; L[c] = low; }
  }

  // Aufhängelöcher (oben, durchgehend)
  const hole = cfg.hole;
  if (hole && hole.count > 0 && hole.d > 0) {
    const r = hole.d / 2;
    let xs = [0];
    if (hole.count === 2) {
      const off = shape === 'rect' ? ex - hole.edge - r - (P.corner !== 'sharp' ? P.radius * 0.5 : 0) : ex * 0.5;
      xs = [-off, off];
    }
    for (const hx of xs) {
      const i = Math.max(0, Math.min(gw - 1, Math.floor((hx + a) / cs + Mx)));
      let top = null;
      for (let j = gh - 1; j >= 0; j--) if (H[j * gw + i] > 0) { top = cy(j) + cs / 2; break; }
      if (top === null) continue;
      const hy = top - hole.edge - r - (shape === 'rect' && hole.count === 2 ? (P.corner !== 'sharp' ? P.radius * 0.5 : 0) : 0);
      for (let j = 0; j < gh; j++) for (let k = 0; k < gw; k++) {
        if (Math.hypot(cx(k) - hx, cy(j) - hy) < r) H[j * gw + k] = 0;
      }
    }
  }

  fixDiagonals(H, S, L, gw, gh);
  return { gw, gh, cs, H, S, L, base, x0: -Mx * cs - a, y0: -My * cs - b, content: { iw, ih, Mx, My } };
}

// Innenlöcher einer Maske füllen (alles, was vom Rand aus nicht erreichbar ist)
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h), st = [];
  const push = (c) => { if (!mask[c] && !seen[c]) { seen[c] = 1; st.push(c); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const c = st.pop(), x = c % w;
    if (x > 0) push(c - 1);
    if (x < w - 1) push(c + 1);
    if (c >= w) push(c - w);
    if (c + w < w * h) push(c + w);
  }
  for (let c = 0; c < w * h; c++) if (!mask[c] && !seen[c]) mask[c] = 1;
}

// Zusammenhängende Teile gleicher Gruppe (4er-Nachbarschaft)
function components(grp, w, h) {
  const N = w * h, comp = new Int32Array(N).fill(-1), st = [];
  let count = 0;
  for (let c0 = 0; c0 < N; c0++) {
    if (grp[c0] < 0 || comp[c0] >= 0) continue;
    const g = grp[c0];
    comp[c0] = count; st.push(c0);
    while (st.length) {
      const c = st.pop(), x = c % w;
      const nb = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w];
      for (const n of nb) if (n >= 0 && n < N && comp[n] < 0 && grp[n] === g) { comp[n] = count; st.push(n); }
    }
    count++;
  }
  return { comp, count };
}

// Höhere Zellen, die sich nur über Eck berühren (Schachbrett), ergeben nicht-mannigfaltige
// Kanten -> eine der niedrigeren Zellen anheben. Vergleich auf dem Höhenraster des Netzes.
function fixDiagonals(H, S, L, w, h) {
  const q = (x) => Math.round(x * UNIT);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let j = 0; j + 1 < h; j++) {
      for (let i = 0; i + 1 < w; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        const A = q(H[a]), B = q(H[b]), C = q(H[c]), Dd = q(H[d]);
        let src = -1, dst = -1;
        if (Math.min(A, Dd) > Math.max(B, C)) { src = A < Dd ? a : d; dst = B >= C ? b : c; }
        else if (Math.min(B, C) > Math.max(A, Dd)) { src = B < C ? b : c; dst = A >= Dd ? a : d; }
        if (dst < 0) continue;
        H[dst] = H[src]; S[dst] = S[src]; L[dst] = L[src];
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------- Netz
// Geschlossenes Netz aus dem Höhenfeld. Gleich hohe Flächen werden zu Rechtecken
// zusammengefasst; alle Kanten bleiben konform (keine T-Stellen), damit das Netz dicht ist.
export function fieldToMesh(F) {
  const { gw, gh, cs, S, L } = F;
  const N = gw * gh, CW = gw + 1;
  const Hu = new Int32Array(N);
  for (let c = 0; c < N; c++) Hu[c] = F.H[c] > 0 ? Math.max(1, Math.round(F.H[c] * UNIT)) : 0;
  const baseU = Math.round(F.base * UNIT);
  const X = (ci) => F.x0 + ci * cs, Y = (cj) => F.y0 + cj * cs, Z = (u) => u / UNIT;
  const hAt = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : Hu[j * gw + i]);

  let pos = new Float32Array(1 << 20), col = new Uint8Array(1 << 17), np = 0, nt = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, s) => {
    if (np + 9 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; }
    if (nt + 1 > col.length) { const c2 = new Uint8Array(col.length * 2); c2.set(col); col = c2; }
    pos[np++] = ax; pos[np++] = ay; pos[np++] = az;
    pos[np++] = bx; pos[np++] = by; pos[np++] = bz;
    pos[np++] = cx; pos[np++] = cy; pos[np++] = cz;
    col[nt++] = s;
  };

  // Ecke (ci,cj): alle vier Nachbarzellen gleich hoch bzw. belegt?
  const allEqual = (ci, cj) => {
    const h = hAt(ci - 1, cj - 1);
    return h > 0 && hAt(ci, cj - 1) === h && hAt(ci - 1, cj) === h && hAt(ci, cj) === h;
  };
  const allFilled = (ci, cj) => hAt(ci - 1, cj - 1) > 0 && hAt(ci, cj - 1) > 0 && hAt(ci - 1, cj) > 0 && hAt(ci, cj) > 0;

  // Gleichartige Zellen zu Rechtecken zusammenfassen -> [i0,j0,i1,j1,Zelle, ...]
  const rects = (keyOf) => {
    const used = new Uint8Array(N), out = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const c = j * gw + i;
        if (used[c] || !Hu[c]) continue;
        const k = keyOf(c);
        let i1 = i + 1;
        while (i1 < gw && !used[j * gw + i1] && Hu[j * gw + i1] && keyOf(j * gw + i1) === k) i1++;
        let j1 = j + 1;
        for (; j1 < gh; j1++) {
          let ok = true;
          for (let x = i; x < i1; x++) { const d = j1 * gw + x; if (used[d] || !Hu[d] || keyOf(d) !== k) { ok = false; break; } }
          if (!ok) break;
        }
        for (let y = j; y < j1; y++) used.fill(1, y * gw + i, y * gw + i1);
        out.push(i, j, i1, j1, c);
      }
    }
    return out;
  };
  const markCorners = (R) => {
    const mark = new Uint8Array(CW * (gh + 1));
    for (let r = 0; r < R.length; r += 5) {
      const i0 = R[r], j0 = R[r + 1], i1 = R[r + 2], j1 = R[r + 3];
      mark[j0 * CW + i0] = mark[j0 * CW + i1] = mark[j1 * CW + i0] = mark[j1 * CW + i1] = 1;
    }
    return mark;
  };
  // Rechteck mit allen Randpunkten, an denen andere Flächen Ecken haben
  const emitRects = (R, inner, zOf, slotOf, up) => {
    const mark = markCorners(R);
    const pts = [];
    for (let r = 0; r < R.length; r += 5) {
      const i0 = R[r], j0 = R[r + 1], i1 = R[r + 2], j1 = R[r + 3], c = R[r + 4];
      pts.length = 0;
      const add = (ci, cj) => { if (mark[cj * CW + ci] || !inner(ci, cj)) pts.push(X(ci), Y(cj)); };
      for (let x = i0; x < i1; x++) add(x, j0);
      for (let y = j0; y < j1; y++) add(i1, y);
      for (let x = i1; x > i0; x--) add(x, j1);
      for (let y = j1; y > j0; y--) add(i0, y);
      const z = zOf(c), s = slotOf(c), n = pts.length / 2;
      const T = (ax, ay, bx, by, qx, qy) => (up ? tri(ax, ay, z, bx, by, z, qx, qy, z, s) : tri(ax, ay, z, qx, qy, z, bx, by, z, s));
      if (n === 4) {
        T(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]);
        T(pts[0], pts[1], pts[4], pts[5], pts[6], pts[7]);
        continue;
      }
      const mx = (X(i0) + X(i1)) / 2, my = (Y(j0) + Y(j1)) / 2;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        T(mx, my, pts[2 * k], pts[2 * k + 1], pts[2 * k2], pts[2 * k2 + 1]);
      }
    }
  };

  // Oberseiten und Unterseiten (z = 0)
  emitRects(rects((c) => Hu[c] * 256 + S[c]), allEqual, (c) => Z(Hu[c]), (c) => S[c], true);
  emitRects(rects((c) => L[c]), allFilled, () => 0, (c) => L[c], false);

  // Wände: An jeder senkrechten Ecklinie liegen Punkte auf allen Höhen der vier
  // angrenzenden Zellen (+ 0 und Plattendicke); jede Wand nutzt genau diese Punkte.
  const levels = (ci, cj, lo, hi) => {
    const v = [hAt(ci - 1, cj - 1), hAt(ci, cj - 1), hAt(ci - 1, cj), hAt(ci, cj), 0, baseU];
    const out = [];
    for (const x of v) if (x >= lo && x <= hi && !out.includes(x)) out.push(x);
    return out.sort((p, q) => p - q);
  };
  const wall = (c, p1i, p1j, p2i, p2j, lo) => {
    const hi = Hu[c];
    const A = levels(p1i, p1j, lo, hi), B = levels(p2i, p2j, lo, hi);
    const x1 = X(p1i), y1 = Y(p1j), x2 = X(p2i), y2 = Y(p2j);
    let i = 0, k = 0;
    while (i < A.length - 1 || k < B.length - 1) {
      if (k < B.length - 1 && (i === A.length - 1 || B[k + 1] <= A[i + 1])) {
        const zc = (A[i] + B[k] + B[k + 1]) / 3;
        tri(x1, y1, Z(A[i]), x2, y2, Z(B[k]), x2, y2, Z(B[k + 1]), zc < baseU ? L[c] : S[c]);
        k++;
      } else {
        const zc = (A[i] + B[k] + A[i + 1]) / 3;
        tri(x1, y1, Z(A[i]), x2, y2, Z(B[k]), x1, y1, Z(A[i + 1]), zc < baseU ? L[c] : S[c]);
        i++;
      }
    }
  };
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i, h = Hu[c];
      if (!h) continue;
      let n;
      if ((n = hAt(i, j - 1)) < h) wall(c, i, j, i + 1, j, n);
      if ((n = hAt(i + 1, j)) < h) wall(c, i + 1, j, i + 1, j + 1, n);
      if ((n = hAt(i, j + 1)) < h) wall(c, i + 1, j + 1, i, j + 1, n);
      if ((n = hAt(i - 1, j)) < h) wall(c, i, j + 1, i, j, n);
    }
  }
  return { pos: pos.slice(0, np), col: col.slice(0, nt) };
}

// ---------------------------------------------------------------- Vorschau
// Draufsicht mit Schattierung; paletteRgb[slot] = [r,g,b]. Liefert RGBA (Zeile 0 = oben).
export function renderField(F, paletteRgb) {
  const { gw, gh, cs, H, S } = F;
  const out = new Uint8ClampedArray(gw * gh * 4);
  let lx = -0.45, ly = 0.55, lz = 0.7;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const hAt = (i, j) => H[Math.max(0, Math.min(gh - 1, j)) * gw + Math.max(0, Math.min(gw - 1, i))];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i, o = 4 * ((gh - 1 - j) * gw + i);
      if (!(H[c] > 0)) continue;
      const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cs), dy = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cs);
      const nl = Math.hypot(dx, dy, 1);
      const sh = 0.38 + 0.62 * Math.max(0, (-dx * lx - dy * ly + lz) / nl);
      const p = paletteRgb[S[c]] || [128, 128, 128];
      out[o] = p[0] * sh; out[o + 1] = p[1] * sh; out[o + 2] = p[2] * sh; out[o + 3] = 255;
    }
  }
  return out;
}

// Abmessungen des belegten Bereichs (mm)
export function fieldInfo(F) {
  let i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1, z = 0;
  for (let j = 0; j < F.gh; j++) for (let i = 0; i < F.gw; i++) {
    const h = F.H[j * F.gw + i];
    if (!(h > 0)) continue;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
    if (h > z) z = h;
  }
  if (i1 < 0) return { w: 0, h: 0, z: 0 };
  return { w: (i1 - i0 + 1) * F.cs, h: (j1 - j0 + 1) * F.cs, z };
}