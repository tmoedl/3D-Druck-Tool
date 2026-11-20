// Stecksystem: Module, die nebeneinander an der Wand hängen und von hinten mit
// Doppel-T-Verbindern („Knochen“) zusammengesteckt werden – Karte, Bilderrahmen für
// Fotoabzüge, Medaillenhalter, Textschild. Dazu Aufhängeschlitze für Nagel/Schraube.
//
// Alle Module entstehen mit einem Säulen-Vermascher: Raster aus beliebigen x/y-Linien,
// je Zelle eine Liste von Höhenintervallen [z0, z1, Filament]. So sind auch Hohlräume
// (Foto-Einschub) und Überhänge (Haken) möglich, und Taschen haben exakte senkrechte Wände.
// Reines JS – in Node testbar.

// ---------------------------------------------------------------- Säulen-Vermascher
// xs, ys: aufsteigende Rasterlinien (mm); cell(i, j) -> [[z0, z1, slot], …] (sortiert, disjunkt)
export function columnsToMesh(xs, ys, cell) {
  const nx = xs.length - 1, ny = ys.length - 1, VX = nx + 1;
  const C = new Array(nx * ny);
  const key = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const iv = (cell(i, j) || []).filter((q) => q[1] - q[0] > 1e-6).sort((a, b) => a[0] - b[0]);
    // berührende Intervalle zusammenfassen (oberes Filament gewinnt)
    const m = [];
    for (const q of iv) {
      const l = m[m.length - 1];
      if (l && q[0] <= l[1] + 1e-9) { l[1] = Math.max(l[1], q[1]); l[2] = q[2]; } else m.push(q.slice());
    }
    C[j * nx + i] = m;
    key[j * nx + i] = m.map((q) => q.join(',')).join(';');
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? EMPTY : C[j * nx + i]);
  const keyAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? '' : key[j * nx + i]);

  let pos = new Float32Array(1 << 18), col = new Uint8Array(1 << 15), np = 0, nt = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, s) => {
    if (np + 9 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; }
    if (nt + 1 > col.length) { const c2 = new Uint8Array(col.length * 2); c2.set(col); col = c2; }
    pos[np++] = ax; pos[np++] = ay; pos[np++] = az; pos[np++] = bx; pos[np++] = by; pos[np++] = bz; pos[np++] = cx; pos[np++] = cy; pos[np++] = cz;
    col[nt++] = s;
  };

  // gleiche Zellen zu Rechtecken zusammenfassen
  const used = new Uint8Array(nx * ny), R = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (used[c] || !key[c]) continue;
    const k = key[c];
    let i1 = i + 1;
    while (i1 < nx && !used[j * nx + i1] && key[j * nx + i1] === k) i1++;
    let j1 = j + 1;
    for (; j1 < ny; j1++) {
      let ok = true;
      for (let x = i; x < i1; x++) { const d = j1 * nx + x; if (used[d] || key[d] !== k) { ok = false; break; } }
      if (!ok) break;
    }
    for (let y = j; y < j1; y++) used.fill(1, y * nx + i, y * nx + i1);
    R.push([i, j, i1, j1, c]);
  }
  const mark = new Uint8Array(VX * (ny + 1));
  for (const [i0, j0, i1, j1] of R) mark[j0 * VX + i0] = mark[j0 * VX + i1] = mark[j1 * VX + i0] = mark[j1 * VX + i1] = 1;
  const inner = (i, j) => { const k = keyAt(i - 1, j - 1); return k !== '' && keyAt(i, j - 1) === k && keyAt(i - 1, j) === k && keyAt(i, j) === k; };
  const pts = [];
  for (const [i0, j0, i1, j1, c] of R) {
    pts.length = 0;
    const add = (i, j) => { if (mark[j * VX + i] || !inner(i, j)) pts.push(xs[i], ys[j]); };
    for (let x = i0; x < i1; x++) add(x, j0);
    for (let y = j0; y < j1; y++) add(i1, y);
    for (let x = i1; x > i0; x--) add(x, j1);
    for (let y = j1; y > j0; y--) add(i0, y);
    const n = pts.length / 2;
    const mx = (xs[i0] + xs[i1]) / 2, my = (ys[j0] + ys[j1]) / 2;
    for (const [z0, z1, s] of C[c]) {
      for (const [z, up] of [[z1, true], [z0, false]]) {
        if (n === 4) {
          const q = [0, 1, 2, 0, 2, 3];
          for (let t = 0; t < 6; t += 3) {
            const a = q[t], b = up ? q[t + 1] : q[t + 2], d = up ? q[t + 2] : q[t + 1];
            tri(pts[2 * a], pts[2 * a + 1], z, pts[2 * b], pts[2 * b + 1], z, pts[2 * d], pts[2 * d + 1], z, s);
          }
        } else {
          for (let k = 0; k < n; k++) {
            const a = k, b = (k + 1) % n;
            if (up) tri(mx, my, z, pts[2 * a], pts[2 * a + 1], z, pts[2 * b], pts[2 * b + 1], z, s);
            else tri(mx, my, z, pts[2 * b], pts[2 * b + 1], z, pts[2 * a], pts[2 * a + 1], z, s);
          }
        }
      }
    }
  }

  // Wände: Teil der eigenen Intervalle, der beim Nachbarn nicht gefüllt ist
  const levels = (i, j, lo, hi) => {
    const out = [lo, hi];
    for (const cc of [at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)]) for (const q of cc) for (const z of [q[0], q[1]]) if (z > lo && z < hi && !out.includes(z)) out.push(z);
    return out.sort((a, b) => a - b);
  };
  const zipper = (x1, y1, x2, y2, A, B, s) => {
    let i = 0, k = 0;
    while (i < A.length - 1 || k < B.length - 1) {
      if (k < B.length - 1 && (i === A.length - 1 || B[k + 1] <= A[i + 1])) { tri(x1, y1, A[i], x2, y2, B[k], x2, y2, B[k + 1], s); k++; }
      else { tri(x1, y1, A[i], x2, y2, B[k], x1, y1, A[i + 1], s); i++; }
    }
  };
  const minus = (a, list) => { // Intervall a minus Intervalle list
    let parts = [[a[0], a[1]]];
    for (const q of list) {
      const nxt = [];
      for (const [p0, p1] of parts) {
        if (q[1] <= p0 || q[0] >= p1) { nxt.push([p0, p1]); continue; }
        if (q[0] > p0) nxt.push([p0, q[0]]);
        if (q[1] < p1) nxt.push([q[1], p1]);
      }
      parts = nxt;
    }
    return parts.filter(([p0, p1]) => p1 - p0 > 1e-9);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cc = C[j * nx + i];
    if (!cc.length) continue;
    const edges = [[i, j, i + 1, j, i, j - 1], [i + 1, j, i + 1, j + 1, i + 1, j], [i + 1, j + 1, i, j + 1, i, j + 1], [i, j + 1, i, j, i - 1, j]];
    for (const [ai, aj, bi, bj, ni, nj] of edges) {
      const nb = at(ni, nj);
      for (const q of cc) {
        for (const [lo, hi] of minus(q, nb)) {
          zipper(xs[ai], ys[aj], xs[bi], ys[bj], levels(ai, aj, lo, hi), levels(bi, bj, lo, hi), q[2]);
        }
      }
    }
  }
  return { pos: pos.slice(0, np), col: col.slice(0, nt) };
}
const EMPTY = [];

