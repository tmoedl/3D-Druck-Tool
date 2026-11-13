// Teilen von Modellen für den 3D-Druck.
// - Ebener Schnitt durch das geschlossene Netz, wahlweise über die ganze Ebene oder nur an einer Stelle
//   (eine Querschnittsfläche); beide Teile bekommen exakt passende, geschlossene Deckel.
// - Verbinder auf der Schnittfläche: Bohrungen + separate Dübel, feste Zapfen, Magnetbohrungen,
//   Bohrungen, Nut & Feder und Falz (umlaufend, aus einem Abstandsfeld der Schnittfläche).
// - Hilfen zum Finden der Ebene: Kantenzug an einer Kante, dünnster Querschnitt, Ebenen-Fit.
// - Teile für den Druck hinlegen und auf dem Druckbett anordnen.
// Reines JS (Triangulierung über Earcut aus three.js), ohne Oberfläche testbar.
import { ShapeUtils } from '../vendor/three.module.js';
import { edt } from './logo.js';

// ---------------------------------------------------------------- Vektoren
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Ebene: Ursprung O, Normale N (zeigt in Teil 2), Achsen U/W in der Ebene mit U × W = N.
// W ist möglichst „oben“ (Projektion von +Z), damit die Schnittansicht aufrecht steht.
export function makePlane(O, N) {
  N = norm3(N);
  let W = [-N[0] * N[2], -N[1] * N[2], 1 - N[2] * N[2]];
  if (len3(W) < 1e-6) W = [-N[0] * N[1], 1 - N[1] * N[1], -N[2] * N[1]];
  W = norm3(W);
  return { O: O.slice(), N, U: cross3(W, N), W };
}
// Gespiegelter Rahmen für Teil 2: gleiche Fläche, Normale zeigt aus Teil 2 heraus
const mirrorFrame = (P) => ({ O: P.O, U: P.U, W: [-P.W[0], -P.W[1], -P.W[2]], N: [-P.N[0], -P.N[1], -P.N[2]] });

export function vertexDist(V, P) {
  const n = V.length / 3, s = new Float64Array(n), O = P.O, N = P.N;
  for (let v = 0; v < n; v++) s[v] = (V[3 * v] - O[0]) * N[0] + (V[3 * v + 1] - O[1]) * N[1] + (V[3 * v + 2] - O[2]) * N[2];
  return s;
}

export function uv3(p, P) {
  const x = p[0] - P.O[0], y = p[1] - P.O[1], z = p[2] - P.O[2];
  return [x * P.U[0] + y * P.U[1] + z * P.U[2], x * P.W[0] + y * P.W[1] + z * P.W[2]];
}

export function area2D(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

export function pip(u, w, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i][1], yj = pts[j][1];
    if ((yi > w) !== (yj > w) && u < ((pts[j][0] - pts[i][0]) * (w - yi)) / (yj - yi) + pts[i][0]) inside = !inside;
  }
  return inside;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// ---------------------------------------------------------------- Querschnitt (Schnittlinien)
// Strecken der Ebene s = c mit dem Netz in Ebenenkoordinaten (u,w). Orientiert so, dass das Material
// links liegt (Umlauf gegen den Uhrzeigersinn um Material). Punkte mit s == c zählen als „oberhalb“.
export function slice(V, I, P, c = 0, sv = null, tris = null) {
  if (!sv) sv = vertexDist(V, P);
  const nv = V.length / 3, pts = [], segs = [], ids = new Map();
  const { O, U, W } = P;
  const pt = (a, b) => { // a unterhalb, b oberhalb
    const key = a < b ? a * nv + b : b * nv + a;
    let id = ids.get(key);
    if (id === undefined) {
      const f = (c - sv[a]) / (sv[b] - sv[a]);
      const x = V[3 * a] + f * (V[3 * b] - V[3 * a]) - O[0];
      const y = V[3 * a + 1] + f * (V[3 * b + 1] - V[3 * a + 1]) - O[1];
      const z = V[3 * a + 2] + f * (V[3 * b + 2] - V[3 * a + 2]) - O[2];
      id = pts.length / 2;
      pts.push(x * U[0] + y * U[1] + z * U[2], x * W[0] + y * W[1] + z * W[2]);
      ids.set(key, id);
    }
    return id;
  };
  const nt = tris ? tris.length : I.length / 3;
  for (let k = 0; k < nt; k++) {
    const t = tris ? tris[k] : k;
    const a = I[3 * t], b = I[3 * t + 1], d = I[3 * t + 2];
    const pa = sv[a] >= c, pb = sv[b] >= c, pd = sv[d] >= c;
    if (pa === pb && pb === pd) continue;
    let st = -1, en = -1;
    if (pa !== pb) { if (pa) st = pt(b, a); else en = pt(a, b); }
    if (pb !== pd) { if (pb) st = pt(d, b); else en = pt(b, d); }
    if (pd !== pa) { if (pd) st = pt(a, d); else en = pt(d, a); }
    segs.push(st, en);
  }
  return { pts, segs };
}

// Strecken zu geschlossenen Schleifen verketten (offene Ketten werden verworfen)
export function chainLoops(segs, nPts) {
  const next = new Int32Array(nPts).fill(-1);
  for (let i = 0; i < segs.length; i += 2) next[segs[i]] = segs[i + 1];
  const used = new Uint8Array(nPts), loops = [];
  for (let s = 0; s < nPts; s++) {
    if (used[s] || next[s] < 0) continue;
    const loop = [];
    let p = s;
    while (p >= 0 && !used[p]) { used[p] = 1; loop.push(p); p = next[p]; }
    if (p === s && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// Querschnitt als Flächenstücke: [{outer: pts, holes: [pts], area}] (pts = [[u,w],...])
export function sectionRegions(sl) {
  const loops = chainLoops(sl.segs, sl.pts.length / 2).map((l) => l.map((i) => [sl.pts[2 * i], sl.pts[2 * i + 1]]));
  const info = loops.map((pts) => ({ pts, area: area2D(pts) }));
  const outers = info.filter((l) => l.area > 0).map((l) => ({ outer: l.pts, holes: [], area: l.area }));
  for (const h of info) {
    if (h.area >= 0) continue;
    let best = null;
    for (const o of outers) if (o.area > -h.area && (!best || o.area < best.area) && pip(h.pts[0][0], h.pts[0][1], o.outer)) best = o;
    if (best) { best.holes.push(h.pts); best.area += h.area; }
  }
  return outers;
}

export function inRegion(u, w, r) {
  if (!pip(u, w, r.outer)) return false;
  for (const h of r.holes) if (pip(u, w, h)) return false;
  return true;
}

export function regionDist(u, w, r) {
  let d = Infinity;
  for (const L of [r.outer, ...r.holes]) for (let i = 0, j = L.length - 1; i < L.length; j = i++) d = Math.min(d, segDist(u, w, L[j][0], L[j][1], L[i][0], L[i][1]));
  return d;
}

export function regionBox(regs) {
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const r of regs) for (const [u, w] of r.outer) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  return [u0, u1, w0, w1];
}

export function regionSegs(regs) {
  const out = [];
  for (const r of regs) for (const L of [r.outer, ...r.holes]) for (let i = 0, j = L.length - 1; i < L.length; j = i++) out.push(L[j][0], L[j][1], L[i][0], L[i][1]);
  return Float64Array.from(out);
}

// ---------------------------------------------------------------- Strecken-Index (Abstand, innen/außen)
export class SegIndex {
  // S: flach [x1,y1,x2,y2, ...]
  constructor(S) {
    this.S = S;
    const n = S.length / 4;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < S.length; i += 2) { x0 = Math.min(x0, S[i]); x1 = Math.max(x1, S[i]); y0 = Math.min(y0, S[i + 1]); y1 = Math.max(y1, S[i + 1]); }
    if (!n) { x0 = y0 = 0; x1 = y1 = 1; }
    const span = Math.max(x1 - x0, y1 - y0, 1e-6);
    const g = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n) * 1.2)));
    this.cs = span / g;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.gx = Math.max(1, Math.ceil((x1 - x0) / this.cs) + 1);
    this.gy = Math.max(1, Math.ceil((y1 - y0) / this.cs) + 1);
    const cnt = new Int32Array(this.gx * this.gy + 1);
    const range = (i) => {
      const ax = S[4 * i], ay = S[4 * i + 1], bx = S[4 * i + 2], by = S[4 * i + 3];
      return [this.cx(Math.min(ax, bx)), this.cx(Math.max(ax, bx)), this.cy(Math.min(ay, by)), this.cy(Math.max(ay, by))];
    };
    for (let i = 0; i < n; i++) { const [a, b, c, d] = range(i); for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) cnt[y * this.gx + x + 1]++; }
    for (let k = 1; k < cnt.length; k++) cnt[k] += cnt[k - 1];
    const list = new Int32Array(cnt[cnt.length - 1]), fill = cnt.slice(0, -1);
    for (let i = 0; i < n; i++) { const [a, b, c, d] = range(i); for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) list[fill[y * this.gx + x]++] = i; }
    this.start = cnt; this.list = list;
    this.stamp = new Uint32Array(n); this.gen = 0;
  }
  cx(x) { return Math.min(this.gx - 1, Math.max(0, Math.floor((x - this.x0) / this.cs))); }
  cy(y) { return Math.min(this.gy - 1, Math.max(0, Math.floor((y - this.y0) / this.cs))); }
  nextGen() { if (++this.gen > 0xfffffff0) { this.stamp.fill(0); this.gen = 1; } return this.gen; }
  inside(x, y) {
    if (y < this.y0 || y > this.y1 || x > this.x1) return false;
    const S = this.S, g = this.nextGen(), row = this.cy(y);
    let c = false;
    for (let cx = this.cx(x); cx < this.gx; cx++) {
      const k = row * this.gx + cx;
      for (let j = this.start[k]; j < this.start[k + 1]; j++) {
        const i = this.list[j];
        if (this.stamp[i] === g) continue;
        this.stamp[i] = g;
        const ay = S[4 * i + 1], by = S[4 * i + 3];
        if ((ay > y) !== (by > y)) {
          const ax = S[4 * i], bx = S[4 * i + 2];
          if (x < ax + ((bx - ax) * (y - ay)) / (by - ay)) c = !c;
        }
      }
    }
    return c;
  }
  dist(x, y, maxR) {
    const S = this.S, g = this.nextGen();
    let best = maxR;
    const a = this.cx(x - maxR), b = this.cx(x + maxR), c = this.cy(y - maxR), d = this.cy(y + maxR);
    for (let cy = c; cy <= d; cy++) {
      for (let cx = a; cx <= b; cx++) {
        const k = cy * this.gx + cx;
        for (let j = this.start[k]; j < this.start[k + 1]; j++) {
          const i = this.list[j];
          if (this.stamp[i] === g) continue;
          this.stamp[i] = g;
          const dd = segDist(x, y, S[4 * i], S[4 * i + 1], S[4 * i + 2], S[4 * i + 3]);
          if (dd < best) best = dd;
        }
      }
    }
    return best;
  }
  // > 0 innen (Abstand zum Rand), < 0 außen
  clearance(x, y, maxR) { const d = this.dist(x, y, maxR); return this.inside(x, y) ? d : -d; }
}

