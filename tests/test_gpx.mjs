// FIT-Parser und Statistik mit einer synthetisch erzeugten FIT-Datei (keine echten Daten nötig)
import { parseFIT, cleanTrack, trackStats, statValues, fillTemplate, combinedValues, fmtDuration } from '../js/gpx.js';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FEHLER ') + m); if (!c) fail++; };

// Minimaler FIT-Schreiber: Records (lat, lon, Höhe, Zeit) + Sessions
function makeFIT(sessions) {
  const bytes = [];
  const u8 = (v) => bytes.push(v & 255);
  const u16 = (v) => { u8(v); u8(v >> 8); };
  const u32 = (v) => { u16(v & 0xffff); u16(v >>> 16); };
  const i32 = (v) => u32(v >>> 0);
  // Definition lokal 0 = record (20): 253 timestamp u32, 0 lat s32, 1 lon s32, 2 altitude u16
  u8(0x40); u8(0); u8(0); u16(20); u8(4);
  u8(253); u8(4); u8(0x86); u8(0); u8(4); u8(0x85); u8(1); u8(4); u8(0x85); u8(2); u8(2); u8(0x84);
  // Definition lokal 1 = session (18): 2 start_time u32, 5 sport enum, 7 elapsed u32, 8 timer u32, 9 dist u32
  u8(0x41); u8(0); u8(0); u16(18); u8(5);
  u8(2); u8(4); u8(0x86); u8(5); u8(1); u8(0); u8(7); u8(4); u8(0x86); u8(8); u8(4); u8(0x86); u8(9); u8(4); u8(0x86);
  for (const s of sessions) {
    for (const p of s.points) { u8(0); u32(p.ts); i32(Math.round(p.lat / (180 / 2 ** 31))); i32(Math.round(p.lon / (180 / 2 ** 31))); u16(Math.round((p.ele + 500) * 5)); }
  }
  for (const s of sessions) { u8(1); u32(s.start); u8(s.sport); u32(s.elapsed * 1000); u32(s.elapsed * 1000); u32(s.dist * 100); }
  const data = Uint8Array.from(bytes);
  const out = new Uint8Array(14 + data.length + 2);
  out[0] = 14; out[1] = 0x20;
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  out.set(data, 14);
  return out;
}
// Lauf: 10 km nach Norden in 50 min (5:00 /km), 100 m Anstieg
const T0 = 1000000000;
const run = { sport: 1, start: T0, elapsed: 3000, dist: 10000, points: [] };
for (let i = 0; i <= 100; i++) run.points.push({ ts: T0 + i * 30, lat: 47 + (i / 100) * (10000 / 111195), lon: 11, ele: 500 + i });
let tr = parseFIT(makeFIT([run]));
ok(tr.length === 1 && tr[0].sport === 'run' && tr[0].points.length === 101, `FIT gelesen: ${tr[0].points.length} Punkte, Sport ${tr[0].sport}`);
const t = tr[0]; cleanTrack(t); t.stats = trackStats(t);
const v = statValues(t);
ok(v.distanz === '10,0 km' && v.zeit === '50:00' && v.pace === '5:00 /km', `Statistik: ${v.distanz}, ${v.zeit}, ${v.pace}, ${v.hm}`);
ok(Math.abs(t.points[100].lat - (47 + 10000 / 111195)) < 1e-6, 'Koordinaten exakt (Semicircles)');
ok(fillTemplate('{name} · {distanz} · {fehlt} · {pace}', { name: 'X', distanz: '10 km', pace: '' }) === 'X · 10 km', 'Vorlage: leere Werte ohne doppelte Trenner');

// Multisport: Schwimmen (ohne GPS) + Rad + Lauf in einer Datei
const swim = { sport: 5, start: T0, elapsed: 1200, dist: 1500, points: [] };
const bike = { sport: 2, start: T0 + 1300, elapsed: 3600, dist: 40000, points: [] };
for (let i = 0; i <= 60; i++) bike.points.push({ ts: T0 + 1300 + i * 60, lat: 47, lon: 11 + (i / 60) * 0.5, ele: 400 });
const run2 = { sport: 1, start: T0 + 5000, elapsed: 2400, dist: 10000, points: [] };
for (let i = 0; i <= 40; i++) run2.points.push({ ts: T0 + 5000 + i * 60, lat: 47 + i * 0.002, lon: 11.5, ele: 400 });
tr = parseFIT(makeFIT([swim, bike, run2]));
ok(tr.length === 3 && tr[0].sport === 'swim' && tr[0].points.length === 0 && tr[1].sport === 'bike' && tr[2].sport === 'run', `Multisport getrennt: ${tr.map((x) => x.sport + ':' + x.points.length).join(', ')} (Schwimmen ohne GPS bleibt für die Statistik)`);
for (const x of tr) { if (x.points.length) cleanTrack(x); x.stats = trackStats(x); }
const c = combinedValues(tr);
ok(c.distanz === '51,5 km' && c.zeit === fmtDuration(5000 + 2400), `Summe: ${c.distanz}, Gesamtzeit ${c.zeit}`);
process.exit(fail ? 1 : 0);