// Rasterlinien aus Rechtecken (+ feines Raster in Bereichen mit Masken)
export function gridLines(rects, fine = []) {
  const xs = new Set(), ys = new Set();
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  for (const r of rects) { xs.add(r6(r[0])); xs.add(r6(r[2])); ys.add(r6(r[1])); ys.add(r6(r[3])); }
  for (const f of fine) {
    for (let k = 0; k <= f.cols; k++) xs.add(r6(f.x0 + (k * f.w) / f.cols));
    for (let k = 0; k <= f.rows; k++) ys.add(r6(f.y0 + (k * f.h) / f.rows));
  }
  return [[...xs].sort((a, b) => a - b), [...ys].sort((a, b) => a - b)];
}
const inR = (x, y, r) => x > r[0] && x < r[2] && y > r[1] && y < r[3];

// ---------------------------------------------------------------- Verbinder (Doppel-T)
export function defaultModuleConfig() {
  return {
    on: false,
    left: 'none', right: 'photo', top: 'none', bottom: 'medal',
    thickness: 7,          // Gesamtdicke der flachen Module
    key: { headW: 10, headL: 7, neckW: 5, neckL: 8, t: 3, clear: 0.2, depthExtra: 0.4, spacing: 70 },
    hang: { on: true, w: 7, l: 22, depth: 3.5 },
    photo: { format: '10x15', orient: 'portrait', w: 102, h: 152, border: 12, overlap: 3, gap: 0.9, back: 0, slot: 0, frameSlot: 0 },
    medal: { diameter: 70, line1: '{titel}', line2: 'FINISHER · {zeit}', textSize: 7, hookW: 30, pegLen: 15, border: true },
    medalbar: { height: 45, pegs: 0, pegLen: 20, pegW: 8, lip: 3, text: 'FINISHER', textSize: 9, textSlot: 1, slot: 0 },
    text: { height: 40, lines: 'Mein Event\n2026', textSize: 9, textSlot: 1, slot: 0 },
    gap: 3,
  };
}
export const PHOTO_FORMATS = {
  '9x13': [89, 127], '10x15': [102, 152], '13x18': [127, 178], '10x10': [102, 102], '13x13': [127, 127], '15x20': [152, 203], custom: null,
};
export const MODULE_TYPES = { none: 'nichts', photo: 'Bilderrahmen (Fotoabzug)', medal: 'Medaille (einzeln, edel)', medalbar: 'Medaillenleiste (mehrere)', text: 'Textschild' };

