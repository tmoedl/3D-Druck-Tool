// Prüft ein Dreiecksnetz (pos: 9 Werte je Dreieck) auf Dichtheit:
// jede Kante genau zweimal, gegenläufig; Volumen positiv; keine entarteten Dreiecke.
export function checkMesh(pos) {
  const key = (i) => `${pos[i]},${pos[i + 1]},${pos[i + 2]}`;
  const ids = new Map();
  const vid = (i) => { const k = key(i); let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } return v; };
  const edges = new Map();
  let vol = 0, degenerate = 0;
  const n = pos.length / 9;
  for (let t = 0; t < n; t++) {
    const o = 9 * t;
    const v = [vid(o), vid(o + 3), vid(o + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const kk = a < b ? a + '_' + b : b + '_' + a;
      const e = edges.get(kk) || { f: 0, r: 0 };
      if (a < b) e.f++; else e.r++;
      edges.set(kk, e);
    }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(o, o + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let open = 0, nonManifold = 0, flipped = 0;
  for (const e of edges.values()) {
    if (e.f + e.r === 1) open++;
    else if (e.f + e.r > 2) nonManifold++;
    else if (e.f !== 1) flipped++;
  }
  return { tris: n, verts: ids.size, open, nonManifold, flipped, degenerate, vol };
}
