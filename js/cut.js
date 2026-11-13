// Exaktes Zerschneiden des Netzes entlang von 2D-Konturen, die in einer Ebene
// (Frame: Ursprung O, Achsen U/W, Projektionsrichtung N) definiert sind.
// Die Schnitte gehen entlang N durch alle Lagen des Modells und bleiben konform
// (keine T-Stellen), damit das Netz geschlossen bleibt.
// Danach können die Bereiche gefärbt und optional erhaben/vertieft werden.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class Cutter {
  // paint: PaintMesh, frame: {O,U,W,N}, rect: [u0,u1,w0,w1]
  constructor(paint, frame, rect) {
    this.F = frame;
    this.V = Array.from(paint.verts);
    this.I = Array.from(paint.idx);
    this.C = Array.from(paint.col);
    this.H = new Map(); // Dreieck -> Höhenversatz
    const { O, U, W } = frame;
    const nv = this.V.length / 3;
    this.PU = new Array(nv);
    this.PW = new Array(nv);
    for (let v = 0; v < nv; v++) {
      const x = this.V[3 * v] - O[0], y = this.V[3 * v + 1] - O[1], z = this.V[3 * v + 2] - O[2];
      this.PU[v] = x * U[0] + y * U[1] + z * U[2];
      this.PW[v] = x * W[0] + y * W[1] + z * W[2];
    }
    const size = Math.max(rect[1] - rect[0], rect[3] - rect[2], 1e-3);
    this.eps = size * 1e-7;
    const m = size * 1e-4;
    this.r0 = rect[0] - m; this.r1 = rect[1] + m; this.s0 = rect[2] - m; this.s1 = rect[3] + m;
    const cell = Math.max(this.r1 - this.r0, this.s1 - this.s0) / 256;
    this.cell = cell;
    this.gx = Math.max(1, Math.ceil((this.r1 - this.r0) / cell));
    this.gy = Math.max(1, Math.ceil((this.s1 - this.s0) / cell));
    this.cells = new Array(this.gx * this.gy);
    this.cands = [];
    this.stamp = [];
    this.gen = 0;
    this.inserted = new Set();
    const nt = this.I.length / 3;
    for (let t = 0; t < nt; t++) {
      const b = this.bbox(t);
      if (b[1] < this.r0 || b[0] > this.r1 || b[3] < this.s0 || b[2] > this.s1) continue;
      this.register(t, b);
    }
  }

  bbox(t) {
    const I = this.I, PU = this.PU, PW = this.PW;
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    return [Math.min(PU[a], PU[b], PU[c]), Math.max(PU[a], PU[b], PU[c]), Math.min(PW[a], PW[b], PW[c]), Math.max(PW[a], PW[b], PW[c])];
  }

  cellRange(u0, u1, w0, w1) {
    const cl = (x, n) => Math.min(n - 1, Math.max(0, x));
    return [cl(Math.floor((u0 - this.r0) / this.cell), this.gx), cl(Math.floor((u1 - this.r0) / this.cell), this.gx),
      cl(Math.floor((w0 - this.s0) / this.cell), this.gy), cl(Math.floor((w1 - this.s0) / this.cell), this.gy)];
  }

  register(t, b = this.bbox(t)) {
    const [x0, x1, y0, y1] = this.cellRange(b[0], b[1], b[2], b[3]);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * this.gx + x;
        (this.cells[k] || (this.cells[k] = [])).push(t);
      }
    }
    this.cands.push(t);
  }

  query(u0, u1, w0, w1) {
    const g = ++this.gen, st = this.stamp, out = [];
    const [x0, x1, y0, y1] = this.cellRange(u0, u1, w0, w1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const l = this.cells[y * this.gx + x];
        if (!l) continue;
        for (const t of l) if (st[t] !== g) { st[t] = g; out.push(t); }
      }
    }
    return out;
  }

  addVertex(x, y, z, u, w) {
    this.V.push(x, y, z);
    this.PU.push(u);
    this.PW.push(w);
    return this.PU.length - 1;
  }

  setTri(t, a, b, c) { this.I[3 * t] = a; this.I[3 * t + 1] = b; this.I[3 * t + 2] = c; }

  newTri(a, b, c, from) {
    const t = this.I.length / 3;
    this.I.push(a, b, c);
    this.C.push(this.C[from]);
    this.register(t);
    return t;
  }

  // Dreieck t gemäß geteilter Kanten (m[k] = neuer Punkt auf Kante k oder -1) zerlegen
  splitTri(t, m) {
    const v = [this.I[3 * t], this.I[3 * t + 1], this.I[3 * t + 2]];
    const cnt = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0);
    if (cnt === 1) {
      const k = m[0] >= 0 ? 0 : m[1] >= 0 ? 1 : 2;
      const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], mm = m[k];
      this.setTri(t, a, mm, c);
      this.newTri(mm, b, c, t);
    } else if (cnt === 2) {
      const k = m[0] < 0 ? 1 : m[1] < 0 ? 2 : 0;
      const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], m0 = m[k], m1 = m[(k + 1) % 3];
      this.setTri(t, m0, b, m1);
      this.newTri(a, m0, m1, t);
      this.newTri(a, m1, c, t);
    } else if (cnt === 3) {
      this.setTri(t, v[0], m[0], m[2]);
      this.newTri(m[0], v[1], m[1], t);
      this.newTri(m[2], m[1], v[2], t);
      this.newTri(m[0], m[1], m[2], t);
    }
  }

  // Punkt (u,w) in alle darunterliegenden Dreiecke (alle Lagen) einfügen
  insertPoint(u, w) {
    const key = u + ',' + w;
    if (this.inserted.has(key)) return;
    this.inserted.add(key);
    const e = this.eps, PU = this.PU, PW = this.PW, V = this.V;
    for (const t of this.query(u - e, u + e, w - e, w + e)) {
      const a = this.I[3 * t], b = this.I[3 * t + 1], c = this.I[3 * t + 2];
      const area = (PU[b] - PU[a]) * (PW[c] - PW[a]) - (PW[b] - PW[a]) * (PU[c] - PU[a]);
      if (Math.abs(area) < e * e) continue;
      const l0 = ((PU[b] - u) * (PW[c] - w) - (PW[b] - w) * (PU[c] - u)) / area;
      const l1 = ((PU[c] - u) * (PW[a] - w) - (PW[c] - w) * (PU[a] - u)) / area;
      const l2 = 1 - l0 - l1;
      if (l0 <= 1e-9 || l1 <= 1e-9 || l2 <= 1e-9) continue;
      const p = this.addVertex(
        l0 * V[3 * a] + l1 * V[3 * b] + l2 * V[3 * c],
        l0 * V[3 * a + 1] + l1 * V[3 * b + 1] + l2 * V[3 * c + 1],
        l0 * V[3 * a + 2] + l1 * V[3 * b + 2] + l2 * V[3 * c + 2], u, w);
      this.setTri(t, a, b, p);
      this.newTri(b, c, p, t);
      this.newTri(c, a, p, t);
    }
  }

  // Schnitt entlang der Strecke A-B (Ebene durch A-B parallel zu N)
  cutSegment(au, aw, bu, bw) {
    const du = bu - au, dw = bw - aw, L2 = du * du + dw * dw;
    if (L2 < this.eps * this.eps) return;
    this.insertPoint(au, aw);
    this.insertPoint(bu, bw);
    const L = Math.sqrt(L2), e = this.eps, PU = this.PU, PW = this.PW, V = this.V;
    const side = new Map();
    const sOf = (v) => {
      let s = side.get(v);
      if (s === undefined) {
        s = (du * (PW[v] - aw) - dw * (PU[v] - au)) / L;
        if (Math.abs(s) < e) s = 0;
        side.set(v, s);
      }
      return s;
    };
    const emap = new Map();
    const edgeX = (a, b) => {
      const sa = sOf(a), sb = sOf(b);
      if (!(sa * sb < 0)) return -1;
      const key = a < b ? a * 67108864 + b : b * 67108864 + a;
      let r = emap.get(key);
      if (r !== undefined) return r;
      let p = a, q = b, sp = sa, sq = sb;
      if (p > q) { p = b; q = a; sp = sb; sq = sa; }
      const f = sp / (sp - sq);
      const u = PU[p] + (PU[q] - PU[p]) * f, w = PW[p] + (PW[q] - PW[p]) * f;
      const tt = ((u - au) * du + (w - aw) * dw) / L2;
      if (tt < -1e-7 || tt > 1 + 1e-7) r = -1;
      else r = this.addVertex(V[3 * p] + (V[3 * q] - V[3 * p]) * f, V[3 * p + 1] + (V[3 * q + 1] - V[3 * p + 1]) * f, V[3 * p + 2] + (V[3 * q + 2] - V[3 * p + 2]) * f, u, w);
      emap.set(key, r);
      return r;
    };
    const tris = this.query(Math.min(au, bu) - e, Math.max(au, bu) + e, Math.min(aw, bw) - e, Math.max(aw, bw) + e);
    for (const t of tris) {
      const a = this.I[3 * t], b = this.I[3 * t + 1], c = this.I[3 * t + 2];
      const sa = sOf(a), sb = sOf(b), sc = sOf(c);
      if ((sa >= 0 && sb >= 0 && sc >= 0) || (sa <= 0 && sb <= 0 && sc <= 0)) continue;
      const m = [edgeX(a, b), edgeX(b, c), edgeX(c, a)];
      if (m[0] >= 0 || m[1] >= 0 || m[2] >= 0) this.splitTri(t, m);
    }
  }

  // Geschlossenes Polygon [[u,w],...] schneiden
  cutPolygon(pts) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.cutSegment(a[0], a[1], b[0], b[1]);
    }
  }

  centroid(t) {
    const I = this.I, a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    return [(this.PU[a] + this.PU[b] + this.PU[c]) / 3, (this.PW[a] + this.PW[b] + this.PW[c]) / 3];
  }

  normalDotN(t) {
    const V = this.V, I = this.I, N = this.F.N;
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    return l ? (nx * N[0] + ny * N[1] + nz * N[2]) / l : 0;
  }

  depth(v) {
    const V = this.V, N = this.F.N;
    return V[3 * v] * N[0] + V[3 * v + 1] * N[1] + V[3 * v + 2] * N[2];
  }

  // Liefert eine Funktion isTop(t): liegt das Dreieck in Projektionsrichtung ganz oben (sichtbar von N aus)?
  topTester(res = 1024) {
    const gx = Math.max(1, Math.round(res * (this.r1 - this.r0) / Math.max(this.r1 - this.r0, this.s1 - this.s0)));
    const gy = Math.max(1, Math.round(res * (this.s1 - this.s0) / Math.max(this.r1 - this.r0, this.s1 - this.s0)));
    const cu = (this.r1 - this.r0) / gx, cw = (this.s1 - this.s0) / gy;
    const Z = new Float64Array(gx * gy).fill(-Infinity);
    const PU = this.PU, PW = this.PW, I = this.I;
    const facing = new Map();
    const plane = (t) => {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const area = (PU[b] - PU[a]) * (PW[c] - PW[a]) - (PW[b] - PW[a]) * (PU[c] - PU[a]);
      return { a, b, c, area, da: this.depth(a), db: this.depth(b), dc: this.depth(c) };
    };
    const depthAt = (p, u, w) => {
      const l0 = ((PU[p.b] - u) * (PW[p.c] - w) - (PW[p.b] - w) * (PU[p.c] - u)) / p.area;
      const l1 = ((PU[p.c] - u) * (PW[p.a] - w) - (PW[p.c] - w) * (PU[p.a] - u)) / p.area;
      return { l0, l1, l2: 1 - l0 - l1, d: l0 * p.da + l1 * p.db + (1 - l0 - l1) * p.dc };
    };
    for (const t of new Set(this.cands)) {
      if (this.normalDotN(t) <= 0.02) continue;
      const p = plane(t);
      if (Math.abs(p.area) < 1e-18) continue;
      facing.set(t, p);
      const u0 = Math.min(PU[p.a], PU[p.b], PU[p.c]), u1 = Math.max(PU[p.a], PU[p.b], PU[p.c]);
      const w0 = Math.min(PW[p.a], PW[p.b], PW[p.c]), w1 = Math.max(PW[p.a], PW[p.b], PW[p.c]);
      const x0 = Math.max(0, Math.ceil((u0 - this.r0) / cu - 0.5)), x1 = Math.min(gx - 1, Math.floor((u1 - this.r0) / cu - 0.5));
      const y0 = Math.max(0, Math.ceil((w0 - this.s0) / cw - 0.5)), y1 = Math.min(gy - 1, Math.floor((w1 - this.s0) / cw - 0.5));
      for (let y = y0; y <= y1; y++) {
        const w = this.s0 + (y + 0.5) * cw;
        for (let x = x0; x <= x1; x++) {
          const u = this.r0 + (x + 0.5) * cu;
          const r = depthAt(p, u, w);
          if (r.l0 < -1e-9 || r.l1 < -1e-9 || r.l2 < -1e-9) continue;
          if (r.d > Z[y * gx + x]) Z[y * gx + x] = r.d;
        }
      }
    }
    const tol = Math.max(this.r1 - this.r0, this.s1 - this.s0) * 1e-4 + 1e-4;
    return (t) => {
      const p = facing.get(t);
      if (!p) return false;
      const [u, w] = this.centroid(t);
      const x = Math.min(gx - 1, Math.max(0, Math.floor((u - this.r0) / cu)));
      const y = Math.min(gy - 1, Math.max(0, Math.floor((w - this.s0) / cw)));
      const z = Z[y * gx + x];
      if (z === -Infinity) return true;
      const r = depthAt(p, this.r0 + (x + 0.5) * cu, this.s0 + (y + 0.5) * cw);
      return r.d >= z - tol;
    };
  }

  // Alle Dreiecke im Bereich klassifizieren: fn(u,w) -> {slot, h} | null
  apply(classify, topOnly) {
    const isTop = topOnly ? this.topTester() : null;
    let changed = 0;
    for (const t of new Set(this.cands)) {
      if (isTop && !isTop(t)) continue;
      const [u, w] = this.centroid(t);
      const r = classify(u, w);
      if (!r) continue;
      if (this.C[t] !== r.slot) { this.C[t] = r.slot; changed++; }
      if (r.h) { this.H.set(t, r.h); changed++; }
    }
    return changed;
  }

  // Bereiche mit Höhe entlang N verschieben und senkrechte Wände einziehen
  extrude() {
    if (!this.H.size) return;
    const I = this.I, V = this.V, N = this.F.N, H = this.H;
    const hOf = (t) => H.get(t) || 0;
    // Kanten zwischen Dreiecken unterschiedlicher Höhe suchen (vor dem Umhängen)
    const emap = new Map(), walls = [];
    const BIG = 67108864;
    for (const t of new Set(this.cands)) {
      for (let k = 0; k < 3; k++) {
        const a = I[3 * t + k], b = I[3 * t + (k + 1) % 3];
        const key = a < b ? a * BIG + b : b * BIG + a;
        const o = emap.get(key);
        if (o === undefined) emap.set(key, [t, a, b]);
        else if (o !== null) {
          emap.set(key, null);
          if (o[1] === b && o[2] === a && hOf(o[0]) !== hOf(t)) walls.push([o[0], o[1], o[2], t]);
        }
      }
    }
    const copies = new Map();
    const copy = (v, h) => {
      if (!h) return v;
      const key = v + '|' + h;
      let c = copies.get(key);
      if (c === undefined) {
        c = this.addVertex(V[3 * v] + h * N[0], V[3 * v + 1] + h * N[1], V[3 * v + 2] + h * N[2], this.PU[v], this.PW[v]);
        copies.set(key, c);
      }
      return c;
    };
    for (const [t, h] of H) for (let k = 0; k < 3; k++) I[3 * t + k] = copy(I[3 * t + k], h);
    for (const [t1, a, b, t2] of walls) {
      // t1 enthält a->b, t2 enthält b->a
      const h1 = hOf(t1), h2 = hOf(t2);
      const a1 = copy(a, h1), b1 = copy(b, h1), a2 = copy(a, h2), b2 = copy(b, h2);
      const src = Math.abs(h1) >= Math.abs(h2) ? t1 : t2;
      I.push(b1, a1, a2, b1, a2, b2);
      this.C.push(this.C[src], this.C[src]);
    }
  }

  result() {
    const I = this.I, V = this.V, n = I.length / 3;
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < I.length; i++) {
      const v = I[i];
      pos[3 * i] = V[3 * v]; pos[3 * i + 1] = V[3 * v + 1]; pos[3 * i + 2] = V[3 * v + 2];
    }
    return { pos, col: Uint8Array.from(this.C) };
  }
}

