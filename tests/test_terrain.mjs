import { buildMap, defaultMapConfig, areaMerc, merc } from '../js/terrain.js';
import { checkMesh } from './meshcheck.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FEHLER ') + m); if (!c) fail++; };

const cfg = defaultMapConfig();
cfg.area = { lat: 47.42, lon: 10.98, widthM: 4000, aspect: 0.75 };
cfg.sizeMm = 80; cfg.res = 0.5;
const A = areaMerc(cfg.area);
// Berg in der Mitte, See im Südwesten
const elev = (mx, my) => 800 + 1200 * Math.exp(-(((mx - A.cx) / (A.w * 0.2)) ** 2 + ((my - A.cy) / (A.h * 0.25)) ** 2));
const lake = [A.cx - A.w * 0.4, A.cy - A.h * 0.4, A.cx - A.w * 0.2, A.cy - A.h * 0.4, A.cx - A.w * 0.2, A.cy - A.h * 0.2, A.cx - A.w * 0.4, A.cy - A.h * 0.2];
const forest = [A.cx + A.w * 0.1, A.cy + A.h * 0.1, A.cx + A.w * 0.45, A.cy + A.h * 0.1, A.cx + A.w * 0.45, A.cy + A.h * 0.45, A.cx + A.w * 0.1, A.cy + A.h * 0.45];
const line = [];
for (let k = 0; k <= 50; k++) { const a = k / 50 * Math.PI * 1.5; line.push(A.cx + Math.cos(a) * A.w * 0.3, A.cy + Math.sin(a) * A.h * 0.3); }
const data = {
  elev,
  features: [{ cls: 'water', kind: 'poly', rings: [lake] }, { cls: 'forest', kind: 'poly', rings: [forest] }],
  tracks: [{ line, slot: 3, widthMm: 1.2, mode: 'raise', height: 0.6, markers: true, markerSlot: 4 }],
  pockets: [{ rect: [-40, -5, -32, 5], depth: 2 }, { rect: [-10, -40 - 22 - 6, 10, -40 - 22 - 6 + 6], depth: 2.5 }],
};
cfg.slots = { ...cfg.slots, forest: 1, water: 2, frame: 5, band: 5, side: 5 };
for (const shape of ['rect', 'circle', 'hex']) {
  for (const radius of shape === 'rect' ? [0, 8] : [0]) {
    const c = { ...cfg, shape, radius };
    const t0 = Date.now();
    const r = buildMap(c, { ...data, pockets: shape === 'rect' ? data.pockets : [] });
    const m = checkMesh(r.pos);
    ok(m.open === 0 && m.nonManifold === 0 && m.flipped === 0 && m.vol > 0, `${shape} r=${radius}: ${m.tris} Dreiecke, offen ${m.open}, nicht-mannigfaltig ${m.nonManifold}, verdreht ${m.flipped}, entartet ${m.degenerate}, Vol ${(m.vol / 1000).toFixed(1)} cm³, ${Date.now() - t0} ms`);
    const used = new Set(r.col);
    ok(used.has(1) && used.has(2) && used.has(3) && used.has(5), `${shape}: Farben vorhanden ${[...used].sort()}`);
  }
}

// Track liegt exakt auf dem Gelände: Punkt auf der Trackmitte muss höher als Gelände daneben sein
{
  const r = buildMap({ ...cfg, frame: { ...cfg.frame, width: 0 } }, { ...data, pockets: [] });
  const { toX, toY } = r.transform;
  const g = r.grid;
  // höchster Z-Wert an der Trackmitte (Dreiecke mit Farbe 3) vs. Projektion
  let maxErr = 0, n = 0;
  for (let k = 0; k < line.length; k += 6) {
    const x = toX(line[k]), y = toY(line[k + 1]);
    // nächstes Dreieck mit Trackfarbe suchen
    let best = Infinity;
    for (let t = 0; t < r.col.length; t++) {
      if (r.col[t] !== 3 && r.col[t] !== 4) continue;
      const o = 9 * t;
      const cx = (r.pos[o] + r.pos[o + 3] + r.pos[o + 6]) / 3, cy = (r.pos[o + 1] + r.pos[o + 4] + r.pos[o + 7]) / 3;
      const d = Math.hypot(cx - x, cy - y);
      if (d < best) best = d;
    }
    maxErr = Math.max(maxErr, best); n++;
  }
  ok(maxErr < Math.max(g.dx, 0.6), `Track-Lage: max. Abstand GPS-Punkt -> Track-Dreieck ${maxErr.toFixed(3)} mm (Raster ${g.dx.toFixed(3)} mm, ${n} Punkte)`);
  // Norden oben: Punkt mit großem my muss großes y haben
  ok(toY(A.cy + 100) > toY(A.cy) && toX(A.cx + 100) > toX(A.cx), 'Ausrichtung: Norden = +y, Osten = +x');
}
// Rahmen-Varianten: alle dicht; Modus „edge“: Rahmen höher als das Gelände am Kartenrand
for (const mode of ['fixed', 'edge', 'peak', 'follow']) for (const style of ['flat', 'round', 'bevelIn', 'bevelOut', 'step', 'stepOut']) for (const trans of ['hard', 'groove', 'fade']) {
  if (mode !== 'edge' && mode !== 'follow' && style !== 'bevelIn') continue;
  if (mode === 'follow' && trans !== 'hard' && style !== 'bevelIn') continue;
  const c = { ...cfg, res: 0.8, frame: { ...cfg.frame, mode, style, trans, transMm: 3, height: 1.5, profileMm: 1.2 } };
  const r = buildMap(c, { ...data, pockets: [] });
  const m = checkMesh(r.pos);
  const good = m.open === 0 && m.nonManifold === 0 && m.flipped === 0 && m.vol > 0;
  let okEdge = true;
  if ((mode === 'edge' || mode === 'peak') && trans === 'hard') {
    // höchster Kartenpunkt in 2 mm Abstand zum Kartenrand < Rahmenoberkante
    const L = r.layout;
    for (let t = 0; t < r.pos.length; t += 3) {
      const x = r.pos[t], y = r.pos[t + 1], z = r.pos[t + 2];
      const d = L.sdMap(x, y);
      if (d < 0 && d > -2 && z > r.info.fTop - 1.2 + 1e-6) { okEdge = false; break; }
    }
  }
  if (mode === 'follow' && trans === 'hard') {
    // Kartenpunkte am Rand liegen unter dem Rahmen direkt daneben: max. Höhe in 1 mm Randstreifen der Karte
    // gegen die niedrigste Rahmenhöhe im angrenzenden 1-mm-Streifen außen, je 10-mm-Abschnitt entlang x (Nordrand)
    const L = r.layout, north = L.H / 2;
    for (let x0 = -L.W / 2 + 5; x0 < L.W / 2 - 15; x0 += 10) {
      let mapMax = 0, frameMin = Infinity;
      for (let t = 0; t < r.pos.length; t += 3) {
        const x = r.pos[t], y = r.pos[t + 1], z = r.pos[t + 2];
        if (x < x0 || x > x0 + 10 || z < 0.01) continue;
        if (y < north && y > north - 1) mapMax = Math.max(mapMax, z);
        if (y > north + 1.5 && y < north + 2.5) frameMin = Math.min(frameMin, z);
      }
      if (isFinite(frameMin) && mapMax > frameMin + 1e-6) okEdge = false;
    }
  }
  ok(good && okEdge, `Rahmen ${mode}/${style}/${trans}: dicht ${good}, Rand ≤ Rahmen ${okEdge}, Rahmen ${r.info.fTop.toFixed(1)} mm`);
}
process.exit(fail ? 1 : 0);