// Taschenrechtecke (in Modulkoordinaten) für einen Verbinder an einer Kante
// edge: 'L'|'R'|'B'|'T' (Kante des Moduls), at = Position entlang der Kante, E = Kantenkoordinate
export function keyPockets(K, edge, at, E) {
  const c = K.clear, hn = K.neckL / 2;
  const nw = K.neckW / 2 + c, hw = K.headW / 2 + c;
  // in lokalem 1D: d = Abstand von der Kante ins Modul hinein
  const segs = [[0, hn + c, nw], [hn - c, hn + K.headL + c, hw]];
  return segs.map(([d0, d1, half]) => {
    if (edge === 'L') return [E + d0, at - half, E + d1, at + half];
    if (edge === 'R') return [E - d1, at - half, E - d0, at + half];
    if (edge === 'B') return [at - half, E + d0, at + half, E + d1];
    return [at - half, E - d1, at + half, E - d0];
  });
}

// Verbinder-Teil (liegend gedruckt), Mitte bei (0,0)
export function keyPart(K, slot = 0) {
  const hn = K.neckL / 2;
  const rects = [[-hn, -K.neckW / 2, hn, K.neckW / 2], [-hn - K.headL, -K.headW / 2, -hn, K.headW / 2], [hn, -K.headW / 2, hn + K.headL, K.headW / 2]];
  const [xs, ys] = gridLines(rects);
  return columnsToMesh(xs, ys, (i, j) => {
    const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => inR(x, y, r)) ? [[0, K.t, slot]] : [];
  });
}