export function segsFlat(sl) {
  const S = new Float64Array(sl.segs.length * 2), p = sl.pts;
  for (let i = 0; i < sl.segs.length; i += 2) {
    const a = sl.segs[i], b = sl.segs[i + 1];
    S[2 * i] = p[2 * a]; S[2 * i + 1] = p[2 * a + 1]; S[2 * i + 2] = p[2 * b]; S[2 * i + 3] = p[2 * b + 1];
  }
  return S;
}

// Querschnitte in mehreren Tiefen auf beiden Seiten – zum Prüfen, ob Bohrungen im Material bleiben.
// Teil 1 liegt bei s < 0, Teil 2 bei s > 0. Die erste Lage (Tiefe eps) ist die Kontaktfläche.
export function depthSlices(V, I, P, depthA, depthB, eps) {
  const sv = vertexDist(V, P);
  const lo = -depthA - eps, hi = depthB + eps, tris = [];
  for (let t = 0; t < I.length / 3; t++) {
    const a = sv[I[3 * t]], b = sv[I[3 * t + 1]], c = sv[I[3 * t + 2]];
    if (Math.max(a, b, c) >= lo && Math.min(a, b, c) <= hi) tris.push(t);
  }
  const mk = (D, sign) => {
    const n = D > eps ? Math.min(16, Math.max(2, Math.ceil(D / 0.6))) : 0, out = [];
    for (let k = 0; k <= n; k++) {
      const d = k === 0 ? eps : (D * k) / n;
      const sl = slice(V, I, P, sign * d, sv, tris);
      out.push({ depth: d, sl, idx: new SegIndex(segsFlat(sl)) });
    }
    return out;
  };
  return { A: mk(depthA, -1), B: mk(depthB, 1), depthA, depthB };
}

// Kleinster Abstand zum Rand über alle Tiefen bis dA (Teil 1) bzw. dB (Teil 2); < 0 = außerhalb
export function clearanceAt(sl, u, w, dA, dB, maxR) {
  let c = maxR;
  for (let i = 0; i < sl.A.length; i++) { const s = sl.A[i]; if (i && s.depth > dA + 1e-9) break; c = Math.min(c, s.idx.clearance(u, w, maxR)); if (c < 0) return c; }
  for (let i = 0; i < sl.B.length; i++) { const s = sl.B[i]; if (i && s.depth > dB + 1e-9) break; c = Math.min(c, s.idx.clearance(u, w, maxR)); if (c < 0) return c; }
  return c;
}

// ---------------------------------------------------------------- Triangulierung
class P2 {
  constructor(x, y) { this.x = x; this.y = y; }
  equals(o) { return o.x === this.x && o.y === this.y; }
}
// Doppelte Nachbarpunkte entfernen (Earcut verträgt sie schlecht; gleiche Punkte werden später verschweißt)
function dedupe(pts, ids) {
  const P = [], Q = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = P.length ? P[P.length - 1] : null;
    if (q && Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12) continue;
    P.push(p); Q.push(ids[i]);
  }
  while (P.length > 1 && Math.abs(P[0][0] - P[P.length - 1][0]) < 1e-12 && Math.abs(P[0][1] - P[P.length - 1][1]) < 1e-12) { P.pop(); Q.pop(); }
  return [P, Q];
}

// Fläche (Außenkontur gegen, Löcher im Uhrzeigersinn) triangulieren; Dreiecke gegen den Uhrzeigersinn
function triangulate(outer, outerIds, holes, holeIds, emit) {
  const [op, oi] = dedupe(outer, outerIds);
  if (op.length < 3) return;
  const allIds = oi.slice(), all2 = op.slice(), hs = [];
  for (let k = 0; k < holes.length; k++) {
    const [hp, hi] = dedupe(holes[k], holeIds[k]);
    if (hp.length < 3) continue;
    hs.push(hp.map((p) => new P2(p[0], p[1])));
    allIds.push(...hi); all2.push(...hp);
  }
  const faces = ShapeUtils.triangulateShape(op.map((p) => new P2(p[0], p[1])), hs);
  for (const [a, b, c] of faces) {
    const pa = all2[a], pb = all2[b], pc = all2[c];
    const cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (cr < 0) emit(allIds[a], allIds[c], allIds[b]); else emit(allIds[a], allIds[b], allIds[c]);
  }
}

// ---------------------------------------------------------------- Deckel mit Verbindern
// F: Rahmen der Seite (N zeigt aus dem Teil heraus). secLoops: Schnittkonturen [{ids, pts}]
// (außen gegen, Löcher im Uhrzeigersinn). feats: [{rings: [{pts, h}, ...]}] – ring[0] liegt in der
// umgebenden Fläche, der letzte Ring begrenzt die eigene Fläche (Boden/Kopf) in Höhe h.
function buildCap(out, F, secLoops, feats, slot, tag) {
  const { O, U, W, N } = F;
  const loops = [];
  for (const l of secLoops) loops.push({ sec: true, ids: l.ids, pts: l.pts, area: area2D(l.pts) });
  for (const f of feats) {
    let rings = f.rings.map((r) => ({ pts: r.pts, h: r.h }));
    if (rings[0].pts.length < 3) continue;
    if (area2D(rings[0].pts) < 0) {
      const rev = new Map();
      rings = rings.map((r) => { if (!rev.has(r.pts)) rev.set(r.pts, r.pts.slice().reverse()); return { pts: rev.get(r.pts), h: r.h }; });
    }
    loops.push({ sec: false, rings, pts: rings[0].pts, area: area2D(rings[0].pts) });
  }
  const bound = (L) => (L.sec ? L.pts : L.rings[L.rings.length - 1].pts);
  for (const L of loops) {
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const [u, w] of bound(L)) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    L.box = [u0, u1, w0, w1];
    L.abs = Math.abs(L.area);
    L.children = [];
    L.parent = null;
  }
  for (const L of loops) {
    const [pu, pw] = L.pts[0];
    for (const M of loops) {
      if (M === L || M.abs <= L.abs) continue;
      if (pu < M.box[0] || pu > M.box[1] || pw < M.box[2] || pw > M.box[3]) continue;
      if (L.parent && M.abs >= L.parent.abs) continue;
      if (pip(pu, pw, bound(M))) L.parent = M;
    }
  }
  for (const L of loops) if (L.parent) L.parent.children.push(L);
  const faceH = (L) => (L.sec ? 0 : L.rings[L.rings.length - 1].h);
  const material = (L) => !L.sec || L.area > 0;
  // Verbinder ohne passende Fläche (außerhalb, im Loch) weglassen
  for (const L of loops) {
    if (L.sec) { L.ok = true; continue; }
    let p = L.parent;
    while (p && !p.sec) p = p.parent;
    L.ok = !!p && material(p);
  }
  for (const L of loops) if (!L.sec && L.ok) { let p = L.parent; while (p && !p.sec) { if (!p.ok) L.ok = false; p = p.parent; } }
  const vid = (u, w, h) => {
    const id = out.V.length / 3;
    out.V.push(O[0] + u * U[0] + w * W[0] + h * N[0], O[1] + u * U[1] + w * W[1] + h * N[1], O[2] + u * U[2] + w * W[2] + h * N[2]);
    return id;
  };
  const emit = (a, b, c) => { out.I.push(a, b, c); out.C.push(slot); out.tag.push(tag); };
  let skipped = 0, placed = 0;
  for (const L of loops) {
    if (L.sec) continue;
    if (!L.ok) { skipped++; continue; }
    placed++;
    L.rings[0].h = faceH(L.parent);
    L.ringIds = [];
    for (let k = 0; k < L.rings.length; k++) {
      const r = L.rings[k], prev = k && L.rings[k - 1];
      L.ringIds.push(prev && prev.h === r.h && prev.pts === r.pts ? L.ringIds[k - 1] : r.pts.map(([u, w]) => vid(u, w, r.h)));
    }
  }
  // Flächen
  for (const L of loops) {
    if (!material(L) || !L.ok) continue;
    const oPts = L.sec ? L.pts : L.rings[L.rings.length - 1].pts;
    const oIds = L.sec ? L.ids : L.ringIds[L.ringIds.length - 1];
    const hP = [], hI = [];
    for (const c of L.children) {
      if (!c.ok) continue;
      if (c.sec) { if (c.area < 0) { hP.push(c.pts); hI.push(c.ids); } }
      else { hP.push(c.rings[0].pts.slice().reverse()); hI.push(c.ringIds[0].slice().reverse()); }
    }
    triangulate(oPts, oIds, hP, hI, emit);
  }
  // Wände der Verbinder
  for (const L of loops) {
    if (L.sec || !L.ok) continue;
    for (let k = 0; k + 1 < L.rings.length; k++) {
      const A = L.ringIds[k], B = L.ringIds[k + 1];
      if (A === B) continue;
      const up = L.rings[k + 1].h > L.rings[k].h; // Material innen (Zapfen) – sonst außen (Bohrung)
      const lo = up ? A : B, hi = up ? B : A, n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (up) { emit(lo[i], lo[j], hi[j]); emit(lo[i], hi[j], hi[i]); }
        else { emit(lo[i], hi[j], lo[j]); emit(lo[i], hi[i], hi[j]); }
      }
    }
  }
  return { skipped, placed };
}

