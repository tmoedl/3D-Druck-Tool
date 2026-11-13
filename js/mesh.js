// Dreiecksnetz mit Farbzuordnung pro Dreieck (Filament-Slot).
// Reines JS ohne three.js – damit auch in Node testbar.

export const TEX_W = 4096; // Breite der Farb-Textur (Dreiecks-ID -> Slot)

export class PaintMesh {
  constructor(pos, col) {
    this.setGeometry(pos, col);
  }

  // pos: Float32Array (9 Werte pro Dreieck, nicht indiziert)
  // col: optional Uint8Array (Slot pro Dreieck)
  setGeometry(pos, col) {
    for (let i = 0; i < pos.length; i++) if (pos[i] === 0) pos[i] = 0; // -0 -> +0 (für Verschweißen)
    this.pos = pos;
    this.n = pos.length / 9;
    const rows = Math.max(1, Math.ceil(this.n / TEX_W));
    this.texRows = rows;
    this.colBuf = new Uint8Array(TEX_W * rows);
    this.hiBuf = new Uint8Array(TEX_W * rows);
    this.col = this.colBuf.subarray(0, this.n);
    this.hi = this.hiBuf.subarray(0, this.n);
    if (col) this.col.set(col.subarray ? col.subarray(0, this.n) : col);
    this.stamp = new Uint32Array(this.n);
    this.gen = 0;
    this.queue = new Int32Array(this.n);
    this.out = new Int32Array(this.n);
    this.outCount = 0;
    this.lastFillGen = -1;
    this.buildTopology();
    this.computeDerived();
  }

  // ---------- Topologie ----------
  buildTopology() {
    const pos = this.pos, n = this.n, nc = n * 3;
    const u = new Uint32Array(pos.buffer, pos.byteOffset, nc * 3);
    let cap = 16;
    while (cap < nc * 2) cap <<= 1;
    const mask = cap - 1;
    const table = new Int32Array(cap).fill(-1);
    const vfirst = new Int32Array(nc);
    const idx = new Uint32Array(nc);
    let nv = 0;
    for (let i = 0; i < nc; i++) {
      const a = u[3 * i], b = u[3 * i + 1], c = u[3 * i + 2];
      let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791);
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
      h &= mask;
      for (;;) {
        const v = table[h];
        if (v < 0) { table[h] = nv; vfirst[nv] = i; idx[i] = nv++; break; }
        const j = vfirst[v] * 3;
        if (u[j] === a && u[j + 1] === b && u[j + 2] === c) { idx[i] = v; break; }
        h = (h + 1) & mask;
      }
    }
    this.nv = nv;
    this.vfirst = vfirst.slice(0, nv);
    this.idx = idx;
    this.updateVerts();