// Aufhängeschlitz (senkrecht, oben im Modul)
export function hangPockets(H, w, h, count) {
  const out = [];
  const xs = count === 1 ? [0] : [-w * 0.3, w * 0.3];
  for (const x of xs) out.push([x - H.w / 2, h / 2 - 12 - H.l, x + H.w / 2, h / 2 - 12]);
  return out;
}

// ---------------------------------------------------------------- Module
// Alle Module: Mitte bei (0,0), Rückseite bei z = 0. pockets: [{rect, depth}] werden ausgespart.
// masks: [{x0,y0,w,h,cols,rows,data}] Textmasken (Modulkoordinaten), erhaben um textH.

function withPockets(base, pockets) {
  return (x, y, iv) => {
    let d = 0;
    for (const p of pockets) if (inR(x, y, p.rect)) d = Math.max(d, p.depth);
    if (!d) return iv;
    return iv.map((q) => (q[0] < d ? [Math.max(q[0], d), q[1], q[2]] : q)).filter((q) => q[1] > q[0]);
  };
}
function maskAt(M, x, y) {
  const u = Math.floor(((x - M.x0) / M.w) * M.cols), v = Math.floor(((M.y0 + M.h - y) / M.h) * M.rows);
  return u >= 0 && v >= 0 && u < M.cols && v < M.rows && M.data[v * M.cols + u] >= 128;
}

// Bilderrahmen mit Einschub von oben: Foto liegt hinter einem schmalen Rand (overlap)
export function photoFrame(P, w, h, T, pockets = [], slots = {}) {
  const pw = P.w + 1.0, ph = P.h + 1.0; // Foto + Spiel
  const back = Math.max(P.back || 0, (pockets.reduce((m, p) => Math.max(m, p.depth), 0) || 0) + 0.8, 1.2);
  const gap = P.gap;
  const top = Math.max(T, back + gap + 1.4);
  const cy = 0; // Foto mittig
  const photo = [-pw / 2, cy - ph / 2, pw / 2, cy + ph / 2];
  const win = [photo[0] + P.overlap, photo[1] + P.overlap, photo[2] - P.overlap, photo[3] - P.overlap];
  const chan = [photo[0], photo[3] - 0.01, photo[2], h / 2]; // Einschub nach oben offen
  const outer = [-w / 2, -h / 2, w / 2, h / 2];
  const fs = slots.frame ?? 0, bs = slots.back ?? fs;
  const pk = withPockets(null, pockets);
  const [xs, ys] = gridLines([outer, photo, win, chan, ...pockets.map((p) => p.rect)]);
  return {
    mesh: columnsToMesh(xs, ys, (i, j) => {
      const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
      if (!inR(x, y, outer)) return [];
      let iv;
      if (inR(x, y, win)) iv = [[0, back, bs]];
      else if (inR(x, y, chan) && y > photo[3] - 0.02) iv = [[0, back, bs]]; // offene Rinne zum Einschieben
      else if (inR(x, y, photo)) iv = [[0, back, bs], [back + gap, top, fs]];
      else iv = [[0, top, fs]];
      return pk(x, y, iv);
    }),
    win, back, photo,
    info: `Foto ${P.w} × ${P.h} mm, Fenster ${(win[2] - win[0]).toFixed(0)} × ${(win[3] - win[1]).toFixed(0)} mm, Einschub oben`,
  };
}