// ---------------------------------------------------------------- Schnitt
// V0/I0/C0: indiziertes Netz. P: Ebene. opt:
//   snap     – Punkte näher als snap an der Ebene werden auf sie gezogen (keine Splitter)
//   localPts – nur die Schnittfläche(n) an diesen Punkten schneiden, sonst die ganze Ebene
//   featA/featB – Verbinder je Seite in Ebenenkoordinaten (u,w) von P, Höhe nach außen positiv
//   capSlot  – Filament der Schnittflächen (-1 = wie angrenzend), gap – Teil 2 so weit verschieben
export function cutMesh(V0, I0, C0, P, opt = {}) {
  const { snap = 0.002, localPts = null, featA = [], featB = [], capSlot = -1, gap = 0 } = opt;
  const { O, N } = P;
  const V = Array.from(V0), nv0 = V.length / 3;
  const s = Array.from(vertexDist(V0, P));
  for (let v = 0; v < nv0; v++) {
    if (s[v] !== 0 && Math.abs(s[v]) < snap) {
      V[3 * v] -= s[v] * N[0]; V[3 * v + 1] -= s[v] * N[1]; V[3 * v + 2] -= s[v] * N[2];
      s[v] = 0;
    }
  }
  const I = [], C = [], side = [];
  const emap = new Map();
  const edgePt = (a, b) => {
    const key = a < b ? a * nv0 + b : b * nv0 + a;
    let id = emap.get(key);
    if (id === undefined) {
      const p = s[a] < 0 ? a : b, q = p === a ? b : a, f = s[p] / (s[p] - s[q]);
      let x = V[3 * p] + f * (V[3 * q] - V[3 * p]), y = V[3 * p + 1] + f * (V[3 * q + 1] - V[3 * p + 1]), z = V[3 * p + 2] + f * (V[3 * q + 2] - V[3 * p + 2]);
      const d = (x - O[0]) * N[0] + (y - O[1]) * N[1] + (z - O[2]) * N[2];
      x -= d * N[0]; y -= d * N[1]; z -= d * N[2];
      id = V.length / 3;
      V.push(x, y, z); s.push(0);
      emap.set(key, id);
    }
    return id;
  };
  const add = (a, b, c, sd, col) => { I.push(a, b, c); C.push(col); side.push(sd); };
  const nt0 = I0.length / 3;
  let coplanar = 0;
  for (let t = 0; t < nt0; t++) {
    const v = [I0[3 * t], I0[3 * t + 1], I0[3 * t + 2]], col = C0[t];
    const sg = v.map((x) => (s[x] > 0 ? 1 : s[x] < 0 ? -1 : 0));
    const pos = (sg[0] > 0) + (sg[1] > 0) + (sg[2] > 0), neg = (sg[0] < 0) + (sg[1] < 0) + (sg[2] < 0);
    if (!pos || !neg) {
      let sd = pos ? 1 : -1;
      if (!pos && !neg) {
        const a = 3 * v[0], b = 3 * v[1], c = 3 * v[2];
        const n = cross3([V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]);
        sd = dot3(n, N) > 0 ? -1 : 1; // Fläche in der Ebene: nach Teil 2 zeigend gehört sie zu Teil 1
        coplanar++;
      }
      add(v[0], v[1], v[2], sd, col);
      continue;
    }
    if (pos + neg === 2) {
      const k = sg[0] === 0 ? 0 : sg[1] === 0 ? 1 : 2;
      const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], m = edgePt(b, c);
      add(a, b, m, sg[(k + 1) % 3], col);
      add(a, m, c, sg[(k + 2) % 3], col);
    } else {
      const k = sg[0] !== sg[1] && sg[0] !== sg[2] ? 0 : sg[1] !== sg[0] && sg[1] !== sg[2] ? 1 : 2;
      const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3];
      const m1 = edgePt(a, b), m2 = edgePt(c, a);
      add(a, m1, m2, sg[k], col);
      add(m1, b, c, sg[(k + 1) % 3], col);
      add(m1, c, m2, sg[(k + 1) % 3], col);
    }
  }
  // Schnittkanten: Kanten in der Ebene zwischen Teil 1 und Teil 2
  const NV = V.length / 3, key = (x, y) => x * NV + y;
  const eA = new Map(), eB = new Set();
  const nt = I.length / 3;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const x = I[3 * t + k], y = I[3 * t + (k + 1) % 3];
      if (s[x] !== 0 || s[y] !== 0) continue;
      if (side[t] < 0) eA.set(key(x, y), t); else eB.add(key(x, y));
    }
  }
  const next = new Map(), colCount = new Map();
  for (const [k, t] of eA) {
    const x = Math.floor(k / NV), y = k - x * NV;
    if (!eB.has(key(y, x)) || eA.has(key(y, x))) continue;
    next.set(y, x); // Deckel von Teil 1 läuft entgegen der Kante: y -> x
    colCount.set(C[t], (colCount.get(C[t]) || 0) + 1);
  }
  const loops = [], used = new Set();
  for (const st of next.keys()) {
    if (used.has(st)) continue;
    const ids = [];
    let p = st;
    while (p !== undefined && !used.has(p)) { used.add(p); ids.push(p); p = next.get(p); }
    if (p === st && ids.length >= 3) loops.push(ids);
  }
  const uv = (v) => uv3([V[3 * v], V[3 * v + 1], V[3 * v + 2]], P);
  const L = loops.map((ids) => { const pts = ids.map(uv); return { ids, pts, area: area2D(pts) }; });
  // Flächenstücke (Außenkontur + Löcher)
  const regs = [];
  for (const l of L) if (l.area > 0) regs.push({ outer: l, holes: [], area: l.area });
  for (const l of L) {
    if (l.area >= 0) continue;
    let best = null;
    for (const r of regs) if (r.area > -l.area && (!best || r.area < best.area) && pip(l.pts[0][0], l.pts[0][1], r.outer.pts)) best = r;
    if (best) best.holes.push(l);
  }
  let sel = regs;
  if (localPts && localPts.length) {
    const pick = new Set();
    for (const p of localPts) {
      const [pu, pw] = uv3(p, P);
      let best = null, bd = Infinity;
      for (const r of regs) {
        if (inRegionL(pu, pw, r)) { best = r; break; }
        for (const l of [r.outer, ...r.holes]) {
          for (let i = 0, j = l.pts.length - 1; i < l.pts.length; j = i++) {
            const d = segDist(pu, pw, l.pts[j][0], l.pts[j][1], l.pts[i][0], l.pts[i][1]);
            if (d < bd) { bd = d; best = r; }
          }
        }
      }
      if (best) pick.add(best);
    }
    sel = regs.filter((r) => pick.has(r));
  }
  if (!sel.length) return { error: regs.length ? 'Keine Schnittfläche an der gewählten Stelle.' : 'Die Ebene schneidet das Modell nicht (oder das Netz ist dort offen).' };
  // Teil 2 bekommt eigene Punkte auf den gewählten Konturen
  const dup = new Map();
  for (const r of sel) for (const l of [r.outer, ...r.holes]) for (const v of l.ids) {
    if (dup.has(v)) continue;
    dup.set(v, V.length / 3);
    V.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]);
  }
  for (let t = 0; t < nt; t++) {
    if (side[t] < 0) continue;
    for (let k = 0; k < 3; k++) { const d = dup.get(I[3 * t + k]); if (d !== undefined) I[3 * t + k] = d; }
  }
  // Deckel
  let slot = capSlot;
  if (slot < 0) { let bc = -1; for (const [c, n] of colCount) if (n > bc) { bc = n; slot = c; } if (slot < 0) slot = 0; }
  const out = { V, I, C, tag: new Array(nt).fill(0) };
  const PB = mirrorFrame(P);
  const mir = (f) => ({ rings: f.rings.map((r) => ({ pts: r.pts.map(([u, w]) => [u, -w]), h: r.h })) });
  let skipped = 0, placed = 0;
  for (const r of sel) {
    const inR = (f) => { const [u, w] = f.rings[0].pts[0]; return inRegionL(u, w, r); };
    const secA = [r.outer, ...r.holes].map((l) => ({ ids: l.ids, pts: l.pts }));
    const a = buildCap(out, P, secA, featA.filter(inR), slot, 1);
    const secB = [r.outer, ...r.holes].map((l) => ({ ids: l.ids.slice().reverse().map((v) => dup.get(v)), pts: l.pts.slice().reverse().map(([u, w]) => [u, -w]) }));
    const b = buildCap(out, PB, secB, featB.filter(inR).map(mir), slot, 2);
    skipped += a.skipped + b.skipped; placed += a.placed + b.placed;
  }
  // Teile bestimmen; abgetrennte Teile auf Seite 2 verschieben
  const nT = out.I.length / 3;
  const comp = triComponents(out.I, out.V.length / 3);
  const capA = new Set(), capB = new Set();
  for (let t = nt; t < nT; t++) (out.tag[t] === 1 ? capA : capB).add(comp.id[t]);
  let notSeparated = 0;
  for (const c of capA) if (capB.has(c)) notSeparated++;
  if (gap) {
    const moved = new Uint8Array(out.V.length / 3);
    for (let t = 0; t < nT; t++) {
      const c = comp.id[t];
      if (!capB.has(c) || capA.has(c)) continue;
      for (let k = 0; k < 3; k++) {
        const v = out.I[3 * t + k];
        if (moved[v]) continue;
        moved[v] = 1;
        out.V[3 * v] += gap * N[0]; out.V[3 * v + 1] += gap * N[1]; out.V[3 * v + 2] += gap * N[2];
      }
    }
  }
  return { V: out.V, I: out.I, C: out.C, tag: out.tag, side, nOrig: nt, regions: sel.length, coplanar, skipped, placed, notSeparated, parts: comp.count };
}

function inRegionL(u, w, r) {
  if (!pip(u, w, r.outer.pts)) return false;
  for (const h of r.holes) if (pip(u, w, h.pts)) return false;
  return true;
}

// Zusammenhängende Teile über gemeinsame Punkte
export function triComponents(I, nv) {
  const par = new Int32Array(nv);
  for (let i = 0; i < nv; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const nt = I.length / 3;
  for (let t = 0; t < nt; t++) {
    const a = find(I[3 * t]), b = find(I[3 * t + 1]);
    if (a !== b) par[a] = b;
    const c = find(I[3 * t + 2]), r = find(b);
    if (c !== r) par[c] = r;
  }
  const map = new Map(), id = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    const r = find(I[3 * t]);
    let k = map.get(r);
    if (k === undefined) { k = map.size; map.set(r, k); }
    id[t] = k;
  }
  return { id, count: map.size };
}

export function toPos(V, I) {
  const pos = new Float32Array(I.length * 3);
  for (let i = 0; i < I.length; i++) { const v = I[i]; pos[3 * i] = V[3 * v]; pos[3 * i + 1] = V[3 * v + 1]; pos[3 * i + 2] = V[3 * v + 2]; }
  return pos;
}

// ---------------------------------------------------------------- Verbinder
export const CONNECTORS = {
  none: 'Keine – nur teilen (z. B. kleben)',
  dowel: 'Bohrungen + Dübel (separat gedruckt)',
  pinA: 'Zapfen fest an Teil 1, Loch in Teil 2',
  pinB: 'Zapfen fest an Teil 2, Loch in Teil 1',
  magnet: 'Magnet-Bohrungen',
  holes: 'Nur Bohrungen (Schrauben, Gewindeeinsätze, Stifte)',
  tongue: 'Nut & Feder (umlaufend)',
  rabbet: 'Falz / Zentrierabsatz (umlaufend)',
};
export const SHAPES = { round: 'rund', hex: 'sechseckig (verdrehsicher)', square: 'quadratisch (verdrehsicher)' };