export function pointInPolygon(u, w, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, wi] = pts[i], [uj, wj] = pts[j];
    if ((wi > w) !== (wj > w) && u < ((uj - ui) * (w - wi)) / (wj - wi) + ui) inside = !inside;
  }
  return inside;
}

// Konturen eines Rasters (Klasse pro Zelle, -1 = nichts) als Strecken entlang der Zellkanten.
// Liefert Strecken in Zellkoordinaten [x0,y0,x1,y1] (gerade Läufe zusammengefasst).
export function gridContours(G, gw, gh) {
  const segs = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? -1 : G[y * gw + x]);
  for (let y = 0; y <= gh; y++) {
    let start = -1;
    for (let x = 0; x <= gw; x++) {
      const diff = x < gw && at(x, y - 1) !== at(x, y);
      if (diff && start < 0) start = x;
      if (!diff && start >= 0) { segs.push([start, y, x, y]); start = -1; }
    }
  }
  for (let x = 0; x <= gw; x++) {
    let start = -1;
    for (let y = 0; y <= gh; y++) {
      const diff = y < gh && at(x - 1, y) !== at(x, y);
      if (diff && start < 0) start = y;
      if (!diff && start >= 0) { segs.push([x, start, x, y]); start = -1; }
    }
  }
  return segs;
}

export { dot };