// Medaillenhalter: Leiste mit Haken (Zapfen mit Nase oben) und optionalem Text
export function medalHolder(M, w, h, T, pockets = [], masks = [], slots = {}) {
  const outer = [-w / 2, -h / 2, w / 2, h / 2];
  const n = M.pegs > 0 ? M.pegs : Math.max(2, Math.min(12, Math.round(w / 45)));
  const pegs = [];
  const py0 = -h / 2 + Math.max(6, h * 0.18), py1 = py0 + M.pegW;
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + ((k + 0.5) * w) / n;
    pegs.push({ body: [x - M.pegW / 2, py0, x + M.pegW / 2, py1], lip: [x - M.pegW / 2, py1, x + M.pegW / 2, py1 + M.lip] });
  }
  const s = slots.plate ?? 0, ts = slots.text ?? s;
  const pk = withPockets(null, pockets);
  const top = T + M.pegLen;
  const [xs, ys] = gridLines([outer, ...pegs.flatMap((p) => [p.body, p.lip]), ...pockets.map((p) => p.rect)], masks);
  return {
    mesh: columnsToMesh(xs, ys, (i, j) => {
      const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
      if (!inR(x, y, outer)) return [];
      let iv = [[0, T, s]];
      for (const p of pegs) {
        if (inR(x, y, p.body)) iv = [[0, top, s]];
        else if (inR(x, y, p.lip)) iv = [[0, T, s], [top - 2.4, top, s]];
      }
      if (iv.length === 1 && iv[0][1] === T && masks.some((m) => maskAt(m, x, y))) iv = [[0, T + (M.textH || 1), ts]];
      return pk(x, y, iv);
    }),
    info: `${n} Haken, je ${M.pegLen} mm lang`,
  };
}

// Edler Halter für EINE Medaille: Bühne mit Zierring (leicht vertieft), kräftiger Haken mit Nase
// für das Band, umlaufende Zierlinie und Schrift. Layout passt sich dem Format an:
// hoch/kompakt -> Ring oben, Text darunter; breit -> Ring mittig, Text links und rechts.
export function medalLayout(M, w, h) {
  const m = 7;
  const wide = w / h > 1.9;
  const hookH = 5;
  let R = M.diameter / 2 + 5;
  const maxR = wide ? (h - 2 * m - hookH - 4) / 2 : Math.min((w - 2 * m) / 2, (h - 2 * m - hookH - 4) * 0.36);
  R = Math.max(12, Math.min(R, maxR));
  const cx = 0;
  const cy = wide ? -hookH / 2 - 2 : h / 2 - m - hookH - 4 - R;
  const hook = [cx - M.hookW / 2, cy + R + 3, cx + M.hookW / 2, cy + R + 3 + hookH];
  const areas = wide
    ? [{ x0: -w / 2 + m + 2, y0: -h / 2 + m, x1: cx - R - m, y1: h / 2 - m }, { x0: cx + R + m, y0: -h / 2 + m, x1: w / 2 - m - 2, y1: h / 2 - m }]
    : [{ x0: -w / 2 + m + 2, y0: -h / 2 + m + 1, x1: w / 2 - m - 2, y1: cy - R - 3 }];
  return { wide, R, cx, cy, hook, areas, ringW: 2.6 };
}
export function medalSingle(M, w, h, T, pockets = [], masks = [], slots = {}) {
  const Lt = medalLayout(M, w, h);
  const outer = [-w / 2, -h / 2, w / 2, h / 2];
  const s = slots.plate ?? 0, a = slots.text ?? s;
  const pk = withPockets(null, pockets);
  const top = T + M.pegLen;
  const lip = [Lt.hook[0], Lt.hook[3], Lt.hook[2], Lt.hook[3] + 2.6];
  const bi = 3.2, bw = 1.2; // Zierlinie
  const lineO = [outer[0] + bi, outer[1] + bi, outer[2] - bi, outer[3] - bi], lineI = [lineO[0] + bw, lineO[1] + bw, lineO[2] - bw, lineO[3] - bw];
  const res = 0.3, rr = Lt.R + 0.6;
  const fine = { x0: Lt.cx - rr, y0: Lt.cy - rr, w: 2 * rr, h: 2 * rr, cols: Math.ceil((2 * rr) / res), rows: Math.ceil((2 * rr) / res) };
  const rects = [outer, Lt.hook, lip, ...(M.border ? [lineO, lineI] : []), ...pockets.map((p) => p.rect)];
  const [xs, ys] = gridLines(rects, [fine, ...masks]);
  return {
    mesh: columnsToMesh(xs, ys, (i, j) => {
      const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
      if (!inR(x, y, outer)) return [];
      let iv = [[0, T, s]];
      const r = Math.hypot(x - Lt.cx, y - Lt.cy);
      if (inR(x, y, Lt.hook)) iv = [[0, top, s]];
      else if (inR(x, y, lip)) iv = [[0, T, s], [top - 2.4, top, s]];
      else if (r <= Lt.R && r >= Lt.R - Lt.ringW) iv = [[0, T + 1.6, a]];
      else if (r < Lt.R - Lt.ringW) iv = [[0, T - 0.8, s]];
      else if (M.border && inR(x, y, lineO) && !inR(x, y, lineI)) iv = [[0, T + 0.6, a]];
      else if (masks.some((mk) => maskAt(mk, x, y))) iv = [[0, T + 0.8, a]];
      return pk(x, y, iv);
    }),
    info: `Medaille bis Ø ${Math.round(2 * (Lt.R - Lt.ringW - 1))} mm`,
    layout: Lt,
  };
}