export function defaultConnParams() {
  return {
    type: 'dowel', count: 0, wall: 1.2, shape: 'round',
    d: 5, len: 14, clear: 0.15, extra: 0.6, chamfer: 0.5, holeChamfer: 0.4, split: 50, flat: 0.6, lying: true,
    pinH: 6,
    magD: 6, magH: 3, magClear: 0.1, magExtra: 0.2, magSide: 'both',
    holeD: 3.2, holeDepthA: 8, holeDepthB: 8,
    tEdge: 1.6, tWidth: 2, tHeight: 3, tClear: 0.2, tExtra: 0.4, tSide: 'A',
  };
}
export const isRegionType = (t) => t === 'tongue' || t === 'rabbet';
export const isPointType = (t) => t === 'dowel' || t === 'pinA' || t === 'pinB' || t === 'magnet' || t === 'holes';

// Eckenzahl: rund ~0,35 mm Kantenlänge; alle Ringe eines Verbinders brauchen dieselbe Zahl
const polySides = (r, shape) => (shape === 'hex' ? 6 : shape === 'square' ? 4 : Math.min(96, Math.max(28, Math.ceil((2 * Math.PI * r) / 0.35))));
export function polyPts(cu, cw, r, shape, rot = 0, n = polySides(r, shape)) {
  const R = r / Math.cos(Math.PI / n), off = shape === 'round' ? 0 : Math.PI / n;
  const out = [];
  for (let i = 0; i < n; i++) { const a = rot + off + (i / n) * Math.PI * 2; out.push([cu + R * Math.cos(a), cw + R * Math.sin(a)]); }
  return out;
}
function holeRings(cu, cw, r, depth, ch, shape, rot) {
  ch = Math.max(0, Math.min(ch, depth * 0.45));
  const n = polySides(r + ch, shape), inner = polyPts(cu, cw, r, shape, rot, n);
  return ch > 0
    ? [{ pts: polyPts(cu, cw, r + ch, shape, rot, n), h: 0 }, { pts: inner, h: -ch }, { pts: inner, h: -depth }]
    : [{ pts: inner, h: 0 }, { pts: inner, h: -depth }];
}
function pinRings(cu, cw, r, H, ch, shape, rot) {
  ch = Math.max(0, Math.min(ch, H * 0.45, r * 0.6));
  const n = polySides(r, shape), base = polyPts(cu, cw, r, shape, rot, n);
  return ch > 0
    ? [{ pts: base, h: 0 }, { pts: base, h: H - ch }, { pts: polyPts(cu, cw, r - ch, shape, rot, n), h: H }]
    : [{ pts: base, h: 0 }, { pts: base, h: H }];
}

// Was ein Verbinder je Seite braucht: Radius am Schnitt (rMax) und Bohrtiefe dA/dB (für die Prüfung)
export function connNeeds(p) {
  const hc = p.holeChamfer;
  switch (p.type) {
    case 'dowel': {
      const f = p.split / 100;
      return { dA: p.len * f + p.extra, dB: p.len * (1 - f) + p.extra, rMax: p.d / 2 + p.clear + hc };
    }
    case 'pinA': return { dA: 0, dB: p.pinH + p.extra, rMax: p.d / 2 + p.clear + hc };
    case 'pinB': return { dA: p.pinH + p.extra, dB: 0, rMax: p.d / 2 + p.clear + hc };
    case 'magnet': {
      const d = p.magH + p.magExtra;
      return { dA: p.magSide === 'B' ? 0 : d, dB: p.magSide === 'A' ? 0 : d, rMax: p.magD / 2 + p.magClear + hc };
    }
    case 'holes': return { dA: p.holeDepthA, dB: p.holeDepthB, rMax: p.holeD / 2 + hc };
    case 'tongue': case 'rabbet': {
      const H = p.tHeight + p.tExtra;
      return { dA: p.tSide === 'A' ? 0 : H, dB: p.tSide === 'A' ? H : 0, rMax: 0 };
    }
    default: return { dA: 0, dB: 0, rMax: 0 };
  }
}

// Ein Verbinder an (u,w) -> Ringe für Teil 1 und Teil 2 (beide in Ebenenkoordinaten von Teil 1)
export function connFeatures(c, p) {
  const sh = p.shape, rot = c.rot || 0, A = [], B = [];
  const hole = (r, d, shape = sh) => ({ rings: holeRings(c.u, c.w, r, d, p.holeChamfer, shape, rot) });
  switch (p.type) {
    case 'dowel': {
      const r = p.d / 2 + p.clear, f = p.split / 100;
      A.push(hole(r, p.len * f + p.extra));
      B.push(hole(r, p.len * (1 - f) + p.extra));
      break;
    }
    case 'pinA':
      A.push({ rings: pinRings(c.u, c.w, p.d / 2, p.pinH, p.chamfer, sh, rot) });
      B.push(hole(p.d / 2 + p.clear, p.pinH + p.extra));
      break;
    case 'pinB':
      B.push({ rings: pinRings(c.u, c.w, p.d / 2, p.pinH, p.chamfer, sh, rot) });
      A.push(hole(p.d / 2 + p.clear, p.pinH + p.extra));
      break;
    case 'magnet': {
      const r = p.magD / 2 + p.magClear, d = p.magH + p.magExtra;
      if (p.magSide !== 'B') A.push(hole(r, d, 'round'));
      if (p.magSide !== 'A') B.push(hole(r, d, 'round'));
      break;
    }
    case 'holes':
      if (p.holeDepthA > 0) A.push(hole(p.holeD / 2, p.holeDepthA));
      if (p.holeDepthB > 0) B.push(hole(p.holeD / 2, p.holeDepthB));
      break;
  }
  return { A, B };
}

// Automatische Verteilung in den Schnittflächen: Punkte mit genug Wand über die ganze Tiefe,
// gleichmäßig verteilt (k-Means über die zulässigen Punkte). count 0 = automatisch nach Fläche/Form.
export function autoPlace(regs, slices, needs, prm) {
  const out = [];
  const req = needs.rMax + prm.wall;
  for (const r of regs) {
    const [u0, u1, w0, w1] = regionBox([r]);
    const step = Math.max(Math.sqrt(r.area / 2500), (u1 - u0 + w1 - w0) / 500, 0.05);
    const cand = [];
    for (let w = w0 + step / 2; w < w1; w += step) {
      for (let u = u0 + step / 2; u < u1; u += step) {
        if (!inRegion(u, w, r)) continue;
        const c = Math.min(clearanceAt(slices, u, w, needs.dA, needs.dB, req * 3), regionDist(u, w, r));
        if (c >= req) cand.push([u, w, c]);
      }
    }
    if (!cand.length) continue;
    let k = prm.count;
    if (k <= 0) {
      k = Math.max(1, Math.min(6, Math.round(Math.sqrt(r.area) / (needs.rMax * 9))));
      if (k === 1) {
        // länglich oder rund (verdrehbar)? Dann zwei
        let su = 0, sw = 0;
        for (const p of cand) { su += p[0]; sw += p[1]; }
        su /= cand.length; sw /= cand.length;
        let cuu = 0, cww = 0, cuw = 0;
        for (const p of cand) { cuu += (p[0] - su) ** 2; cww += (p[1] - sw) ** 2; cuw += (p[0] - su) * (p[1] - sw); }
        cuu /= cand.length; cww /= cand.length; cuw /= cand.length;
        const tr = cuu + cww, det = cuu * cww - cuw * cuw, l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
        const spread = 2 * Math.sqrt(3 * l1); // Länge der zulässigen Fläche entlang der Hauptachse
        const round = prm.type === 'magnet' || prm.shape === 'round';
        if (spread > (round ? 1.2 * (2 * needs.rMax + prm.wall) : needs.rMax * 8)) k = 2;
      }
    }
    k = Math.min(k, cand.length);
    let centers = [cand.reduce((a, b) => (b[2] > a[2] ? b : a))];
    while (centers.length < k) {
      let best = null, bd = -1;
      for (const p of cand) { let d = Infinity; for (const c of centers) d = Math.min(d, Math.hypot(p[0] - c[0], p[1] - c[1])); if (d > bd) { bd = d; best = p; } }
      centers.push(best);
    }
    centers = centers.map((c) => [c[0], c[1]]);
    for (let it = 0; it < 15 && k > 1; it++) {
      const acc = centers.map(() => [0, 0, 0]);
      for (const p of cand) {
        let bi = 0, bd = Infinity;
        centers.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
        acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2]++;
      }
      centers = centers.map((c, i) => (acc[i][2] ? [acc[i][0] / acc[i][2], acc[i][1] / acc[i][2]] : c));
    }
    // auf zulässige Punkte ziehen (bei einem einzelnen: möglichst viel Wand), Mindestabstand
    const minD = 2 * needs.rMax + prm.wall;
    const placed = [];
    for (const c of centers) {
      let best = null, bd = Infinity;
      for (const p of cand) {
        if (placed.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < minD)) continue;
        const d = k === 1 ? -p[2] : Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) placed.push(best);
    }
    for (const p of placed) out.push({ u: p[0], w: p[1], rot: 0 });
  }
  return out;
}

// Prüfung eines Verbinders: {ok, why}
export function checkConn(c, regs, slices, needs, prm, all) {
  if (!regs.some((r) => inRegion(c.u, c.w, r))) return { ok: false, why: 'liegt nicht auf der Schnittfläche' };
  const req = needs.rMax + prm.wall;
  let cl = clearanceAt(slices, c.u, c.w, needs.dA, needs.dB, req * 2);
  for (const r of regs) if (inRegion(c.u, c.w, r)) cl = Math.min(cl, regionDist(c.u, c.w, r));
  if (cl < req) return { ok: false, why: cl < needs.rMax ? 'ragt aus dem Modell heraus' : `Wand nur ${Math.max(0, cl - needs.rMax).toFixed(1).replace('.', ',')} mm` };
  for (const o of all) if (o !== c && Math.hypot(o.u - c.u, o.w - c.w) < 2 * needs.rMax + prm.wall * 0.5) return { ok: false, why: 'zu nah am nächsten Verbinder' };
  return { ok: true, why: '' };
}