    // Nachbarschaft über gemeinsame Kanten
    const nb = new Int32Array(nc).fill(-1);
    const emap = new Map();
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const a = idx[3 * t + k], b = idx[3 * t + (k + 1) % 3];
        if (a === b) continue;
        const key = a < b ? a * nv + b : b * nv + a;
        const o = emap.get(key);
        if (o === undefined) emap.set(key, 3 * t + k);
        else {
          nb[3 * t + k] = (o / 3) | 0;
          if (nb[o] < 0) nb[o] = t;
          emap.delete(key);
        }
      }
    }
    this.openEdges = emap.size;
    this.nb = nb;
  }

  updateVerts() {
    const verts = new Float32Array(this.nv * 3), pos = this.pos, vf = this.vfirst;
    for (let v = 0; v < this.nv; v++) {
      const j = vf[v] * 3;
      verts[3 * v] = pos[j]; verts[3 * v + 1] = pos[j + 1]; verts[3 * v + 2] = pos[j + 2];
    }
    this.verts = verts;
  }

  computeDerived() {
    const p = this.pos, n = this.n;
    const fn = new Float32Array(n * 3), cen = new Float32Array(n * 3);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let t = 0; t < n; t++) {
      const o = 9 * t;
      const ax = p[o], ay = p[o + 1], az = p[o + 2];
      const bx = p[o + 3], by = p[o + 4], bz = p[o + 5];
      const cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn[3 * t] = nx / l; fn[3 * t + 1] = ny / l; fn[3 * t + 2] = nz / l;
      cen[3 * t] = (ax + bx + cx) / 3; cen[3 * t + 1] = (ay + by + cy) / 3; cen[3 * t + 2] = (az + bz + cz) / 3;
      if (ax < minX) minX = ax; if (bx < minX) minX = bx; if (cx < minX) minX = cx;
      if (ay < minY) minY = ay; if (by < minY) minY = by; if (cy < minY) minY = cy;
      if (az < minZ) minZ = az; if (bz < minZ) minZ = bz; if (cz < minZ) minZ = cz;
      if (ax > maxX) maxX = ax; if (bx > maxX) maxX = bx; if (cx > maxX) maxX = cx;
      if (ay > maxY) maxY = ay; if (by > maxY) maxY = by; if (cy > maxY) maxY = cy;
      if (az > maxZ) maxZ = az; if (bz > maxZ) maxZ = bz; if (cz > maxZ) maxZ = cz;
    }
    this.fn = fn;
    this.cen = cen;
    if (n === 0) { minX = minY = minZ = maxX = maxY = maxZ = 0; }
    this.bbox = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  // 3x3-Matrix (zeilenweise, 9 Werte) + Verschiebung anwenden
  transform(m, t = [0, 0, 0]) {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = m[0] * x + m[1] * y + m[2] * z + t[0];
      p[i + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
      p[i + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
      if (p[i] === 0) p[i] = 0;
      if (p[i + 1] === 0) p[i + 1] = 0;
      if (p[i + 2] === 0) p[i + 2] = 0;
    }
    // Spiegelung (negative Determinante) -> Umlaufsinn korrigieren
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (det < 0) {
      for (let o = 0; o < p.length; o += 9) {
        for (let k = 0; k < 3; k++) { const s = p[o + 3 + k]; p[o + 3 + k] = p[o + 6 + k]; p[o + 6 + k] = s; }
      }
      this.buildTopology();
    } else {
      this.updateVerts();
    }
    this.computeDerived();
  }

  // Modell mittig auf das Druckbett (Z=0) setzen
  dropToBed() {
    const b = this.bbox;
    const tx = -(b.min[0] + b.max[0]) / 2, ty = -(b.min[1] + b.max[1]) / 2, tz = -b.min[2];
    this.transform([1, 0, 0, 0, 1, 0, 0, 0, 1], [tx, ty, tz]);
  }

  // ---------- Hilfsfunktionen ----------
  nextGen() {
    if (++this.gen >= 0xfffffff0) { this.stamp.fill(0); this.gen = 1; }
    return this.gen;
  }

  counts(nSlots = 16) {
    const c = new Uint32Array(Math.max(nSlots, 256));
    const col = this.col;
    for (let t = 0; t < this.n; t++) c[col[t]]++;
    return c;
  }

  setColor(list, count, slot) {
    const col = this.col;
    let changed = 0;
    for (let i = 0; i < count; i++) {
      const t = list[i];
      if (col[t] !== slot) { col[t] = slot; changed++; }
    }
    return changed;
  }

  fillAll(slot) { this.col.fill(slot); }

  replaceColor(from, to) {
    const col = this.col;
    let c = 0;
    for (let t = 0; t < this.n; t++) if (col[t] === from) { col[t] = to; c++; }
    return c;
  }

  // Slot entfernen: betroffene Dreiecke -> Slot 0, höhere Slots rutschen nach
  removeSlot(s) {
    const col = this.col;
    for (let t = 0; t < this.n; t++) {
      if (col[t] === s) col[t] = 0;
      else if (col[t] > s) col[t]--;
    }
  }

  // ---------- Pinsel: zusammenhängende Dreiecke innerhalb einer Kugel ----------
  sphereRegion(start, cx, cy, cz, R) {
    const g = this.nextGen(), st = this.stamp, q = this.queue, out = this.out;
    const nb = this.nb, cen = this.cen, p = this.pos, R2 = R * R;
    let head = 0, tail = 0, oc = 0;
    q[tail++] = start; st[start] = g;
    const d2 = (x, y, z) => (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
    while (head < tail) {
      const t = q[head++];
      if (t === start || d2(cen[3 * t], cen[3 * t + 1], cen[3 * t + 2]) <= R2) out[oc++] = t;
      for (let k = 0; k < 3; k++) {
        const m = nb[3 * t + k];
        if (m < 0 || st[m] === g) continue;
        st[m] = g;
        const o = 9 * m;
        if (d2(cen[3 * m], cen[3 * m + 1], cen[3 * m + 2]) <= R2 ||
            d2(p[o], p[o + 1], p[o + 2]) <= R2 || d2(p[o + 3], p[o + 4], p[o + 5]) <= R2 || d2(p[o + 6], p[o + 7], p[o + 8]) <= R2) {
          q[tail++] = m;
        }
      }
    }
    this.outCount = oc;
    return oc;
  }

  // ---------- Eimer: Fläche bis zu Kanten (Winkelgrenze) ----------
  // relative: Vergleich mit der Normalen des Startdreiecks statt mit dem Nachbarn
  fillRegion(start, angleDeg, relative, sameColor) {
    const g = this.nextGen(), st = this.stamp, q = this.queue, out = this.out;
    const nb = this.nb, fn = this.fn, col = this.col;
    const cosT = angleDeg >= 180 ? -2 : Math.cos(angleDeg * Math.PI / 180) - 1e-6;
    const sc = col[start];
    const sx = fn[3 * start], sy = fn[3 * start + 1], sz = fn[3 * start + 2];
    let head = 0, tail = 0;
    q[tail++] = start; st[start] = g;
    while (head < tail) {
      const t = q[head++];
      out[head - 1] = t;
      const rx = relative ? sx : fn[3 * t], ry = relative ? sy : fn[3 * t + 1], rz = relative ? sz : fn[3 * t + 2];
      for (let k = 0; k < 3; k++) {
        const m = nb[3 * t + k];
        if (m < 0 || st[m] === g) continue;
        if (sameColor && col[m] !== sc) continue;
        if (rx * fn[3 * m] + ry * fn[3 * m + 1] + rz * fn[3 * m + 2] < cosT) continue;
        st[m] = g;
        q[tail++] = m;
      }
    }
    this.outCount = tail;
    this.lastFillGen = g;
    return tail;
  }

  inLastFill(t) { return this.lastFillGen === this.gen && this.stamp[t] === this.gen; }

  // ---------- Höhe ----------
  heightRegion(z, above) {
    const cen = this.cen, out = this.out;
    let oc = 0;
    for (let t = 0; t < this.n; t++) {
      const cz = cen[3 * t + 2];
      if (above ? cz >= z : cz <= z) out[oc++] = t;
    }
    this.outCount = oc;
    return oc;
  }

  // Ganze zusammenhängende Teile (Shells)
  shellOf(start) { return this.fillRegion(start, 180, false, false); }

  // ---------- Unterteilen: Kanten länger als L werden halbiert (konform, ohne T-Stellen) ----------
  // keep(ax,ay,az,bx,by,bz): optional – nur Kanten teilen, für die keep true liefert
  subdivide(L, maxTris = 4000000, keep = null) {
    let verts = Array.from(this.verts);
    let idx = this.idx, col = this.col, n = this.n;
    const L2 = L * L;
    let limited = false, iterations = 0;
    for (let iter = 0; iter < 24; iter++) {
      const emid = new Map();
      const nIdx = [], nCol = [];
      let any = false;
      const BIG = 67108864;
      const mid = (a, b) => {
        const dx = verts[3 * a] - verts[3 * b], dy = verts[3 * a + 1] - verts[3 * b + 1], dz = verts[3 * a + 2] - verts[3 * b + 2];
        if (dx * dx + dy * dy + dz * dz <= L2) return -1;
        if (keep && !keep(verts[3 * a], verts[3 * a + 1], verts[3 * a + 2], verts[3 * b], verts[3 * b + 1], verts[3 * b + 2])) return -1;
        const key = a < b ? a * BIG + b : b * BIG + a;
        let m = emid.get(key);
        if (m === undefined) {
          m = verts.length / 3;
          verts.push((verts[3 * a] + verts[3 * b]) / 2, (verts[3 * a + 1] + verts[3 * b + 1]) / 2, (verts[3 * a + 2] + verts[3 * b + 2]) / 2);
          emid.set(key, m);
        }
        return m;
      };
      const vertsBefore = verts.length;
      for (let t = 0; t < n; t++) {
        const v = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
        const m = [mid(v[0], v[1]), mid(v[1], v[2]), mid(v[2], v[0])];
        const c = col[t];
        const cnt = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0);
        if (cnt === 0) { nIdx.push(v[0], v[1], v[2]); nCol.push(c); continue; }
        any = true;
        if (cnt === 3) {
          nIdx.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]);
          nCol.push(c, c, c, c);
        } else if (cnt === 1) {
          const k = m[0] >= 0 ? 0 : m[1] >= 0 ? 1 : 2; // geteilte Kante k: v[k]->v[k+1]
          const a = v[k], b = v[(k + 1) % 3], cc = v[(k + 2) % 3], mm = m[k];
          nIdx.push(a, mm, cc, mm, b, cc);
          nCol.push(c, c);
        } else {
          const k = m[0] < 0 ? 1 : m[1] < 0 ? 2 : 0; // Kanten k und k+1 geteilt
          const a = v[k], b = v[(k + 1) % 3], cc = v[(k + 2) % 3];
          const m0 = m[k], m1 = m[(k + 1) % 3];
          nIdx.push(m0, b, m1, a, m0, m1, a, m1, cc);
          nCol.push(c, c, c);
        }
      }
      if (!any) break;
      if (nCol.length > maxTris) { limited = true; verts.length = vertsBefore; break; }
      idx = Uint32Array.from(nIdx);
      col = Uint8Array.from(nCol);
      n = nCol.length;
      iterations++;
    }
    if (iterations === 0) return { changed: false, limited };
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n * 3; i++) {
      const v = idx[i];
      pos[3 * i] = verts[3 * v]; pos[3 * i + 1] = verts[3 * v + 1]; pos[3 * i + 2] = verts[3 * v + 2];
    }
    this.setGeometry(pos, col);
    return { changed: true, limited };
  }
}

// Mehrere Positions-Arrays zusammenfügen
export function concatPos(list) {
  let len = 0;
  for (const a of list) len += a.length;
  const out = new Float32Array(len);
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
