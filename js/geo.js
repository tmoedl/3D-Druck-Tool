// Geodaten aus dem Netz: Höhen (AWS Terrain Tiles, „Terrarium“-Kodierung) und
// OpenStreetMap-Objekte (Overpass-API), Ortssuche (Nominatim). Alles wird in IndexedDB
// zwischengespeichert, damit ein Gebiet nur einmal geladen werden muss.
//
// Höhen: © Mapzen / AWS Open Data (SRTM, EU-DEM, NED u. a.), Kartendaten: © OpenStreetMap-Mitwirkende (ODbL).

import { merc, unmerc, R_MERC } from './terrain.js';

const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const OVERPASS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const WORLD = 2 * Math.PI * R_MERC;

// ---------------------------------------------------------------- Cache (IndexedDB)
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('3d-druck-tool-geo', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('c'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function cacheGet(k) {
  const d = await db();
  if (!d) return undefined;
  return new Promise((res) => { try { const q = d.transaction('c').objectStore('c').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } });
}
async function cachePut(k, v) {
  const d = await db();
  if (!d) return;
  try { d.transaction('c', 'readwrite').objectStore('c').put(v, k); } catch { /* voll – egal */ }
}

// ---------------------------------------------------------------- Höhen
// bbox in Mercator [x0,y0,x1,y1]; cellM = gewünschter Punktabstand in Mercator-Metern
export function demZoom(bbox, cellM, maxTiles = 80) {
  let z = Math.round(Math.log2(WORLD / 256 / Math.max(cellM, 0.5)));
  z = Math.max(1, Math.min(15, z));
  while (z > 1 && tileRange(bbox, z).count > maxTiles) z--;
  return z;
}
function tileRange(b, z) {
  const n = 2 ** z, tx = (x) => ((x + WORLD / 2) / WORLD) * n, ty = (y) => ((WORLD / 2 - y) / WORLD) * n;
  const x0 = Math.floor(tx(b[0])), x1 = Math.floor(tx(b[2]) - 1e-9), y0 = Math.floor(ty(b[3])), y1 = Math.floor(ty(b[1]) - 1e-9);
  return { x0, x1, y0, y1, n, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

async function fetchTilePixels(url) {
  let blob = await cacheGet(url);
  if (!(blob instanceof Blob)) {
    let err;
    for (let tries = 0; tries < 3; tries++) {
      try {
        const r = await fetch(url);
        if (r.status === 404 || r.status === 403) { blob = null; break; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blob = await r.blob();
        break;
      } catch (e) { err = e; await new Promise((s) => setTimeout(s, 400 * (tries + 1))); }
    }
    if (blob === undefined) throw new Error('Höhendaten nicht erreichbar (' + (err?.message || 'Netzwerk') + ')');
    if (blob) cachePut(url, blob);
  }
  if (!blob) return null; // Meer / keine Daten
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(256, 256);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, 256, 256).data;
}

// Lädt die Kacheln und liefert elev(mx,my) (bilinear). onProgress(done,total)
export async function loadDEM(bbox, cellM, onProgress = () => {}) {
  const z = demZoom(bbox, cellM);
  const R = tileRange(bbox, z);
  const tw = R.x1 - R.x0 + 1, th = R.y1 - R.y0 + 1, W = tw * 256, H = th * 256;
  const E = new Float32Array(W * H);
  let done = 0;
  const jobs = [];
  for (let ty = R.y0; ty <= R.y1; ty++) for (let tx = R.x0; tx <= R.x1; tx++) jobs.push([tx, ty]);
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.shift();
      const px = await fetchTilePixels(DEM_URL(z, ((tx % R.n) + R.n) % R.n, ty));
      const ox = (tx - R.x0) * 256, oy = (ty - R.y0) * 256;
      if (px) {
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
          const i = 4 * (y * 256 + x);
          E[(oy + y) * W + ox + x] = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
        }
      }
      onProgress(++done, R.count);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const pix = WORLD / (R.n * 256); // Mercator-Meter pro Pixel
  const gx0 = (R.x0 / R.n) * WORLD - WORLD / 2, gy0 = WORLD / 2 - (R.y0 / R.n) * WORLD; // linke obere Ecke
  const elev = (mx, my) => {
    const fx = (mx - gx0) / pix - 0.5, fy = (gy0 - my) / pix - 0.5;
    const x = Math.max(0, Math.min(W - 1.001, fx)), y = Math.max(0, Math.min(H - 1.001, fy));
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const a = E[j * W + i], b = E[j * W + i + 1], c = E[(j + 1) * W + i], d = E[(j + 1) * W + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  return { elev, z, tiles: R.count, resM: pix };
}

// ---------------------------------------------------------------- OpenStreetMap (Overpass)
const LANDUSE = {
  forest: 'forest', meadow: 'meadow', grass: 'meadow', recreation_ground: 'meadow', village_green: 'meadow', orchard: 'meadow', cemetery: 'meadow', greenfield: 'meadow',
  farmland: 'farmland', vineyard: 'farmland', allotments: 'farmland', farmyard: 'farmland', greenhouse_horticulture: 'farmland', plant_nursery: 'farmland',
  residential: 'urban', commercial: 'urban', industrial: 'urban', retail: 'urban', construction: 'urban', garages: 'urban', railway: 'urban', military: 'urban', education: 'urban', religious: 'urban',
  reservoir: 'water', basin: 'water', quarry: 'rock',
};
const NATURAL = { wood: 'forest', water: 'water', grassland: 'meadow', heath: 'meadow', scrub: 'forest', wetland: 'meadow', fell: 'meadow', bare_rock: 'rock', scree: 'rock', shingle: 'rock', sand: 'rock', beach: 'rock', glacier: 'glacier', bay: 'water' };
const LEISURE = { park: 'meadow', garden: 'meadow', pitch: 'meadow', golf_course: 'meadow', playground: 'meadow', track: 'urban' };
const ROADS = { motorway: 1.8, trunk: 1.6, primary: 1.35, secondary: 1.15, tertiary: 1, unclassified: 0.75, residential: 0.7, living_street: 0.6, service: 0.45, track: 0.5, path: 0.4, footway: 0.35, cycleway: 0.4, bridleway: 0.4, steps: 0.35 };
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const RIVERS = { river: 22, canal: 14, stream: 4 }; // ungefähre Breite in m

export function osmQuery(bbox, { buildings, roads, streams } = {}) {
  const [la0, lo0] = unmerc(bbox[0], bbox[1]), [la1, lo1] = unmerc(bbox[2], bbox[3]);
  const bb = `${la0.toFixed(6)},${lo0.toFixed(6)},${la1.toFixed(6)},${lo1.toFixed(6)}`;
  const lu = Object.keys(LANDUSE).join('|'), na = Object.keys(NATURAL).join('|'), le = Object.keys(LEISURE).join('|');
  const rw = streams ? 'river|canal|stream' : 'river|canal';
  const roadSel = roads === 'all' ? Object.keys(ROADS).join('|') : MAJOR.concat(['unclassified', 'residential']).join('|');
  return `[out:json][timeout:150][maxsize:536870912][bbox:${bb}];
(
 way["landuse"~"^(${lu})$"];relation["landuse"~"^(${lu})$"]["type"="multipolygon"];
 way["natural"~"^(${na})$"];relation["natural"~"^(${na})$"]["type"="multipolygon"];
 way["leisure"~"^(${le})$"];relation["leisure"~"^(${le})$"]["type"="multipolygon"];
 way["waterway"~"^(riverbank|dock)$"];relation["waterway"="riverbank"];
 way["water"];relation["water"]["type"="multipolygon"];
 way["waterway"~"^(${rw})$"];
 ${buildings ? 'way["building"];relation["building"]["type"="multipolygon"];' : ''}
 ${roads ? `way["highway"~"^(${roadSel})$"];` : ''}
 node["place"~"^(city|town|village|hamlet|suburb|locality)$"]["name"];
 node["natural"~"^(peak|volcano|saddle)$"]["name"];
 way["natural"="water"]["name"];
);
out geom;`;
}

export async function loadOSM(bbox, opts = {}, onStatus = () => {}) {
  const q = osmQuery(bbox, opts);
  const key = 'osm:' + q;
  let json = await cacheGet(key);
  if (typeof json !== 'string') {
    let lastErr = null;
    for (const url of OVERPASS) {
      try {
        onStatus('OSM-Daten von ' + new URL(url).host + ' …');
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(50000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        json = await r.text();
        if (!json.startsWith('{')) throw new Error('ungültige Antwort');
        const parsed = JSON.parse(json);
        if (parsed.remark && /runtime error|timed out|out of memory/i.test(parsed.remark)) throw new Error(parsed.remark);
        cachePut(key, json);
        lastErr = null;
        break;
      } catch (e) { lastErr = e.name === 'TimeoutError' ? new Error('Zeitüberschreitung') : e; json = null; }
    }
    if (lastErr) throw new Error('OpenStreetMap-Daten nicht erreichbar: ' + lastErr.message);
  }
  return parseOSM(JSON.parse(json));
}

const toM = (g) => { const o = new Float64Array(g.length * 2); g.forEach((p, i) => { const [x, y] = merc(p.lat, p.lon); o[2 * i] = x; o[2 * i + 1] = y; }); return o; };
const closed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

// Ringe aus Teilstücken zusammensetzen (Multipolygon-Relationen)
function assemble(parts) {
  const rings = [], open = parts.filter((p) => p.length > 1).map((p) => p.slice());
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  while (open.length) {
    let cur = open.shift();
    let grown = true;
    while (!same(cur[0], cur[cur.length - 1]) && grown) {
      grown = false;
      for (let k = 0; k < open.length; k++) {
        const p = open[k];
        const e = cur[cur.length - 1];
        if (same(e, p[0])) cur = cur.concat(p.slice(1));
        else if (same(e, p[p.length - 1])) cur = cur.concat(p.slice(0, -1).reverse());
        else if (same(cur[0], p[p.length - 1])) cur = p.slice(0, -1).concat(cur);
        else if (same(cur[0], p[0])) cur = p.slice(1).reverse().concat(cur);
        else continue;
        open.splice(k, 1); grown = true; break;
      }
    }
    if (cur.length > 3) rings.push(cur); // auch nicht ganz geschlossene Ringe (am Gebietsrand abgeschnitten) – gerade-ungerade füllt sie sinnvoll
  }
  return rings;
}

function classOf(t) {
  if (t.building) return 'building';
  if (t.natural && NATURAL[t.natural]) return NATURAL[t.natural];
  if (t.water || t.waterway === 'riverbank' || t.waterway === 'dock') return 'water';
  if (t.landuse && LANDUSE[t.landuse]) return LANDUSE[t.landuse];
  if (t.leisure && LEISURE[t.leisure]) return LEISURE[t.leisure];
  return null;
}

function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (h > 0) return h;
  const l = parseFloat(t['building:levels']);
  if (l > 0) return l * 3 + 2;
  return t.building === 'church' || t.building === 'cathedral' ? 20 : t.building === 'garage' || t.building === 'shed' ? 3 : 8;
}

export function parseOSM(j) {
  const features = [], places = [];
  for (const e of j.elements || []) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.place) places.push({ kind: t.place, name: t.name, x: merc(e.lat, e.lon)[0], y: merc(e.lat, e.lon)[1], pop: +t.population || 0 });
      else if (t.natural) places.push({ kind: t.natural, name: t.name, ele: parseFloat(t.ele), x: merc(e.lat, e.lon)[0], y: merc(e.lat, e.lon)[1] });
      continue;
    }
    if (e.type === 'way' && e.geometry) {
      if (t.highway && ROADS[t.highway]) { features.push({ cls: 'road', kind: 'line', line: toM(e.geometry), weight: ROADS[t.highway], major: MAJOR.includes(t.highway) }); continue; }
      if (t.waterway && RIVERS[t.waterway]) { features.push({ cls: 'water', kind: 'line', line: toM(e.geometry), widthM: RIVERS[t.waterway], name: t.name }); continue; }
      const c = classOf(t);
      if (!c || !closed(e.geometry)) continue;
      features.push({ cls: c, kind: 'poly', rings: [toM(e.geometry)], height: c === 'building' ? buildingHeight(t) : 0, name: t.name, area: 0 });
      if (c === 'water' && t.name) places.push({ kind: 'water', name: t.name, ...centroid(e.geometry) });
    } else if (e.type === 'relation' && e.members) {
      const c = classOf(t);
      if (!c) continue;
      const parts = e.members.filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === '')).map((m) => m.geometry);
      const rings = assemble(parts);
      if (rings.length) features.push({ cls: c, kind: 'poly', rings: rings.map(toM), height: c === 'building' ? buildingHeight(t) : 0, name: t.name });
    }
  }
  return { features, places };
}
function centroid(g) {
  let x = 0, y = 0;
  for (const p of g) { const m = merc(p.lat, p.lon); x += m[0]; y += m[1]; }
  return { x: x / g.length, y: y / g.length };
}

// ---------------------------------------------------------------- Ortssuche
export async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=de&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Suche nicht erreichbar (HTTP ' + r.status + ')');
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon, bbox: x.boundingbox ? x.boundingbox.map(Number) : null }));
}

export { merc, unmerc };