// ---------------------------------------------------------------- Umlaufende Verbinder (Abstandsfeld)
// Kontaktfläche (Schnittmenge aller Streckenlisten) rastern und den Abstand zum Rand bestimmen.
export function distanceField(segLists, box, res) {
  const pad = 3 * res;
  const u0 = box[0] - pad, w0 = box[2] - pad;
  const gw = Math.max(4, Math.ceil((box[1] - box[0] + 2 * pad) / res)), gh = Math.max(4, Math.ceil((box[3] - box[2] + 2 * pad) / res));
  const mask = new Uint8Array(gw * gh).fill(1);
  for (const S of segLists) {
    const m = new Uint8Array(gw * gh), rows = Array.from({ length: gh }, () => []);
    for (let i = 0; i < S.length; i += 4) {
      const ay = S[i + 1], by = S[i + 3];
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - w0) / res - 0.5)), j1 = Math.min(gh - 1, Math.floor((Math.max(ay, by) - w0) / res - 0.5));
      for (let j = j0; j <= j1; j++) rows[j].push(i);
    }
    for (let j = 0; j < gh; j++) {
      const y = w0 + (j + 0.5) * res, xs = [];
      for (const i of rows[j]) {
        const ax = S[i], ay = S[i + 1], bx = S[i + 2], by = S[i + 3];
        if ((ay > y) !== (by > y)) xs.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - u0) / res - 0.5)), i1 = Math.min(gw - 1, Math.floor((xs[k + 1] - u0) / res - 0.5));
        for (let i = i0; i <= i1; i++) m[j * gw + i] = 1;
      }
    }
    for (let k = 0; k < mask.length; k++) mask[k] &= m[k];
  }
  const fin = new Float64Array(gw * gh), fout = new Float64Array(gw * gh);
  for (let k = 0; k < mask.length; k++) { fin[k] = mask[k] ? 1e20 : 0; fout[k] = mask[k] ? 0 : 1e20; }
  edt(fin, gw, gh); edt(fout, gw, gh);
  const F = new Float64Array(gw * gh);
  let max = 0;
  for (let k = 0; k < F.length; k++) { F[k] = mask[k] ? Math.sqrt(fin[k]) * res - res / 2 : -(Math.sqrt(fout[k]) * res - res / 2); if (F[k] > max) max = F[k]; }
  return { F, gw, gh, u0, w0, res, max };
}

// Konturen des Feldes bei Wert L; der Bereich mit größerem Wert liegt links (gegen den Uhrzeigersinn)
export function contours(fd, L) {
  const { F, gw, gh, u0, w0, res } = fd;
  const at = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh ? -1e9 : F[j * gw + i]);
  const pts = new Map(), next = new Map();
  const W1 = gw + 2;
  const eid = (i, j, vert) => 2 * ((j + 1) * W1 + (i + 1)) + (vert ? 1 : 0);
  const point = (id, i, j, vert) => {
    if (pts.has(id)) return;
    const a = at(i, j), b = vert ? at(i, j + 1) : at(i + 1, j);
    const t = (L - a) / (b - a);
    pts.set(id, vert ? [u0 + (i + 0.5) * res, w0 + (j + 0.5 + t) * res] : [u0 + (i + 0.5 + t) * res, w0 + (j + 0.5) * res]);
  };
  for (let j = -1; j < gh; j++) {
    for (let i = -1; i < gw; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const hi = v.map((x) => x >= L);
      if (hi[0] === hi[1] && hi[1] === hi[2] && hi[2] === hi[3]) continue;
      // Kanten gegen den Uhrzeigersinn: unten, rechts, oben, links
      const E = [[eid(i, j, false), i, j, false], [eid(i + 1, j, true), i + 1, j, true], [eid(i, j + 1, false), i, j + 1, false], [eid(i, j, true), i, j, true]];
      const cr = [];
      for (let k = 0; k < 4; k++) if (hi[k] !== hi[(k + 1) % 4]) { cr.push({ k, down: hi[k] }); point(E[k][0], E[k][1], E[k][2], E[k][3]); }
      const centerHi = (v[0] + v[1] + v[2] + v[3]) / 4 >= L;
      for (let q = 0; q < cr.length; q++) {
        if (!cr[q].down) continue;
        const o = centerHi || cr.length === 2 ? cr[(q + 1) % cr.length] : cr[(q - 1 + cr.length) % cr.length];
        next.set(E[cr[q].k][0], E[o.k][0]);
      }
    }
  }
  const loops = [], used = new Set();
  for (const st of next.keys()) {
    if (used.has(st)) continue;
    const loop = [];
    let p = st;
    while (p !== undefined && !used.has(p)) { used.add(p); loop.push(pts.get(p)); p = next.get(p); }
    if (p === st && loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// Douglas-Peucker für geschlossene Polygone
export function simplifyLoop(pts, tol) {
  if (pts.length < 8) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const keep = [0, far];
  const dp = (a, b) => {
    const B = pts[b % pts.length];
    let idx = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], B[0], B[1]); if (d > md) { md = d; idx = i; } }
    if (idx >= 0) { keep.push(idx); dp(a, idx); dp(idx, b); }
  };
  dp(0, far); dp(far, pts.length);
  keep.sort((a, b) => a - b);
  return keep.map((i) => pts[i]);
}

// Band zwischen Abstand d1 und d2 (d2 = Infinity: bis zur Mitte) als Ringe mit Höhe H
export function bandFeatures(fd, d1, d2, H) {
  const feats = [], tol = fd.res * 0.3, minA = fd.res * fd.res * 6;
  const mk = (level, inner) => {
    for (const raw of contours(fd, level)) {
      const pts = simplifyLoop(raw, tol);
      const a = area2D(pts);
      if (Math.abs(a) < minA || pts.length < 3) continue;
      const highInside = a > 0;
      // d1: höhere Seite liegt im Band (H); d2: höhere Seite liegt jenseits des Bandes (0)
      const hIn = inner ? (highInside ? 0 : H) : (highInside ? H : 0);
      feats.push({ rings: [{ pts, h: H - hIn }, { pts, h: hIn }], level });
    }
  };
  mk(d1, false);
  if (isFinite(d2)) mk(d2, true);
  return feats;
}

// Umlaufender Verbinder: Feder (bzw. Absatz) auf der einen, Nut auf der anderen Seite
export function bandConnector(fd, p) {
  const e = p.tEdge, w = p.type === 'rabbet' ? Infinity : p.tWidth, cl = p.tClear;
  const tongue = bandFeatures(fd, e, e + w, p.tHeight);
  const groove = bandFeatures(fd, Math.max(0.01, e - cl), e + w + cl, -(p.tHeight + p.tExtra));
  return p.tSide === 'A' ? { A: tongue, B: groove } : { A: groove, B: tongue };
}

// ---------------------------------------------------------------- Dübel
// Stehend: Achse Z von 0 bis len. Liegend (optional abgeflacht): Achse X, flache Seite unten.
export function dowelMesh(p) {
  const r = p.d / 2, L = p.len, ch = Math.max(0, Math.min(p.chamfer, r * 0.5, L / 4));
  const ring = (rr) => polyPts(0, 0, rr, p.shape, 0, polySides(r, p.shape));
  const rings = ch > 0 ? [[ring(r - ch), 0], [ring(r), ch], [ring(r), L - ch], [ring(r - ch), L]] : [[ring(r), 0], [ring(r), L]];
  const V = [], I = [];
  const ids = rings.map(([pts, h]) => pts.map(([x, y]) => { V.push(x, y, h); return V.length / 3 - 1; }));
  const n = ids[0].length;
  for (let k = 0; k + 1 < ids.length; k++) {
    const lo = ids[k], hi = ids[k + 1];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; I.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]); }
  }
  const bot = ids[0], top = ids[ids.length - 1];
  for (let i = 1; i + 1 < n; i++) { I.push(bot[0], bot[i + 1], bot[i]); I.push(top[0], top[i], top[i + 1]); }
  if (!p.lying) return { V, I };
  // liegend: (x,y,z) -> (z, x, y), dann unten abflachen
  for (let i = 0; i < V.length; i += 3) { const x = V[i], y = V[i + 1], z = V[i + 2]; V[i] = z; V[i + 1] = x; V[i + 2] = y; }
  const flat = Math.max(0, Math.min(p.flat || 0, r * 0.6));
  if (flat > 0) {
    const res = cutMesh(V, I, new Array(I.length / 3).fill(0), makePlane([0, 0, -(r - flat)], [0, 0, 1]), { snap: 1e-6 });
    if (!res.error) {
      const I2 = [];
      for (let t = 0; t < res.I.length / 3; t++) if (t < res.nOrig ? res.side[t] > 0 : res.tag[t] === 2) I2.push(res.I[3 * t], res.I[3 * t + 1], res.I[3 * t + 2]);
      return { V: res.V, I: I2 };
    }
  }
  return { V, I };
}

// ---------------------------------------------------------------- Kantenzug an einer Kante
// Merkmalskanten (Knickwinkel > angle) eines PaintMesh: je Punkt die Nachbarpunkte
const featCache = new WeakMap();
function featureGraph(pm, angleDeg) {
  let c = featCache.get(pm);
  if (c && c.angle === angleDeg && c.idx === pm.idx) return c;
  const cosT = Math.cos((angleDeg * Math.PI) / 180), nb = pm.nb, fn = pm.fn, idx = pm.idx;
  const adj = new Map();
  const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, (l = [])); if (!l.includes(b)) l.push(b); };
  for (let t = 0; t < pm.n; t++) {
    for (let k = 0; k < 3; k++) {
      const m = nb[3 * t + k];
      if (m >= 0 && m < t) continue;
      const a = idx[3 * t + k], b = idx[3 * t + (k + 1) % 3];
      if (a === b) continue;
      if (m < 0 || fn[3 * t] * fn[3 * m] + fn[3 * t + 1] * fn[3 * m + 1] + fn[3 * t + 2] * fn[3 * m + 2] < cosT) { link(a, b); link(b, a); }
    }
  }
  c = { angle: angleDeg, idx: pm.idx, adj };
  featCache.set(pm, c);
  return c;
}

const vpos = (pm, v) => [pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]];

