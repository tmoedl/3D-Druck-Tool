import { columnsToMesh, keyPart, photoFrame, medalHolder, textPlate, planModules, defaultModuleConfig, photoDims, keyPockets } from '../js/modules.js';
import { checkMesh } from './meshcheck.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FEHLER ') + m); if (!c) fail++; };
const good = (m) => m.open === 0 && m.nonManifold === 0 && m.flipped === 0 && m.degenerate === 0 && m.vol > 0;
const show = (name, mesh) => { const m = checkMesh(mesh.pos); ok(good(m), `${name}: ${m.tris} Dreiecke, offen ${m.open}, nm ${m.nonManifold}, verdreht ${m.flipped}, entartet ${m.degenerate}, Vol ${(m.vol / 1000).toFixed(2)} cm³`); return m; };

const MC = defaultModuleConfig();
const K = MC.key;
const km = show('Verbinder', keyPart(K));
const expVol = (K.neckL * K.neckW + 2 * K.headL * K.headW) * K.t;
ok(Math.abs(km.vol - expVol) < 1e-3, `Verbinder-Volumen ${km.vol.toFixed(2)} = ${expVol}`);

// Tasche passt zum Verbinder: Tasche = Verbinder + Spiel
const pk = [...keyPockets(K, 'R', 0, 0), ...keyPockets(K, 'L', 0, 0)];
const covers = (x, y) => pk.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
let inside = true;
for (let x = -K.neckL / 2 - K.headL; x <= K.neckL / 2 + K.headL; x += 0.25) for (let y = -K.headW / 2; y <= K.headW / 2; y += 0.25) {
  const inKey = (Math.abs(x) <= K.neckL / 2 && Math.abs(y) <= K.neckW / 2) || (Math.abs(x) >= K.neckL / 2 && Math.abs(y) <= K.headW / 2);
  if (inKey && !covers(x, y)) inside = false;
}
ok(inside, 'Verbinder liegt vollständig in den beiden Taschenhälften');

// Hohlraum + Überhang + Taschen
const P = { ...MC.photo, ...photoDims(MC.photo) };
const pockets = [{ rect: [-62, -10, -50, 10], depth: 3.4 }, { rect: [-5, 70, 5, 88], depth: 3.5 }];
show('Bilderrahmen 10x15 mit Taschen', photoFrame(P, 128, 180, 7, pockets).mesh);
const mask = { x0: -30, y0: 2, w: 60, h: 10, cols: 120, rows: 20, data: new Uint8Array(2400).map((_, i) => ((i % 120) / 7 | 0) % 2 ? 255 : 0) };
show('Medaillenhalter mit Text', medalHolder({ ...MC.medal, textH: 1 }, 200, 45, 7, [{ rect: [-100, 5, -88, 15], depth: 3.4 }], [mask]).mesh);
show('Textschild', textPlate({ ...MC.text, textH: 1 }, 120, 40, 7, [], [mask]).mesh);

// Planung: Karte + rechts Foto + unten Medaillen
const plan = planModules({ ...MC, on: true }, [-90, -100, 90, 100]);
ok(plan.mods.length === 3 && plan.keys >= 4, `Planung: ${plan.mods.length} Module, ${plan.keys} Verbinder`);
for (const m of plan.mods) ok(m.pockets.length > 0, `  ${m.id} (${m.type}) hat ${m.pockets.length} Taschen`);
process.exit(fail ? 1 : 0);