// Textschild: Platte mit erhabener Schrift und schmalem Rand
export function textPlate(Tx, w, h, T, pockets = [], masks = [], slots = {}) {
  const outer = [-w / 2, -h / 2, w / 2, h / 2], rim = 2.5;
  const innerR = [outer[0] + rim, outer[1] + rim, outer[2] - rim, outer[3] - rim];
  const s = slots.plate ?? 0, ts = slots.text ?? s;
  const pk = withPockets(null, pockets);
  const [xs, ys] = gridLines([outer, innerR, ...pockets.map((p) => p.rect)], masks);
  return {
    mesh: columnsToMesh(xs, ys, (i, j) => {
      const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
      if (!inR(x, y, outer)) return [];
      let iv = inR(x, y, innerR) ? [[0, T, s]] : [[0, T + 0.8, ts]];
      if (inR(x, y, innerR) && masks.some((m) => maskAt(m, x, y))) iv = [[0, T + (Tx.textH || 1), ts]];
      return pk(x, y, iv);
    }),
    info: 'Textschild',
  };
}

// ---------------------------------------------------------------- Anordnung
// mapRect: [x0,y0,x1,y1] der Karte (mit Rahmen). Liefert Module mit Rechteck (Wandansicht)
// und alle Verbinder-Taschen je Modul sowie die Anzahl Verbinder.
export function planModules(MC, mapRect) {
  const mods = [{ id: 'map', type: 'map', rect: mapRect.slice() }];
  const H = mapRect[3] - mapRect[1];
  const sideW = (type) => {
    if (type === 'photo') { const P = photoDims(MC.photo); return P.w + 2 * Math.max(8, MC.photo.border); }
    if (type === 'medal') return MC.medal.diameter + 34;
    if (type === 'medalbar') return MC.medalbar.height;
    if (type === 'text') return MC.text.height;
    return 0;
  };
  const g = 0; // Module stoßen bündig aneinander
  let x0 = mapRect[0], x1 = mapRect[2];
  if (MC.left !== 'none') { const w = sideW(MC.left); mods.push({ id: 'left', type: MC.left, rect: [x0 - g - w, mapRect[1], x0 - g, mapRect[3]] }); x0 -= w + g; }
  if (MC.right !== 'none') { const w = sideW(MC.right); mods.push({ id: 'right', type: MC.right, rect: [x1 + g, mapRect[1], x1 + g + w, mapRect[3]] }); x1 += w + g; }
  const hOf = (type) => (type === 'photo' ? photoDims(MC.photo).h + 2 * Math.max(8, MC.photo.border) : type === 'medal' ? MC.medal.diameter + 36 : sideW(type));
  if (MC.bottom !== 'none') { const h = hOf(MC.bottom); mods.push({ id: 'bottom', type: MC.bottom, rect: [x0, mapRect[1] - g - h, x1, mapRect[1] - g] }); }
  if (MC.top !== 'none') { const h = hOf(MC.top); mods.push({ id: 'top', type: MC.top, rect: [x0, mapRect[3] + g, x1, mapRect[3] + g + h] }); }
  for (const m of mods) m.pockets = [];
  const K = MC.key, depth = K.t + K.depthExtra;
  let keys = 0;
  const warn = [];
  for (let a = 0; a < mods.length; a++) for (let b = a + 1; b < mods.length; b++) {
    const A = mods[a].rect, B = mods[b].rect;
    let seg = null;
    if (Math.abs(A[2] - B[0]) < 1e-6 || Math.abs(B[2] - A[0]) < 1e-6) { // senkrechte Kante
      const left = A[2] <= B[0] + 1e-6 ? mods[a] : mods[b], right = left === mods[a] ? mods[b] : mods[a];
      const y0 = Math.max(A[1], B[1]), y1 = Math.min(A[3], B[3]);
      if (y1 - y0 > 20) seg = { kind: 'v', e: left.rect[2], s0: y0, s1: y1, m1: left, m2: right };
    } else if (Math.abs(A[3] - B[1]) < 1e-6 || Math.abs(B[3] - A[1]) < 1e-6) {
      const low = A[3] <= B[1] + 1e-6 ? mods[a] : mods[b], high = low === mods[a] ? mods[b] : mods[a];
      const x0s = Math.max(A[0], B[0]), x1s = Math.min(A[2], B[2]);
      if (x1s - x0s > 20) seg = { kind: 'h', e: low.rect[3], s0: x0s, s1: x1s, m1: low, m2: high };
    }
    if (!seg) continue;
    const len = seg.s1 - seg.s0;
    const n = Math.max(1, Math.round(len / K.spacing));
    for (let k = 0; k < n; k++) {
      const at = seg.s0 + ((k + 0.5) * len) / n;
      if (seg.kind === 'v') {
        for (const r of keyPockets(K, 'R', at, seg.e)) seg.m1.pockets.push({ rect: r, depth });
        for (const r of keyPockets(K, 'L', at, seg.e)) seg.m2.pockets.push({ rect: r, depth });
      } else {
        for (const r of keyPockets(K, 'T', at, seg.e)) seg.m1.pockets.push({ rect: r, depth });
        for (const r of keyPockets(K, 'B', at, seg.e)) seg.m2.pockets.push({ rect: r, depth });
      }
      keys++;
    }
  }
  // Aufhängung: im obersten, breitesten Modul
  if (MC.hang.on) {
    const topY = Math.max(...mods.map((m) => m.rect[3]));
    const tops = mods.filter((m) => Math.abs(m.rect[3] - topY) < 1e-6).sort((p, q) => (q.rect[2] - q.rect[0]) - (p.rect[2] - p.rect[0]));
    const m = tops[0];
    const w = m.rect[2] - m.rect[0], h = m.rect[3] - m.rect[1];
    const total = Math.max(...mods.map((q) => q.rect[2])) - Math.min(...mods.map((q) => q.rect[0]));
    const cx = (m.rect[0] + m.rect[2]) / 2, cy = (m.rect[1] + m.rect[3]) / 2;
    for (const r of hangPockets(MC.hang, w, h, total > 160 || w > 160 ? 2 : 1)) m.pockets.push({ rect: [r[0] + cx, r[1] + cy, r[2] + cx, r[3] + cy], depth: MC.hang.depth, hang: true });
  }
  return { mods, keys, depth, warn };
}

export function photoDims(P) {
  let [w, h] = P.format !== 'custom' && PHOTO_FORMATS[P.format] ? PHOTO_FORMATS[P.format] : [P.w, P.h];
  if (P.orient === 'landscape') [w, h] = [Math.max(w, h), Math.min(w, h)];
  else [w, h] = [Math.min(w, h), Math.max(w, h)];
  return { w, h };
}