// Nächste Merkmalskante beim Punkt p (Dreieck t) und der Kantenzug, der von ihr ausgeht
export function featureLoop(pm, t, p, angleDeg, radius) {
  const g = featureGraph(pm, angleDeg);
  pm.sphereRegion(t, p[0], p[1], p[2], radius);
  let best = null, bd = Infinity;
  for (let i = 0; i < pm.outCount; i++) {
    const s = pm.out[i];
    for (let k = 0; k < 3; k++) {
      const a = pm.idx[3 * s + k], b = pm.idx[3 * s + (k + 1) % 3];
      const l = g.adj.get(a);
      if (!l || !l.includes(b)) continue;
      const A = vpos(pm, a), B = vpos(pm, b), AB = sub3(B, A), l2 = dot3(AB, AB);
      const f = l2 > 0 ? Math.max(0, Math.min(1, dot3(sub3(p, A), AB) / l2)) : 0;
      const d = len3(sub3(p, [A[0] + f * AB[0], A[1] + f * AB[1], A[2] + f * AB[2]]));
      if (d < bd) { bd = d; best = [a, b]; }
    }
  }
  if (!best) return null;
  const [a0, b0] = best;
  // Ebenen-Hypothesen: keine (geradeaus), mitlernend, und die Ebenen der beiden Nachbarflächen
  const hyps = [null, 'adaptive'];
  for (let i = 0; i < pm.outCount; i++) {
    const s = pm.out[i];
    const vs = [pm.idx[3 * s], pm.idx[3 * s + 1], pm.idx[3 * s + 2]];
    if (vs.includes(a0) && vs.includes(b0)) hyps.push([pm.fn[3 * s], pm.fn[3 * s + 1], pm.fn[3 * s + 2]]);
  }
  let res = null;
  for (const h of hyps) {
    const r = walkLoop(pm, g.adj, a0, b0, h);
    const fit = fitPlane(r.ids.map((v) => vpos(pm, v)));
    const size = fit.size || 1;
    const score = (r.closed ? 0 : 10) + (fit.line ? 5 : 0) + (fit.dev / size) * 20 - Math.min(1, r.ids.length / 400) * 0.1;
    if (!res || score < res.score) res = { ...r, fit, score };
  }
  res.pts = res.ids.map((v) => vpos(pm, v));
  res.dist = bd;
  return res;
}

function walkLoop(pm, adj, a0, b0, hyp) {
  const MAXN = 200000;
  const go = (from, to, chain, seen) => {
    let prev = from, cur = to;
    let n = Array.isArray(hyp) ? hyp : null;
    while (chain.length < MAXN) {
      const l = adj.get(cur) || [];
      const Cp = vpos(pm, cur), d0 = norm3(sub3(Cp, vpos(pm, prev)));
      if (hyp === 'adaptive' && chain.length >= 3 && chain.length % 4 === 0) {
        const q0 = vpos(pm, chain[0]), q1 = vpos(pm, chain[(chain.length / 2) | 0]);
        const nn = cross3(sub3(q1, q0), sub3(Cp, q0));
        if (len3(nn) > 1e-9) n = norm3(nn);
      }
      let best = -1, bs = -Infinity;
      for (const c of l) {
        if (c === prev) continue;
        const d1 = norm3(sub3(vpos(pm, c), Cp));
        const straight = dot3(d0, d1);
        if (straight < -0.2) continue;
        let sc = straight;
        if (n) { const off = Math.abs(dot3(d1, n)); if (off > 0.5) continue; sc -= off * 3; }
        if (sc > bs) { bs = sc; best = c; }
      }
      if (best < 0) return false;
      if (best === chain[0]) return true;
      if (seen.has(best)) return false;
      seen.add(best); chain.push(best);
      prev = cur; cur = best;
    }
    return false;
  };
  const chain = [a0, b0], seen = new Set(chain);
  if (go(a0, b0, chain, seen)) return { ids: chain, closed: true };
  const back = [b0, a0];
  go(b0, a0, back, new Set(chain));
  return { ids: back.slice(2).reverse().concat(chain), closed: false };
}

// Ebene durch Punkte (Hauptachsen): {O, N, dev (max. Abstand), size, line, axis}
export function fitPlane(pts) {
  const n = pts.length;
  if (n < 2) return { O: pts[0] || [0, 0, 0], N: [0, 0, 1], dev: 0, size: 0, line: true, axis: [1, 0, 0] };
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub3(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] += d[i] * d[j];
  }
  const { val, vec } = eigSym3(M);
  const order = [0, 1, 2].sort((a, b) => val[a] - val[b]);
  const N = norm3([vec[0][order[0]], vec[1][order[0]], vec[2][order[0]]]);
  let dev = 0, size = 0;
  for (const p of pts) { dev = Math.max(dev, Math.abs(dot3(sub3(p, c), N))); size = Math.max(size, len3(sub3(p, c))); }
  const line = val[order[1]] < 1e-4 * Math.max(1e-12, val[order[2]]);
  const axis = norm3([vec[0][order[2]], vec[1][order[2]], vec[2][order[2]]]);
  return { O: c, N, dev, size, line, axis };
}

// Jacobi-Verfahren für symmetrische 3x3-Matrizen (Eigenvektoren spaltenweise)
function eigSym3(M) {
  const a = [[M[0], M[1], M[2]], [M[3], M[4], M[5]], [M[6], M[7], M[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return { val: [a[0][0], a[1][1], a[2][2]], vec: v };
}

// ---------------------------------------------------------------- Dünnster Querschnitt
// Fläche der Schnittkontur, die durch Dreieck t0 läuft (Ebene P), durch Weiterlaufen über die
// Nachbardreiecke – kostet nur so viel wie die Kontur lang ist.
export function loopAreaThrough(pm, t0, P, maxSteps = 400000) {
  const idx = pm.idx, nb = pm.nb, V = pm.verts, { O, N, U, W } = P;
  const sv = (v) => (V[3 * v] - O[0]) * N[0] + (V[3 * v + 1] - O[1]) * N[1] + (V[3 * v + 2] - O[2]) * N[2];
  const cross = (a, b) => { // a unterhalb, b oberhalb -> (u,w)
    const sa = sv(a), sb = sv(b), f = sa / (sa - sb);
    const x = V[3 * a] + f * (V[3 * b] - V[3 * a]) - O[0], y = V[3 * a + 1] + f * (V[3 * b + 1] - V[3 * a + 1]) - O[1], z = V[3 * a + 2] + f * (V[3 * b + 2] - V[3 * a + 2]) - O[2];
    return [x * U[0] + y * U[1] + z * U[2], x * W[0] + y * W[1] + z * W[2]];
  };
  const edges = (t) => { // Eintritt (oben->unten) und Austritt (unten->oben) im Umlaufsinn
    let st = -1, en = -1;
    for (let k = 0; k < 3; k++) {
      const pa = sv(idx[3 * t + k]) >= 0, pb = sv(idx[3 * t + (k + 1) % 3]) >= 0;
      if (pa && !pb) st = k; else if (!pa && pb) en = k;
    }
    return [st, en];
  };
  const [st0, en0] = edges(t0);
  if (st0 < 0 || en0 < 0) return null;
  let t = t0, en = en0, area = 0, len = 0, steps = 0;
  const p0 = cross(idx[3 * t + (st0 + 1) % 3], idx[3 * t + st0]);
  let prev = p0;
  const pts = [p0];
  for (;;) {
    const a = idx[3 * t + en], b = idx[3 * t + (en + 1) % 3];
    const q = cross(a, b);
    area += prev[0] * q[1] - q[0] * prev[1];
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
    const m = nb[3 * t + en];
    if (m < 0 || ++steps > maxSteps) return null;
    if (m === t0) break;
    pts.push(q);
    let k2 = -1;
    for (let k = 0; k < 3; k++) if (idx[3 * m + k] === b && idx[3 * m + (k + 1) % 3] === a) k2 = k;
    if (k2 < 0) return null;
    t = m;
    const e = edges(t);
    if (e[0] !== k2 || e[1] < 0) return null;
    en = e[1];
  }
  area += prev[0] * p0[1] - p0[0] * prev[1];
  return { area: Math.abs(area / 2), len, pts };
}

// Ebene durch p, die die Flächennormale n enthält und den kleinsten Querschnitt hat
export function minSectionPlane(pm, t0, p, n) {
  n = norm3(n);
  const e1 = norm3(Math.abs(n[0]) < 0.9 ? cross3(n, [1, 0, 0]) : cross3(n, [0, 1, 0])), e2 = cross3(n, e1);
  const f = (phi) => {
    const N = [Math.cos(phi) * e1[0] + Math.sin(phi) * e2[0], Math.cos(phi) * e1[1] + Math.sin(phi) * e2[1], Math.cos(phi) * e1[2] + Math.sin(phi) * e2[2]];
    const r = loopAreaThrough(pm, t0, makePlane(p, N));
    return { N, area: r ? r.area : Infinity, phi };
  };
  let best = null;
  for (let i = 0; i < 180; i++) { const r = f((i * Math.PI) / 180); if (!best || r.area < best.area) best = r; }
  if (!best || !isFinite(best.area)) return null;
  let lo = best.phi - Math.PI / 180, hi = best.phi + Math.PI / 180;
  for (let it = 0; it < 24; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (f(m1).area < f(m2).area) hi = m2; else lo = m1;
  }
  const r = f((lo + hi) / 2);
  return r.area <= best.area ? r : best;
}

// ---------------------------------------------------------------- Für den Druck hinlegen und anordnen
// Je Teil die größte ebene Auflagefläche suchen (unter den häufigsten Flächenrichtungen) und nach unten drehen,
// dann die Teile in Reihen auf dem Druckbett verteilen.
export function arrange(V, I, { bed = [250, 250], spacing = 6, orient = true } = {}) {
  V = Array.from(V);
  const nv = V.length / 3, comp = triComponents(I, nv), nt = I.length / 3;
  const parts = Array.from({ length: comp.count }, () => ({ tris: [], verts: new Set() }));
  for (let t = 0; t < nt; t++) { const p = parts[comp.id[t]]; p.tris.push(t); for (let k = 0; k < 3; k++) p.verts.add(I[3 * t + k]); }
  for (const part of parts) {
    const vs = [...part.verts];
    if (orient) {
      const bins = new Map(), tn = [];
      for (const t of part.tris) {
        const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
        const n = cross3([V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]);
        const A = len3(n) / 2;
        if (!(A > 0)) { tn.push(null); continue; }
        const u = norm3(n);
        tn.push([u, A]);
        const k = Math.round(u[0] * 40) + ',' + Math.round(u[1] * 40) + ',' + Math.round(u[2] * 40);
        let e = bins.get(k);
        if (!e) bins.set(k, (e = { n: [0, 0, 0], a: 0 }));
        e.n[0] += u[0] * A; e.n[1] += u[1] * A; e.n[2] += u[2] * A; e.a += A;
      }
      const cands = [...bins.values()].sort((x, y) => y.a - x.a).slice(0, 24).map((e) => norm3(e.n));
      cands.push([0, 0, -1]);
      let best = null;
      for (const n of cands) {
        let h = -Infinity;
        for (const v of vs) h = Math.max(h, V[3 * v] * n[0] + V[3 * v + 1] * n[1] + V[3 * v + 2] * n[2]);
        let area = 0;
        part.tris.forEach((t, i) => {
          const e = tn[i];
          if (!e || dot3(e[0], n) < 0.9995) return;
          for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; if (V[3 * v] * n[0] + V[3 * v + 1] * n[1] + V[3 * v + 2] * n[2] < h - 0.05) return; }
          area += e[1];
        });
        const score = area * (n[2] < -0.999 ? 1.02 : 1); // bei Gleichstand so lassen
        if (!best || score > best.score) best = { n, score, area };
      }
      const R = rotTo(best.n, [0, 0, -1]);
      for (const v of vs) {
        const x = V[3 * v], y = V[3 * v + 1], z = V[3 * v + 2];
        V[3 * v] = R[0] * x + R[1] * y + R[2] * z; V[3 * v + 1] = R[3] * x + R[4] * y + R[5] * z; V[3 * v + 2] = R[6] * x + R[7] * y + R[8] * z;
      }
      part.contact = best.area;
    }
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], V[3 * v + k]); b[k + 3] = Math.max(b[k + 3], V[3 * v + k]); }
    part.box = b;
  }
  // Reihen packen (tiefste Teile zuerst)
  const order = parts.map((p, i) => i).sort((a, b) => (parts[b].box[4] - parts[b].box[1]) - (parts[a].box[4] - parts[a].box[1]));
  let x = 0, y = 0, rowH = 0, maxX = 0;
  const place = [];
  for (const i of order) {
    const b = parts[i].box, w = b[3] - b[0], h = b[4] - b[1];
    if (x > 0 && x + w > bed[0]) { x = 0; y += rowH + spacing; rowH = 0; }
    place[i] = [x - b[0], y - b[1], -b[2]];
    x += w + spacing; rowH = Math.max(rowH, h); maxX = Math.max(maxX, x - spacing);
  }
  const totalY = y + rowH, cx = maxX / 2, cy = totalY / 2;
  parts.forEach((p, i) => {
    const [dx, dy, dz] = place[i];
    for (const v of p.verts) { V[3 * v] += dx - cx; V[3 * v + 1] += dy - cy; V[3 * v + 2] += dz; }
  });
  return { V, parts: parts.map((p) => ({ contact: p.contact || 0 })), layout: [maxX, totalY] };
}

// Drehmatrix (zeilenweise), die Richtung a auf b dreht
export function rotTo(a, b) {
  a = norm3(a); b = norm3(b);
  const v = cross3(a, b), c = dot3(a, b);
  if (c < -0.999999) {
    const [x, y, z] = norm3(Math.abs(a[0]) < 0.9 ? cross3(a, [1, 0, 0]) : cross3(a, [0, 1, 0]));
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}

// Teile-Übersicht: Größe und Dreieckszahl je Teil
export function partsInfo(V, I) {
  const comp = triComponents(I, V.length / 3);
  const boxes = Array.from({ length: comp.count }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  const cnt = new Int32Array(comp.count);
  for (let t = 0; t < I.length / 3; t++) {
    const b = boxes[comp.id[t]];
    cnt[comp.id[t]]++;
    for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; for (let j = 0; j < 3; j++) { b[j] = Math.min(b[j], V[3 * v + j]); b[j + 3] = Math.max(b[j + 3], V[3 * v + j]); } }
  }
  return { comp, parts: boxes.map((b, i) => ({ size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]], box: b, tris: cnt[i] })) };
}

// ---------------------------------------------------------------- Bereich auswählen, Schnitt entlang seiner Grenze
// Glatte Fläche ab Dreieck seed bis zu Kanten (Knick > angle) in sel eintragen (val 1) bzw. austragen (val 0)
export function smoothRegion(pm, seed, angleDeg, sel, val = 1) {
  const cosT = Math.cos((angleDeg * Math.PI) / 180), nb = pm.nb, fn = pm.fn;
  const seen = new Uint8Array(pm.n), q = [seed];
  seen[seed] = 1;
  while (q.length) {
    const t = q.pop();
    sel[t] = val;
    for (let k = 0; k < 3; k++) {
      const m = nb[3 * t + k];
      if (m < 0 || seen[m] || fn[3 * t] * fn[3 * m] + fn[3 * t + 1] * fn[3 * m + 1] + fn[3 * t + 2] * fn[3 * m + 2] < cosT) continue;
      seen[m] = 1;
      q.push(m);
    }
  }
  return sel;
}

// Grenzen einer Dreiecksauswahl als geschlossene Kantenzüge (Richtung wie in den ausgewählten Dreiecken)
export function selectionLoops(pm, sel) {
  const idx = pm.idx, nb = pm.nb, next = new Map();
  for (let t = 0; t < pm.n; t++) {
    if (!sel[t]) continue;
    for (let k = 0; k < 3; k++) {
      const m = nb[3 * t + k];
      if (m >= 0 && sel[m]) continue;
      const a = idx[3 * t + k], b = idx[3 * t + (k + 1) % 3];
      if (a === b) continue;
      let l = next.get(a);
      if (!l) next.set(a, (l = []));
      l.push(b);
    }
  }
  const loops = [];
  for (const st of next.keys()) {
    while (next.get(st) && next.get(st).length) {
      const ids = [st];
      let p = next.get(st).pop();
      while (p !== st && p !== undefined) {
        ids.push(p);
        const l = next.get(p);
        p = l && l.length ? l.pop() : undefined;
      }
      if (p === st && ids.length >= 3) {
        const pts = ids.map((v) => [pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]]);
        let len = 0;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; len += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
        const va = vectorArea(pts), area = len3(va);
        loops.push({ ids, pts, len, fit: fitPlane(pts), dir: area > 1e-12 ? va.map((x) => x / area) : fitPlane(pts).N, area });
      }
    }
  }
  return loops;
}

// Flächenvektor eines geschlossenen 3D-Kantenzugs: Richtung mit der größten projizierten Fläche
export function vectorArea(pts) {
  const a = [0, 0, 0], c = pts[0];
  for (let i = 1; i + 1 < pts.length; i++) {
    const u = sub3(pts[i], c), v = sub3(pts[i + 1], c), x = cross3(u, v);
    a[0] += x[0] / 2; a[1] += x[1] / 2; a[2] += x[2] / 2;
  }
  return a;
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function isSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(a, b, pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

// Rahmen für den Schnitt entlang einer Grenze: Projektion entlang N; Teil 1 ist die Auswahlseite.
// Liefert die Deckel-Kontur von Teil 1 (gegen den Uhrzeigersinn), die Höhen der Punkte und den Höhenbereich.
export function loopFrame(pm, ids, N) {
  const pts3 = ids.map((v) => [pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]]);
  const c = [0, 0, 0];
  for (const p of pts3) { c[0] += p[0] / pts3.length; c[1] += p[1] / pts3.length; c[2] += p[2] / pts3.length; }
  let P = makePlane(c, N);
  const capIds = ids.slice().reverse();
  let pts = capIds.map((v) => uv3([pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]], P));
  if (area2D(pts) < 0) { P = makePlane(c, N.map((x) => -x)); pts = capIds.map((v) => uv3([pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]], P)); }
  const h = capIds.map((v) => (pm.verts[3 * v] - c[0]) * P.N[0] + (pm.verts[3 * v + 1] - c[1]) * P.N[1] + (pm.verts[3 * v + 2] - c[2]) * P.N[2]);
  return { P, capIds, pts, h, hmin: Math.min(...h), hmax: Math.max(...h), simple: isSimple(pts), area: area2D(pts) };
}

// Dreiecke verfeinern (Kanten länger als L halbieren), feste Kanten bleiben ungeteilt
function refine2D(pts, tris, fixed, L) {
  const L2 = L * L;
  for (let pass = 0; pass < 14; pass++) {
    const emap = new Map(), key = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
    tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const kk = key(t[k], t[(k + 1) % 3]); const l = emap.get(kk); if (l) l.push(i); else emap.set(kk, [i]); } });
    const cand = [];
    for (const [kk, l] of emap) {
      if (l.length !== 2 || fixed.has(kk)) continue;
      const a = Math.floor(kk / 1e7), b = kk - a * 1e7;
      const d2 = (pts[a][0] - pts[b][0]) ** 2 + (pts[a][1] - pts[b][1]) ** 2;
      if (d2 > L2) cand.push([d2, a, b, l]);
    }
    if (!cand.length) break;
    cand.sort((x, y) => y[0] - x[0]);
    const touched = new Uint8Array(tris.length), add = [];
    for (const [, a, b, l] of cand) {
      if (l.some((i) => touched[i])) continue;
      const m = pts.length;
      pts.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]);
      for (const i of l) {
        touched[i] = 1;
        const t = tris[i];
        const k = t.findIndex((x, j) => (x === a && t[(j + 1) % 3] === b) || (x === b && t[(j + 1) % 3] === a));
        const p = t[k], q = t[(k + 1) % 3], r = t[(k + 2) % 3];
        tris[i] = [p, m, r];
        add.push([m, q, r]);
      }
    }
    tris.push(...add);
  }
  return { pts, tris };
}

// Glatte Höhenfläche über der Kontur (Laplace), Höhe an jeder Stelle (u,w) abfragbar
export function heightField(fr) {
  const n0 = fr.pts.length, pts = fr.pts.map((p) => p.slice()), tris = [];
  triangulate(pts, pts.map((_, i) => i), [], [], (a, b, c) => tris.push([a, b, c]));
  const fixed = new Set();
  for (let i = 0; i < n0; i++) { const a = i, b = (i + 1) % n0; fixed.add(a < b ? a * 1e7 + b : b * 1e7 + a); }
  let per = 0;
  for (let i = 0; i < n0; i++) per += Math.hypot(pts[i][0] - pts[(i + 1) % n0][0], pts[i][1] - pts[(i + 1) % n0][1]);
  refine2D(pts, tris, fixed, Math.max(per / 50, 0.2));
  const h = new Float64Array(pts.length), nbr = Array.from({ length: pts.length }, () => new Set());
  const mean = fr.h.reduce((s, x) => s + x, 0) / n0;
  for (let i = 0; i < pts.length; i++) h[i] = i < n0 ? fr.h[i] : mean;
  for (const [a, b, c] of tris) { nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b); }
  const lists = nbr.map((s) => [...s]);
  for (let it = 0; it < 600; it++) {
    let ch = 0;
    for (let i = n0; i < pts.length; i++) {
      const l = lists[i];
      if (!l.length) continue;
      let s = 0;
      for (const j of l) s += h[j];
      const v = s / l.length;
      ch = Math.max(ch, Math.abs(v - h[i]));
      h[i] = v;
    }
    if (ch < 1e-6) break;
  }
  // Punktsuche über ein Raster
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [u, w] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const G = 48, cu = (u1 - u0) / G || 1, cw = (w1 - w0) / G || 1, cells = Array.from({ length: G * G }, () => []);
  const ci = (u) => Math.min(G - 1, Math.max(0, Math.floor((u - u0) / cu))), cj = (w) => Math.min(G - 1, Math.max(0, Math.floor((w - w0) / cw)));
  tris.forEach(([a, b, c], k) => {
    const i0 = ci(Math.min(pts[a][0], pts[b][0], pts[c][0])), i1 = ci(Math.max(pts[a][0], pts[b][0], pts[c][0]));
    const j0 = cj(Math.min(pts[a][1], pts[b][1], pts[c][1])), j1 = cj(Math.max(pts[a][1], pts[b][1], pts[c][1]));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * G + i].push(k);
  });
  const at = (u, w) => {
    let best = 0, bd = Infinity;
    for (const k of cells[cj(w) * G + ci(u)]) {
      const [a, b, c] = tris[k], A = pts[a], B = pts[b], C = pts[c];
      const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
      if (Math.abs(det) < 1e-18) continue;
      const l1 = ((u - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (w - A[1])) / det;
      const l2 = ((B[0] - A[0]) * (w - A[1]) - (u - A[0]) * (B[1] - A[1])) / det;
      const l0 = 1 - l1 - l2, out = Math.max(0, -l0, -l1, -l2);
      if (out < bd) { bd = out; best = l0 * h[a] + l1 * h[b] + l2 * h[c]; if (out === 0) return best; }
    }
    if (bd < Infinity) return best;
    let nd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - u) ** 2 + (pts[i][1] - w) ** 2; if (d < nd) { nd = d; best = h[i]; } }
    return best;
  };
  return { at, pts, tris, h };
}

// Gekrümmter Deckel: Kontur (feste Punkte) + Verbinder-Ringe, Höhe aus der Höhenfläche
function buildCurvedCap(out, F, ids, pts, hAt, feats, slot, tag) {
  const { O, U, W, N } = F;
  const vid = (u, w, h) => {
    const id = out.V.length / 3;
    out.V.push(O[0] + u * U[0] + w * W[0] + h * N[0], O[1] + u * U[1] + w * W[1] + h * N[1], O[2] + u * U[2] + w * W[2] + h * N[2]);
    return id;
  };
  const emit = (a, b, c) => { out.I.push(a, b, c); out.C.push(slot); out.tag.push(tag); };
  // Verbinder: Ringe gegen den Uhrzeigersinn, nur ganz innerhalb der Kontur
  const fs = [];
  for (const f of feats) {
    let rings = f.rings.map((r) => ({ pts: r.pts, h: r.h }));
    if (area2D(rings[0].pts) < 0) rings = rings.map((r) => ({ pts: r.pts.slice().reverse(), h: r.h }));
    if (!rings[0].pts.every(([u, w]) => pip(u, w, pts))) continue;
    fs.push(rings);
  }
  // Fläche: Kontur + Ringe als Löcher, verfeinert
  const P2d = pts.map((p) => p.slice()), map = ids.slice(), tris = [];
  const holes = [], holeIdx = [];
  for (const rings of fs) {
    const start = P2d.length, r0 = rings[0].pts;
    r0.forEach((p) => { P2d.push(p.slice()); map.push(-1); });
    holes.push(r0.slice().reverse());
    holeIdx.push(r0.map((_, i) => start + i).reverse());
  }
  triangulate(pts, pts.map((_, i) => i), holes, holeIdx, (a, b, c) => tris.push([a, b, c]));
  const fixed = new Set(), fk = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  for (let i = 0; i < pts.length; i++) fixed.add(fk(i, (i + 1) % pts.length));
  for (const hi of holeIdx) for (let i = 0; i < hi.length; i++) fixed.add(fk(hi[i], hi[(i + 1) % hi.length]));
  let per = 0;
  for (let i = 0; i < pts.length; i++) per += Math.hypot(pts[i][0] - pts[(i + 1) % pts.length][0], pts[i][1] - pts[(i + 1) % pts.length][1]);
  refine2D(P2d, tris, fixed, Math.max(per / 50, 0.2));
  const gid = P2d.map((p, i) => (i < ids.length ? ids[i] : vid(p[0], p[1], hAt(p[0], p[1]))));
  for (const [a, b, c] of tris) {
    const A = P2d[a], B = P2d[b], C = P2d[c];
    const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (cr < 0) emit(gid[a], gid[c], gid[b]); else emit(gid[a], gid[b], gid[c]);
  }
  // Wände und Boden/Kopf der Verbinder; Tiefe ab dem tiefsten (bzw. höchsten) Punkt des Rings
  fs.forEach((rings, fi) => {
    const start = holeIdx[fi][holeIdx[fi].length - 1]; // erster Ringpunkt (Liste ist umgedreht)
    const r0ids = rings[0].pts.map((_, i) => gid[start + i]);
    const r0h = rings[0].pts.map(([u, w]) => hAt(u, w));
    const up = rings[rings.length - 1].h > 0;
    const base = up ? Math.max(...r0h) : Math.min(...r0h);
    const ringIds = [r0ids];
    for (let k = 1; k < rings.length; k++) {
      const r = rings[k], prev = rings[k - 1];
      ringIds.push(k > 1 && prev.pts === r.pts && prev.h === r.h ? ringIds[k - 1] : r.pts.map(([u, w]) => vid(u, w, base + r.h)));
    }
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = ringIds[k], B = ringIds[k + 1];
      if (A === B) continue;
      const lo = up ? A : B, hi = up ? B : A, n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (up) { emit(lo[i], lo[j], hi[j]); emit(lo[i], hi[j], hi[i]); }
        else { emit(lo[i], hi[j], lo[j]); emit(lo[i], hi[i], hi[j]); }
      }
    }
    const L = ringIds[ringIds.length - 1];
    for (let i = 1; i + 1 < L.length; i++) emit(L[0], L[i], L[i + 1]);
  });
  return fs.length;
}

// Schnitt genau entlang eines geschlossenen Kantenzugs (Grenze einer Auswahl), mit glatter, gemeinsamer Schnittfläche.
// loopIds: Kantenzug in Richtung der Auswahl-Dreiecke (Teil 1 = Auswahlseite), N: Projektionsrichtung.
export function cutAlongLoop(pm, loopIds, N, opt = {}) {
  const { featA = [], featB = [], capSlot = -1, gap = 0 } = opt;
  const fr = loopFrame(pm, loopIds, N);
  if (!fr.simple) return { error: 'Die Grenze überschneidet sich in dieser Richtung – Richtung ändern oder eben schneiden.' };
  const idx = pm.idx, nb = pm.nb, n = pm.n, nv = pm.nv;
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const loopE = new Set();
  for (let i = 0; i < loopIds.length; i++) loopE.add(ek(loopIds[i], loopIds[(i + 1) % loopIds.length]));
  // Seite 1: Dreiecke mit der Kante a->b (Richtung des Kantenzugs), dann ausbreiten ohne den Kantenzug zu kreuzen
  const dirA = new Set(), dirB = new Set();
  for (let i = 0; i < loopIds.length; i++) { const a = loopIds[i], b = loopIds[(i + 1) % loopIds.length]; dirA.add(a * nv + b); dirB.add(b * nv + a); }
  const side = new Int8Array(n), q = [];
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const key = idx[3 * t + k] * nv + idx[3 * t + (k + 1) % 3];
    if (dirA.has(key)) { if (!side[t]) { side[t] = -1; q.push(t); } }
  }
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) if (dirB.has(idx[3 * t + k] * nv + idx[3 * t + (k + 1) % 3]) && side[t] === -1) return { error: 'Der Kantenzug trennt das Modell nicht.' };
  while (q.length) {
    const t = q.pop();
    for (let k = 0; k < 3; k++) {
      const m = nb[3 * t + k];
      if (m < 0 || side[m] || loopE.has(ek(idx[3 * t + k], idx[3 * t + (k + 1) % 3]))) continue;
      side[m] = -1;
      q.push(m);
    }
  }
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) if (dirB.has(idx[3 * t + k] * nv + idx[3 * t + (k + 1) % 3]) && side[t] === -1) return { error: 'Der Kantenzug trennt das Modell nicht in zwei Teile.' };
  const V = Array.from(pm.verts), I = Array.from(idx), C = Array.from(pm.col);
  const dup = new Map();
  for (const v of loopIds) { dup.set(v, V.length / 3); V.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]); }
  const colCount = new Map();
  for (let t = 0; t < n; t++) {
    if (side[t] === -1) { colCount.set(C[t], (colCount.get(C[t]) || 0) + 1); continue; }
    for (let k = 0; k < 3; k++) { const d = dup.get(I[3 * t + k]); if (d !== undefined) I[3 * t + k] = d; }
  }
  let slot = capSlot;
  if (slot < 0) { let bc = -1; for (const [c, k] of colCount) if (k > bc) { bc = k; slot = c; } if (slot < 0) slot = 0; }
  const out = { V, I, C, tag: new Array(n).fill(0) };
  const field = heightField(fr);
  const P = fr.P, PB = { O: P.O, U: P.U, W: P.W.map((x) => -x), N: P.N.map((x) => -x) };
  const placedA = buildCurvedCap(out, P, fr.capIds, fr.pts, field.at, featA, slot, 1);
  const idsB = fr.capIds.slice().reverse().map((v) => dup.get(v)), ptsB = fr.pts.slice().reverse().map(([u, w]) => [u, -w]);
  const mir = (f) => ({ rings: f.rings.map((r) => ({ pts: r.pts.map(([u, w]) => [u, -w]), h: r.h })) });
  const placedB = buildCurvedCap(out, PB, idsB, ptsB, (u, w) => -field.at(u, -w), featB.map(mir), slot, 2);
  if (gap) {
    const moved = new Uint8Array(out.V.length / 3);
    for (let t = 0; t < out.I.length / 3; t++) {
      if (t < n ? side[t] === -1 : out.tag[t] !== 2) continue;
      for (let k = 0; k < 3; k++) {
        const v = out.I[3 * t + k];
        if (moved[v]) continue;
        moved[v] = 1;
        out.V[3 * v] += gap * P.N[0]; out.V[3 * v + 1] += gap * P.N[1]; out.V[3 * v + 2] += gap * P.N[2];
      }
    }
  }
  return { V: out.V, I: out.I, C: out.C, tag: out.tag, placed: placedA + placedB, frame: fr };
}
