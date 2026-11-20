// 3D-Karte: Gelände aus Höhendaten, Untergrund (Wald, Wiese, Wasser, …), Gebäude, Straßen,
// Routen/Aktivitäten und Beschriftungen als ein geschlossenes, mehrfarbiges Netz.
//
// Alles wird auf EINEM Raster in EINER Projektion (Web-Mercator -> mm) berechnet: Höhen,
// Untergrund, Tracks und Text. Dadurch liegen Tracks immer exakt auf bzw. in der Oberfläche.
// Die Höhe eines Tracks kommt nie aus der GPS-Höhe, sondern aus dem Gelände an derselben Stelle.
//
// Reines JS ohne three.js/DOM – in Node testbar. Höhen werden über eine Funktion elev(mx, my)
// (Mercator-Meter) geliefert, Texte als fertige Masken (siehe mapui.js).

export const R_MERC = 6378137;
export const merc = (lat, lon) => {
  const la = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return [R_MERC * lon * Math.PI / 180, R_MERC * Math.log(Math.tan(Math.PI / 4 + la / 2))];
};
export const unmerc = (x, y) => [(2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * 180 / Math.PI, (x / R_MERC) * 180 / Math.PI];

// Untergrund-Klassen (Reihenfolge = Zeichenreihenfolge, später gewinnt)
export const CLASSES = {
  base: { name: 'Gelände (sonst)', color: '#d9cfb8' },
  farmland: { name: 'Acker / Feld', color: '#e9d27a' },
  meadow: { name: 'Wiese / Grünfläche', color: '#9ccf6b' },
  forest: { name: 'Wald', color: '#2f6b35' },
  rock: { name: 'Fels / Geröll', color: '#9a948a' },
  glacier: { name: 'Gletscher / Schnee', color: '#f4f7fb' },
  urban: { name: 'Siedlung', color: '#b9b4ae' },
  water: { name: 'Wasser', color: '#3d7fd9' },
  road: { name: 'Straßen', color: '#f5f1e8' },
  building: { name: 'Gebäude', color: '#c0392b' },
};
export const CLASS_KEYS = Object.keys(CLASSES);
const CLS = Object.fromEntries(CLASS_KEYS.map((k, i) => [k, i]));

export function defaultMapConfig() {
  return {
    area: { lat: 47.4211, lon: 10.9853, widthM: 6000, aspect: 1 },
    sizeMm: 160, res: 0.4,
    shape: 'rect', radius: 0,
    terrain: { exag: 1.5, base: 3, smooth: 0.6, sea: true, autoRelief: 0, minElev: null },
    surface: { mode: 'osm', hypsBands: 4, waterDepth: 0.5, rivers: true },
    buildings: { on: true, factor: 2, minMm: 0.6 },
    roads: { on: false, level: 'major', raise: 0.2, widthMm: 0.8 },
    frame: { width: 6, height: 1.5, mode: 'follow', followMm: 5, style: 'bevelIn', profileMm: 1.2, trans: 'hard', transMm: 3, band: 'bottom', bandMm: 22 },
    slots: { base: 0, farmland: 0, meadow: 0, forest: 0, rock: 0, glacier: 0, urban: 0, water: 0, road: 0, building: 0, frame: 0, band: 0, side: 0 },
  };
}

// ---------------------------------------------------------------- Layout
// Gebiet in Mercator: Mittelpunkt + Breite/Höhe (Mercator-Meter)
export function areaMerc(a) {
  const [cx, cy] = merc(a.lat, a.lon);
  const w = a.widthM / Math.cos(a.lat * Math.PI / 180);
  return { cx, cy, w, h: w * a.aspect };
}

const sdBox = (x, y, cx, cy, hx, hy, r = 0) => {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdHex = (x, y, r) => { // flache Kanten oben/unten, Inkreisradius r
  const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
  let px = Math.abs(x), py = Math.abs(y);
  const d = 2 * Math.min(kx * px + ky * py, 0);
  px -= d * kx; py -= d * ky;
  px -= Math.max(-kz * r, Math.min(kz * r, px)); py -= r;
  return Math.hypot(px, py) * Math.sign(py);
};

// Karte (mm), Plattenumriss und Titelleiste. Kartenmitte = (0,0), Norden = +y.
export function layoutMap(cfg) {
  const W = cfg.sizeMm;
  const round = cfg.shape === 'circle' || cfg.shape === 'hex';
  const H = round ? W : W * cfg.area.aspect;
  const f = Math.max(0, cfg.frame.width || 0);
  const band = !round && f > 0 && cfg.frame.band !== 'none' ? Math.max(0, cfg.frame.bandMm || 0) : 0;
  const bandSide = cfg.frame.band === 'top' ? 1 : -1;
  let sdMap, sdPlate, bbox, bandRect = null;
  if (cfg.shape === 'circle') {
    sdMap = (x, y) => Math.hypot(x, y) - W / 2;
    sdPlate = (x, y) => Math.hypot(x, y) - W / 2 - f;
    bbox = [-W / 2 - f, -W / 2 - f, W / 2 + f, W / 2 + f];
  } else if (cfg.shape === 'hex') {
    const r = W / 2 * 0.866025404; // Breite = Ecke zu Ecke
    sdMap = (x, y) => sdHex(x, y, r);
    sdPlate = (x, y) => sdHex(x, y, r + f);
    const R = (r + f) / 0.866025404;
    bbox = [-R, -(r + f), R, r + f];
  } else {
    const rad = Math.max(0, cfg.radius || 0);
    const y0 = -H / 2 - (bandSide < 0 ? band : 0), y1 = H / 2 + (bandSide > 0 ? band : 0);
    const pcx = 0, pcy = (y0 + y1) / 2, phx = W / 2 + f, phy = (y1 - y0) / 2 + f;
    sdMap = (x, y) => sdBox(x, y, 0, 0, W / 2, H / 2, Math.max(0, Math.min(rad - f, W / 2, H / 2)));
    sdPlate = (x, y) => sdBox(x, y, pcx, pcy, phx, phy, Math.min(rad, phx, phy));
    bbox = [pcx - phx, pcy - phy, pcx + phx, pcy + phy];
    if (band) bandRect = bandSide < 0 ? [-W / 2, -H / 2 - band, W / 2, -H / 2] : [-W / 2, H / 2, W / 2, H / 2 + band];
  }
  return { W, H, f, band, bandRect, sdMap, sdPlate, bbox, round };
}

// ---------------------------------------------------------------- Raster-Helfer
// Raster: Punkt (i,j) bei x0 + i*dx, y0 + j*dy
function makeGrid(x0, y0, dx, dy, nx, ny) { return { x0, y0, dx, dy, nx, ny }; }

// Polygone (Ringe, gerade-ungerade Regel) auf Rasterpunkte malen: cb(index)
function fillRings(G, rings, cb) {
  let ymin = Infinity, ymax = -Infinity;
  for (const r of rings) for (let k = 1; k < r.length; k += 2) { if (r[k] < ymin) ymin = r[k]; if (r[k] > ymax) ymax = r[k]; }
  const j0 = Math.max(0, Math.ceil((ymin - G.y0) / G.dy)), j1 = Math.min(G.ny - 1, Math.floor((ymax - G.y0) / G.dy));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const y = G.y0 + j * G.dy;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ya = r[2 * a + 1], yb = r[2 * b + 1];
        if ((ya > y) !== (yb > y)) xs.push(r[2 * a] + ((y - ya) / (yb - ya)) * (r[2 * b] - r[2 * a]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - G.x0) / G.dx)), i1 = Math.min(G.nx - 1, Math.floor((xs[k + 1] - G.x0) / G.dx));
      for (let i = i0; i <= i1; i++) cb(j * G.nx + i);
    }
  }
}

// Linienzüge mit halber Breite hw: cb(index, abstand, t entlang)
function strokeLine(G, pts, hw, cb) {
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - hw - G.x0) / G.dx)), i1 = Math.min(G.nx - 1, Math.floor((Math.max(ax, bx) + hw - G.x0) / G.dx));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - hw - G.y0) / G.dy)), j1 = Math.min(G.ny - 1, Math.floor((Math.max(ay, by) + hw - G.y0) / G.dy));
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-12;
    for (let j = j0; j <= j1; j++) {
      const y = G.y0 + j * G.dy;
      for (let i = i0; i <= i1; i++) {
        const x = G.x0 + i * G.dx;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
        const d = Math.hypot(x - ax - t * vx, y - ay - t * vy);
        if (d <= hw) cb(j * G.nx + i, d);
      }
    }
  }
}

function blur(Z, nx, ny, sigma, mask) {
  if (!(sigma > 0.3)) return;
  const r = Math.ceil(sigma * 2.5), k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); s += w; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float64Array(Z.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let a = 0;
    for (let q = -r; q <= r; q++) a += k[q + r] * Z[j * nx + Math.max(0, Math.min(nx - 1, i + q))];
    tmp[j * nx + i] = a;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (mask && !mask[c]) continue;
    let a = 0;
    for (let q = -r; q <= r; q++) a += k[q + r] * tmp[Math.max(0, Math.min(ny - 1, j + q)) * nx + i];
    Z[c] = a;
  }
}

// Linie glätten (gleitender Mittelwert über ~win mm), Endpunkte bleiben
export function smoothLine(pts, win) {
  if (!(win > 0) || pts.length < 6) return pts;
  const n = pts.length / 2, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  const out = new Float64Array(pts.length);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (cum[i] - cum[a] > win / 2) a++;
    while (b + 1 < n && cum[b + 1] - cum[i] <= win / 2) b++;
    let sx = 0, sy = 0;
    for (let k = a; k <= b; k++) { sx += pts[2 * k]; sy += pts[2 * k + 1]; }
    out[2 * i] = sx / (b - a + 1); out[2 * i + 1] = sy / (b - a + 1);
  }
  out[0] = pts[0]; out[1] = pts[1]; out[pts.length - 2] = pts[pts.length - 2]; out[pts.length - 1] = pts[pts.length - 1];
  return out;
}

// ---------------------------------------------------------------- Hauptfunktion
// data: { elev(mx,my) -> m, features: [{cls, kind:'poly'|'line', rings|line (Mercator), width?, levels?}],
//         tracks: [{line: [mx,my,…] oder lines: [[…],…], slot, widthMm, mode, height, smoothMm, markers, markerSlot}],
//         texts: [{mask:{x0,y0,w,h,cols,rows,data}, mode, height, slot, plaque?:{rect:[x0,y0,x1,y1], slot, height}, region:'map'|'band'}],
//         pockets: [{rect:[x0,y0,x1,y1], depth}] (Rückseite) }
export function buildMap(cfg, data, progress = () => {}) {
  const L = layoutMap(cfg);
  const A = areaMerc(cfg.area);
  const s = L.W / A.w; // mm pro Mercator-Meter
  const toX = (mx) => (mx - A.cx) * s, toY = (my) => (my - A.cy) * s;
  const fromX = (x) => A.cx + x / s, fromY = (y) => A.cy + y / s;
  const latRad = cfg.area.lat * Math.PI / 180;
  const vs = (s / Math.cos(latRad)) * cfg.terrain.exag; // mm pro Höhenmeter (inkl. Überhöhung)

  // Raster so wählen, dass ein rechteckiger Umriss genau auf Rasterlinien liegt
  const [bx0, by0, bx1, by1] = L.bbox;
  const nx = Math.max(4, Math.round((bx1 - bx0) / cfg.res)), ny = Math.max(4, Math.round((by1 - by0) / cfg.res));
  const dx = (bx1 - bx0) / nx, dy = (by1 - by0) / ny;
  const VX = nx + 1, VY = ny + 1, NV = VX * VY;
  const VG = makeGrid(bx0, by0, dx, dy, VX, VY); // Eckpunkte
  const SG = makeGrid(bx0 + dx / 4, by0 + dy / 4, dx / 2, dy / 2, 2 * nx, 2 * ny); // Farbraster (Dreiecks-Schwerpunkte)
  const SX = 2 * nx, NS = SX * 2 * ny;
  if (NV > 9e6) throw new Error('Zu fein: bitte die Auflösung (mm) erhöhen.');

  // Region je Punkt: 0 = außen, 1 = Rahmen/Leiste, 2 = Karte
  const regionAt = (x, y) => (L.sdMap(x, y) <= 1e-9 ? 2 : L.sdPlate(x, y) <= 1e-9 ? 1 : 0);
  const inBand = (x, y) => L.bandRect && x >= L.bandRect[0] - 1e-9 && x <= L.bandRect[2] + 1e-9 && y >= L.bandRect[1] - 1e-9 && y <= L.bandRect[3] + 1e-9;
  const vreg = new Uint8Array(NV);
  for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) vreg[j * VX + i] = regionAt(bx0 + i * dx, by0 + j * dy);
  const sreg = new Uint8Array(NS);
  for (let j = 0; j < 2 * ny; j++) for (let i = 0; i < SX; i++) sreg[j * SX + i] = regionAt(SG.x0 + i * SG.dx, SG.y0 + j * SG.dy);

  // ---- Gelände: Rohhöhen (m) an allen Kartenpunkten (+ 1 Zelle Rand für weiche Kanten)
  progress('Höhen');
  const E = new Float64Array(NV);
  let eMin = Infinity, eMax = -Infinity;
  for (let j = 0; j < VY; j++) {
    const my = fromY(by0 + j * dy);
    for (let i = 0; i < VX; i++) {
      const c = j * VX + i;
      let e = data.elev(fromX(bx0 + i * dx), my);
      if (!isFinite(e)) e = 0;
      if (cfg.terrain.sea && e < 0) e = 0;
      E[c] = e;
      if (vreg[c] === 2) { if (e < eMin) eMin = e; if (e > eMax) eMax = e; }
    }
  }
  if (!isFinite(eMin)) { eMin = 0; eMax = 0; }
  const base = Math.max(0.6, cfg.terrain.base);
  const eRef = cfg.terrain.minElev != null && isFinite(cfg.terrain.minElev) ? Math.min(cfg.terrain.minElev, eMin) : eMin;
  let vsc = vs;
  if (cfg.terrain.autoRelief > 0 && eMax > eRef) vsc = cfg.terrain.autoRelief / (eMax - eRef);
  const Z = new Float64Array(NV);
  for (let c = 0; c < NV; c++) Z[c] = base + Math.max(0, E[c] - eRef) * vsc;
  const smoothCells = (cfg.terrain.smooth || 0) / dx;
  blur(Z, VX, VY, smoothCells, null);
  for (let c = 0; c < NV; c++) if (Z[c] < base) Z[c] = base;

  // ---- Untergrund
  progress('Untergrund');
  const cls = new Uint8Array(NS); // Klasse je Farbpixel
  const mode = cfg.surface.mode;
  const feats = (data.features || []).map((f) => ({
    ...f,
    rings: f.rings && f.rings.map((r) => { const o = new Float64Array(r.length); for (let k = 0; k < r.length; k += 2) { o[k] = toX(r[k]); o[k + 1] = toY(r[k + 1]); } return o; }),
    line: f.line && (() => { const r = f.line, o = new Float64Array(r.length); for (let k = 0; k < r.length; k += 2) { o[k] = toX(r[k]); o[k + 1] = toY(r[k + 1]); } return o; })(),
  }));
  const isWaterV = new Uint8Array(NV);
  if (mode === 'osm') {
    const order = ['farmland', 'meadow', 'forest', 'rock', 'glacier', 'urban', 'water'];
    for (const k of order) {
      for (const f of feats) {
        if (f.cls !== k || f.kind !== 'poly') continue;
        fillRings(SG, f.rings, (i) => { cls[i] = CLS[k]; });
      }
    }
    if (cfg.terrain.sea) {
      for (let j = 0; j < 2 * ny; j++) for (let i = 0; i < SX; i++) {
        const x = SG.x0 + i * SG.dx, y = SG.y0 + j * SG.dy;
        if (data.elev(fromX(x), fromY(y)) <= 0.05) cls[j * SX + i] = CLS.water;
      }
    }
  } else if (mode === 'hyps') {
    // Höhenstufen: Klasse = Index der Stufe (wird über slots.hyps[] gefärbt)
    const nb = Math.max(2, Math.min(8, cfg.surface.hypsBands || 4));
    for (let j = 0; j < 2 * ny; j++) for (let i = 0; i < SX; i++) {
      const x = SG.x0 + i * SG.dx, y = SG.y0 + j * SG.dy;
      const e = data.elev(fromX(x), fromY(y));
      cls[j * SX + i] = 100 + Math.max(0, Math.min(nb - 1, Math.floor(((e - eRef) / Math.max(1, eMax - eRef)) * nb)));
    }
  }

  // Wasserflächen eben und leicht vertieft (Seen); Flüsse als Rinne
  const wd = Math.max(0, cfg.surface.waterDepth || 0);
  if (mode === 'osm') {
    for (const f of feats) {
      if (f.cls !== 'water' || f.kind !== 'poly') continue;
      const idx = [];
      fillRings(VG, f.rings, (i) => { if (vreg[i] === 2) idx.push(i); });
      if (!idx.length) continue;
      let zmin = Infinity;
      for (const i of idx) if (Z[i] < zmin) zmin = Z[i];
      const zw = Math.max(base * 0.6, zmin - wd);
      for (const i of idx) { Z[i] = zw; isWaterV[i] = 1; }
    }
    if (cfg.surface.rivers) {
      for (const f of feats) {
        if (f.cls !== 'water' || f.kind !== 'line') continue;
        const hw = Math.max(dx * 0.75, (f.widthMm || Math.max(0.7, (f.widthM || 10) * s / Math.cos(latRad))) / 2);
        strokeLine(SG, f.line, hw, (i) => { cls[i] = CLS.water; });
        strokeLine(VG, f.line, hw, (i) => { if (vreg[i] === 2 && !isWaterV[i]) { Z[i] = Math.max(base * 0.6, Z[i] - wd); isWaterV[i] = 1; } });
      }
    }
  }

  // Straßen (nur Farbe oder leicht erhaben)
  if (mode === 'osm' && cfg.roads.on) {
    const hw = Math.max(dx * 0.6, cfg.roads.widthMm / 2);
    const rr = new Uint8Array(NV);
    for (const f of feats) {
      if (f.cls !== 'road' || (cfg.roads.level === 'major' && !f.major)) continue;
      const w = hw * (f.weight || 1);
      strokeLine(SG, f.line, w, (i) => { if (cls[i] !== CLS.water) cls[i] = CLS.road; });
      if (cfg.roads.raise > 0) strokeLine(VG, f.line, w, (i) => { if (vreg[i] === 2 && !isWaterV[i]) rr[i] = 1; });
    }
    if (cfg.roads.raise > 0) for (let c = 0; c < NV; c++) if (rr[c]) Z[c] += cfg.roads.raise;
  }

  // Gebäude: flaches Dach über dem höchsten Geländepunkt der Grundfläche
  if (mode === 'osm' && cfg.buildings.on) {
    const bvs = (s / Math.cos(latRad)) * Math.max(0.1, cfg.buildings.factor);
    const ZB = Z.slice();
    for (const f of feats) {
      if (f.cls !== 'building') continue;
      const idx = [];
      fillRings(VG, f.rings, (i) => { if (vreg[i] === 2) idx.push(i); });
      if (!idx.length) continue;
      let zmax = 0;
      for (const i of idx) if (ZB[i] > zmax) zmax = ZB[i];
      const h = Math.max(cfg.buildings.minMm, (f.height || 8) * bvs);
      for (const i of idx) Z[i] = Math.max(Z[i], zmax + h);
      fillRings(SG, f.rings, (i) => { cls[i] = CLS.building; });
    }
  }

  // ---- Farben (Slot je Farbpixel)
  const slots = cfg.slots;
  const hypsSlots = cfg.slots.hyps || [];
  const SL = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const k = cls[i];
    SL[i] = k >= 100 ? (hypsSlots[k - 100] ?? slots.base) : (slots[CLASS_KEYS[k]] ?? slots.base);
  }

  // ---- Übergang Karte -> Rahmen (Schattenfuge oder sanft auslaufend)
  const fr = cfg.frame;
  const tw = Math.max(0, fr.transMm || 0);
  const transOn = L.f > 0 && tw > 0 && (fr.trans === 'groove' || fr.trans === 'fade');
  // Randhöhe am noch unveränderten Gelände messen (innerhalb der Übergangszone)
  const edgeIn = transOn ? tw : 0;
  let edgeMax0 = base;
  for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) {
    const c = j * VX + i;
    if (vreg[c] !== 2) continue;
    const d = -L.sdMap(bx0 + i * dx, by0 + j * dy);
    if (d >= edgeIn && d < edgeIn + 1.6 * dx && Z[c] > edgeMax0) edgeMax0 = Z[c];
  }
  const VE = new Uint8Array(NV); // Eckpunkte in der Übergangszone (für Seitenfarbe)
  if (L.f > 0 && tw > 0 && (fr.trans === 'groove' || fr.trans === 'fade')) {
    for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) {
      const c = j * VX + i;
      if (vreg[c] !== 2) continue;
      const d = -L.sdMap(bx0 + i * dx, by0 + j * dy);
      if (d < tw + dx) VE[c] = 1;
      if (d >= tw) continue;
      if (fr.trans === 'groove') Z[c] = base;
      else { const t = d / tw, e = t * t * (3 - 2 * t); Z[c] = base + (Z[c] - base) * e; }
    }
    if (fr.trans === 'groove') {
      for (let i = 0; i < NS; i++) {
        if (sreg[i] !== 2) continue;
        if (-L.sdMap(SG.x0 + (i % SX) * SG.dx, SG.y0 + Math.floor(i / SX) * SG.dy) < tw) SL[i] = slots.side ?? slots.frame;
      }
    }
  }

  // ---- Tracks (Höhe mit weichem Rand: Gewicht 0..1 je Eckpunkt)
  progress('Routen');
  const ZT = Z.slice(); // Gelände ohne Tracks/Text: Bezug für alle Aufsätze
  const soft = (W, hw) => (i, d) => { const w = Math.max(0, Math.min(1, (hw + dx * 0.5 - d) / dx)); if (vreg[i] === 2 && w > W[i]) W[i] = w; };
  for (const t of data.tracks || []) {
    const lines = (t.lines || [t.line]).map((ln) => {
      const o = new Float64Array(ln.length);
      for (let k = 0; k < ln.length; k += 2) { o[k] = toX(ln[k]); o[k + 1] = toY(ln[k + 1]); }
      return smoothLine(o, t.smoothMm || 0);
    });
    const hw = Math.max(dx * 0.75, t.widthMm / 2);
    const W = new Float32Array(NV);
    for (const ln of lines) {
      strokeLine(SG, ln, hw, (i) => { if (sreg[i] === 2) SL[i] = t.slot; });
      strokeLine(VG, ln, hw + dx * 0.5, soft(W, hw));
    }
    applyRelief(Z, ZT, W, t.mode, t.height, base);
    if (t.markers && lines.length) {
      const first = lines[0], last = lines[lines.length - 1];
      const r = Math.max(t.widthMm * 1.6, 1.6);
      const ms = new Float32Array(NV);
      for (const [px, py] of [[first[0], first[1]], [last[last.length - 2], last[last.length - 1]]]) {
        strokeLine(SG, [px, py, px, py], r, (i) => { if (sreg[i] === 2) SL[i] = t.markerSlot ?? t.slot; });
        strokeLine(VG, [px, py, px, py], r + dx * 0.5, soft(ms, r));
      }
      applyRelief(Z, ZT, ms, t.mode === 'engrave' ? 'engrave' : 'raise', Math.max(t.height, 0.4) + 0.4, base);
    }
  }

  // ---- Rahmen und Titelleiste
  // Höhe: fest über der Grunddicke, über dem Kartenrand (Berge ragen nie darüber) oder über dem Gipfel
  let edgeMax = edgeMax0, peak = base;
  for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) {
    const c = j * VX + i;
    if (vreg[c] !== 2) continue;
    if (Z[c] > peak) peak = Z[c];
    const d = -L.sdMap(bx0 + i * dx, by0 + j * dy);
    if (d >= edgeIn && d < edgeIn + 1.6 * dx && Z[c] > edgeMax) edgeMax = Z[c]; // inkl. Routen am Rand
  }
  const fh = Math.max(0, fr.height || 0);
  // bei „Rand“/„Gipfel“ liegt auch die tiefste Stelle des Profils noch um fh über dem Gelände
  const pAdd = fr.style && fr.style !== 'flat' ? Math.max(0, fr.profileMm ?? 1.5) : 0;
  const fTop = fr.mode === 'edge' || fr.mode === 'follow' ? edgeMax + fh + pAdd : fr.mode === 'peak' ? peak + fh + pAdd : base + fh;
  const pd = Math.max(0, Math.min(fr.profileMm ?? 1.5, fTop - base - 0.4));
  const sdBand = L.bandRect ? (x, y) => sdBox(x, y, (L.bandRect[0] + L.bandRect[2]) / 2, (L.bandRect[1] + L.bandRect[3]) / 2, (L.bandRect[2] - L.bandRect[0]) / 2, (L.bandRect[3] - L.bandRect[1]) / 2) : () => Infinity;
  const drop = (sv) => { // 0 = volle Höhe, 1 = um pd tiefer; sv: 0 innen … 1 außen
    switch (fr.style) {
      case 'round': return 1 - Math.sqrt(Math.max(0, 1 - (2 * sv - 1) ** 2));
      case 'bevelIn': return sv < 0.55 ? (0.55 - sv) / 0.55 : 0;
      case 'bevelOut': return sv > 0.45 ? (sv - 0.45) / 0.55 : 0;
      case 'step': return sv < 0.4 ? 1 : 0;
      case 'stepOut': return sv > 0.6 ? 1 : 0;
      default: return 0;
    }
  };
  // „folgt dem Rand“: Höhe = Gelände am nächstgelegenen Kartenrand (entlang des Randes geglättet) + Zugabe
  const ZG = Z; // Gelände inkl. Routen
  const zAt = (x, y) => {
    const fx = Math.max(0, Math.min(VX - 1.001, (x - bx0) / dx)), fy = Math.max(0, Math.min(VY - 1.001, (y - by0) / dy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, c = j * VX + i;
    return (ZG[c] * (1 - u) + ZG[c + 1] * u) * (1 - v) + (ZG[c + VX] * (1 - u) + ZG[c + VX + 1] * u) * v;
  };
  const follow = fr.mode === 'follow';
  const fw = Math.max(2, fr.followMm ?? 5); // Glättung entlang des Randes
  const followAt = (x, y) => {
    const e = 1e-3, d = L.sdMap(x, y);
    let gx = (L.sdMap(x + e, y) - L.sdMap(x - e, y)) / (2 * e), gy = (L.sdMap(x, y + e) - L.sdMap(x, y - e)) / (2 * e);
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    const inset = d + edgeIn + 1.2 * dx; // auf den Rand und knapp hinein
    const px = x - gx * inset, py = y - gy * inset;
    let m = base;
    for (let k = -4; k <= 4; k++) { const t = (k / 4) * fw; m = Math.max(m, zAt(px - gy * t, py + gx * t)); }
    return m;
  };
  let bandTop = fTop;
  if (follow && L.bandRect) { // Titelleiste eben: höchster Randpunkt an der Leiste
    const [b0, b1, b2, b3] = L.bandRect, ey = Math.abs(b3 + L.H / 2) < 1e-6 ? b3 : b1; // Kante Karte/Leiste
    let m = base;
    for (let x = b0; x <= b2; x += dx) m = Math.max(m, followAt(x, ey));
    bandTop = m + fh + pAdd;
  }
  for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) {
    const c = j * VX + i;
    if (vreg[c] !== 1) continue;
    const x = bx0 + i * dx, y = by0 + j * dy;
    if (inBand(x, y)) { Z[c] = bandTop; continue; }
    const sm = L.sdMap(x, y), sb = sdBand(x, y);
    const din = Math.max(0, Math.min(sm, sb)), dout = Math.max(0, -L.sdPlate(x, y));
    const topHere = !follow ? fTop : sb < sm ? bandTop : Math.max(followAt(x, y) + fh + pAdd, base + fh);
    Z[c] = topHere - pd * drop(din / Math.max(1e-9, din + dout));
  }
  for (let i = 0; i < NS; i++) {
    if (sreg[i] !== 1) continue;
    const x = SG.x0 + (i % SX) * SG.dx, y = SG.y0 + Math.floor(i / SX) * SG.dy;
    SL[i] = inBand(x, y) ? (slots.band ?? slots.frame) : slots.frame;
  }
  const ZF = Z.slice();

  // ---- Texte (Maske bilinear -> weiche Kanten in der Höhe, Farbe scharf)
  progress('Beschriftung');
  for (const tx of data.texts || []) {
    const M = tx.mask;
    const alpha = (x, y) => {
      const fx = ((x - M.x0) / M.w) * M.cols - 0.5, fy = ((M.y0 + M.h - y) / M.h) * M.rows - 0.5;
      const u = Math.floor(fx), v = Math.floor(fy), a = fx - u, b = fy - v;
      const g = (uu, vv) => (uu >= 0 && vv >= 0 && uu < M.cols && vv < M.rows ? M.data[vv * M.cols + uu] : 0);
      return ((g(u, v) * (1 - a) + g(u + 1, v) * a) * (1 - b) + (g(u, v + 1) * (1 - a) + g(u + 1, v + 1) * a) * b) / 255;
    };
    const want = tx.region === 'band' ? 1 : 2;
    const okReg = (r) => r === want;
    let ref = ZF;
    if (tx.plaque) {
      const [px0, py0, px1, py1] = tx.plaque.rect;
      const pv = new Float32Array(NV);
      for (let j = 0; j < VY; j++) for (let i = 0; i < VX; i++) {
        const x = bx0 + i * dx, y = by0 + j * dy;
        if (x >= px0 && x <= px1 && y >= py0 && y <= py1 && vreg[j * VX + i] >= 1) pv[j * VX + i] = 1;
      }
      applyRelief(Z, ZF, pv, 'flat', tx.plaque.height, base);
      for (let i = 0; i < NS; i++) {
        const x = SG.x0 + (i % SX) * SG.dx, y = SG.y0 + Math.floor(i / SX) * SG.dy;
        if (x >= px0 && x <= px1 && y >= py0 && y <= py1 && sreg[i] >= 1) SL[i] = tx.plaque.slot;
      }
      ref = Z.slice();
    }
    const tv = new Float32Array(NV);
    for (let j = 0; j < VY; j++) {
      const y = by0 + j * dy;
      if (y < M.y0 - dy || y > M.y0 + M.h + dy) continue;
      for (let i = 0; i < VX; i++) {
        const c = j * VX + i, x = bx0 + i * dx;
        if (!okReg(vreg[c]) || x < M.x0 - dx || x > M.x0 + M.w + dx) continue;
        const a = alpha(x, y);
        if (a > 0.2) tv[c] = Math.min(1, (a - 0.2) / 0.55);
      }
    }
    for (let j = 0; j < 2 * ny; j++) {
      const y = SG.y0 + j * SG.dy;
      if (y < M.y0 || y > M.y0 + M.h) continue;
      for (let i = 0; i < SX; i++) {
        const k = j * SX + i, x = SG.x0 + i * SG.dx;
        if (x < M.x0 || x > M.x0 + M.w) continue;
        if (okReg(sreg[k]) && alpha(x, y) >= 0.5) SL[k] = tx.slot;
      }
    }
    applyRelief(Z, ref, tv, tx.mode, tx.height, base);
  }

  // ---- Rückseite: Taschen (Stecksystem, Aufhängung), je Zelle
  const B = new Float64Array(nx * ny);
  for (const p of data.pockets || []) {
    const [px0, py0, px1, py1] = p.rect;
    const i0 = Math.max(0, Math.floor((px0 - bx0) / dx + 1e-6)), i1 = Math.min(nx, Math.ceil((px1 - bx0) / dx - 1e-6));
    const j0 = Math.max(0, Math.floor((py0 - by0) / dy + 1e-6)), j1 = Math.min(ny, Math.ceil((py1 - by0) / dy - 1e-6));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) B[j * nx + i] = Math.max(B[j * nx + i], p.depth);
  }

  progress('Netz');
  const mesh = meshField({ nx, ny, dx, dy, x0: bx0, y0: by0, Z, SL, SX, B, L, VR: vreg, VE: fr.trans === 'groove' ? VE : null, sideSlot: slots.side ?? slots.frame ?? slots.base });
  return {
    ...mesh, layout: L, grid: { nx, ny, dx, dy, x0: bx0, y0: by0 },
    info: { eMin, eMax, eRef, vsc, base, fTop, zMax: Math.max(...sampleMax(Z)), mmPerM: s / Math.cos(latRad), scale: Math.round(1000 / (s / Math.cos(latRad))) },
    transform: { toX, toY, s },
  };
}

function sampleMax(Z) { let m = 0; for (let i = 0; i < Z.length; i++) if (Z[i] > m) m = Z[i]; return [m]; }

// Relief für Punkte mit Gewicht w (0..1, weicher Rand): raise = über Gelände, flat = eben über dem
// höchsten Punkt, engrave = eingraviert, flush = nur Farbe
function applyRelief(Z, ref, W, mode, h, base) {
  h = Math.max(0, h || 0);
  if (mode === 'flush' || !h) return;
  if (mode === 'flat') {
    let m = -Infinity;
    for (let c = 0; c < W.length; c++) if (W[c] >= 0.5 && ref[c] > m) m = ref[c];
    if (!isFinite(m)) for (let c = 0; c < W.length; c++) if (W[c] > 0 && ref[c] > m) m = ref[c];
    for (let c = 0; c < W.length; c++) if (W[c] > 0) Z[c] = Math.max(Z[c], ref[c] + (m + h - ref[c]) * W[c]);
  } else if (mode === 'engrave') {
    for (let c = 0; c < W.length; c++) if (W[c] > 0) Z[c] = Math.max(base * 0.5, Math.min(Z[c], ref[c] - h * W[c]));
  } else {
    for (let c = 0; c < W.length; c++) if (W[c] > 0) Z[c] = Math.max(Z[c], ref[c] + h * W[c]);
  }
}

// ---------------------------------------------------------------- Netz
// Geschlossenes Netz: glatte Oberseite aus Eckhöhen, Unterseite je Zelle (mit Taschen),
// Seitenwände am Umriss. Ebene Bereiche gleicher Farbe werden zu Rechtecken zusammengefasst.
// Alle Kanten bleiben konform (keine T-Stellen) -> dicht und mannigfaltig.
function meshField(F) {
  const { nx, ny, dx, dy, x0, y0, Z, SL, SX, B, L, VR, VE, sideSlot } = F;
  const VX = nx + 1;
  // Zellen innerhalb des Umrisses (Zellmitte)
  const inc = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) inc[j * nx + i] = L.sdPlate(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy) <= 0 ? 1 : 0;
  const cellIn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && inc[j * nx + i] === 1;
  // Eckpunkt-Positionen; Randpunkte auf die exakte Kontur schieben (Kreis, Sechseck, Rundung)
  const PX = new Float64Array(VX * (ny + 1)), PY = new Float64Array(VX * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const v = j * VX + i;
    let x = x0 + i * dx, y = y0 + j * dy;
    const k = cellIn(i - 1, j - 1) + cellIn(i, j - 1) + cellIn(i - 1, j) + cellIn(i, j);
    if (k > 0 && k < 4) {
      for (let it = 0; it < 3; it++) {
        const d = L.sdPlate(x, y);
        if (Math.abs(d) < 1e-7) break;
        const e = 1e-4, gx = (L.sdPlate(x + e, y) - L.sdPlate(x - e, y)) / (2 * e), gy = (L.sdPlate(x, y + e) - L.sdPlate(x, y - e)) / (2 * e);
        const g = Math.hypot(gx, gy) || 1;
        const mv = Math.min(Math.abs(d), 0.75 * Math.hypot(dx, dy));
        x -= (Math.sign(d) * mv * gx) / g; y -= (Math.sign(d) * mv * gy) / g;
      }
    }
    PX[v] = x; PY[v] = y;
  }

  let pos = new Float32Array(1 << 21), col = new Uint8Array(1 << 18), np = 0, nt = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, s) => {
    if (np + 9 > pos.length) { const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2; }
    if (nt + 1 > col.length) { const c2 = new Uint8Array(col.length * 2); c2.set(col); col = c2; }
    pos[np++] = ax; pos[np++] = ay; pos[np++] = az; pos[np++] = bx; pos[np++] = by; pos[np++] = bz; pos[np++] = cx; pos[np++] = cy; pos[np++] = cz;
    col[nt++] = s;
  };
  const zv = (i, j) => Z[j * VX + i];
  const slotAt = (fx, fy) => { // Farbpixel an Zellkoordinate (fx,fy) in Zellen
    const u = Math.max(0, Math.min(SX - 1, Math.floor(fx * 2))), w = Math.max(0, Math.min(2 * ny - 1, Math.floor(fy * 2)));
    return SL[w * SX + u];
  };

  // --- Oberseite: Diagonale je Zelle und Farben der beiden Dreiecke
  const diag = new Uint8Array(nx * ny), s1 = new Uint8Array(nx * ny), s2 = new Uint8Array(nx * ny), flat = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!inc[c]) continue;
    const a = zv(i, j), b = zv(i + 1, j), cc = zv(i + 1, j + 1), d = zv(i, j + 1);
    const dg = Math.abs(a - cc) <= Math.abs(b - d) ? 0 : 1; // 0: a-c, 1: b-d
    diag[c] = dg;
    if (dg === 0) { s1[c] = slotAt(i + 2 / 3, j + 1 / 3); s2[c] = slotAt(i + 1 / 3, j + 2 / 3); }
    else { s1[c] = slotAt(i + 1 / 3, j + 1 / 3); s2[c] = slotAt(i + 2 / 3, j + 2 / 3); }
    // Übergang Karte -> Rahmen: steile Zelle wie eine Seitenwand färben
    if (VR) {
      const r0 = VR[j * VX + i], r1 = VR[j * VX + i + 1], r2 = VR[(j + 1) * VX + i + 1], r3 = VR[(j + 1) * VX + i];
      const mixed = r0 !== r1 || r1 !== r2 || r2 !== r3;
      const inEdge = VE && (VE[j * VX + i] || VE[j * VX + i + 1] || VE[(j + 1) * VX + i + 1] || VE[(j + 1) * VX + i]);
      if ((mixed || inEdge) && Math.max(a, b, cc, d) - Math.min(a, b, cc, d) > 1.5 * dx) s1[c] = s2[c] = sideSlot;
    }
    flat[c] = a === b && b === cc && cc === d && s1[c] === s2[c] ? 1 : 0;
  }
  const fkey = (c) => zv(c % nx, (c / nx) | 0) * 1000 + s1[c];
  const flatSame = (i, j, k) => cellIn(i, j) && flat[j * nx + i] && fkey(j * nx + i) === k;
  const innerTop = (i, j) => { // Eckpunkt vollständig von gleichen ebenen Zellen umgeben?
    if (!cellIn(i - 1, j - 1) || !flat[(j - 1) * nx + i - 1]) return false;
    const k = fkey((j - 1) * nx + i - 1);
    return flatSame(i, j - 1, k) && flatSame(i - 1, j, k) && flatSame(i, j, k);
  };
  const P = (i, j) => j * VX + i;
  const rects = (ok, key) => {
    const used = new Uint8Array(nx * ny), out = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (used[c] || !ok(c)) continue;
      const k = key(c);
      let i1 = i + 1;
      while (i1 < nx && !used[j * nx + i1] && ok(j * nx + i1) && key(j * nx + i1) === k) i1++;
      let j1 = j + 1;
      for (; j1 < ny; j1++) {
        let good = true;
        for (let x = i; x < i1; x++) { const d = j1 * nx + x; if (used[d] || !ok(d) || key(d) !== k) { good = false; break; } }
        if (!good) break;
      }
      for (let y = j; y < j1; y++) used.fill(1, y * nx + i, y * nx + i1);
      out.push(i, j, i1, j1, c);
    }
    return out;
  };
  const emitRects = (R, inner, zOf, slotOf, up) => {
    const mark = new Uint8Array(VX * (ny + 1));
    for (let r = 0; r < R.length; r += 5) { const i0 = R[r], j0 = R[r + 1], i1 = R[r + 2], j1 = R[r + 3]; mark[P(i0, j0)] = mark[P(i1, j0)] = mark[P(i0, j1)] = mark[P(i1, j1)] = 1; }
    const pts = [];
    for (let r = 0; r < R.length; r += 5) {
      const i0 = R[r], j0 = R[r + 1], i1 = R[r + 2], j1 = R[r + 3], c = R[r + 4];
      pts.length = 0;
      const add = (i, j) => { if (mark[P(i, j)] || !inner(i, j)) pts.push(P(i, j)); };
      for (let x = i0; x < i1; x++) add(x, j0);
      for (let y = j0; y < j1; y++) add(i1, y);
      for (let x = i1; x > i0; x--) add(x, j1);
      for (let y = j1; y > j0; y--) add(i0, y);
      const z = zOf(c), sl = slotOf(c), n = pts.length;
      const T = (a, b, q) => (up ? tri(PX[a], PY[a], z, PX[b], PY[b], z, PX[q], PY[q], z, sl) : tri(PX[a], PY[a], z, PX[q], PY[q], z, PX[b], PY[b], z, sl));
      if (n === 4) { T(pts[0], pts[1], pts[2]); T(pts[0], pts[2], pts[3]); continue; }
      // Mittelpunkt-Fächer (Randpunkte liegen auf den Rechteckkanten)
      let mx = 0, my = 0;
      for (const q of pts) { mx += PX[q]; my += PY[q]; }
      mx /= n; my /= n;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        if (up) tri(mx, my, z, PX[a], PY[a], z, PX[b], PY[b], z, sl); else tri(mx, my, z, PX[b], PY[b], z, PX[a], PY[a], z, sl);
      }
    }
  };
  emitRects(rects((c) => inc[c] && flat[c], fkey), innerTop, (c) => zv(c % nx, (c / nx) | 0), (c) => s1[c], true);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!inc[c] || flat[c]) continue;
    const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    const V = (v) => [PX[v], PY[v], Z[v]];
    if (diag[c] === 0) { tri(...V(a), ...V(b), ...V(cc), s1[c]); tri(...V(a), ...V(cc), ...V(d), s2[c]); }
    else { tri(...V(a), ...V(b), ...V(d), s1[c]); tri(...V(b), ...V(cc), ...V(d), s2[c]); }
  }

  // --- Unterseite (z = B je Zelle), zusammengefasst
  const bAt = (i, j) => (cellIn(i, j) ? B[j * nx + i] : -1);
  const innerBot = (i, j) => { const k = bAt(i - 1, j - 1); return k >= 0 && bAt(i, j - 1) === k && bAt(i - 1, j) === k && bAt(i, j) === k; };
  emitRects(rects((c) => inc[c] === 1, (c) => B[c]), innerBot, (c) => B[c], () => sideSlot, false);

  // --- Senkrechte Linien: alle Höhenstufen der angrenzenden Zellen (Unterseiten) + Oberseite
  const levels = (i, j, lo, hi) => {
    const out = [];
    for (const v of [bAt(i - 1, j - 1), bAt(i, j - 1), bAt(i - 1, j), bAt(i, j)]) if (v >= lo && v <= hi && !out.includes(v)) out.push(v);
    if (!out.includes(lo)) out.push(lo);
    const zt = Z[P(i, j)];
    if (hi >= zt && !out.includes(zt)) out.push(zt);
    return out.filter((v) => v >= lo - 1e-12 && v <= hi + 1e-12).sort((p, q) => p - q);
  };
  // Wand zwischen Punkten p1 -> p2 (Blick von außen: p1 links), Höhen A (bei p1) und B (bei p2)
  const zipper = (p1, p2, A, Bl) => {
    const x1 = PX[p1], y1 = PY[p1], x2 = PX[p2], y2 = PY[p2];
    let i = 0, k = 0;
    while (i < A.length - 1 || k < Bl.length - 1) {
      if (k < Bl.length - 1 && (i === A.length - 1 || Bl[k + 1] <= A[i + 1])) {
        tri(x1, y1, A[i], x2, y2, Bl[k], x2, y2, Bl[k + 1], sideSlot); k++;
      } else {
        tri(x1, y1, A[i], x2, y2, Bl[k], x1, y1, A[i + 1], sideSlot); i++;
      }
    }
  };
  // Außenwände: Kante einer Zelle ohne Nachbarzelle, von der Zellunterseite bis zur Oberseite
  // Innenwände der Taschen: zwischen Zellen mit unterschiedlicher Unterseite
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!inc[c]) continue;
    const b0 = B[c];
    const edges = [[i, j, i + 1, j, i, j - 1], [i + 1, j, i + 1, j + 1, i + 1, j], [i + 1, j + 1, i, j + 1, i, j + 1], [i, j + 1, i, j, i - 1, j]];
    for (const [ai, aj, bi, bj, ni, nj] of edges) {
      const pa = P(ai, aj), pb = P(bi, bj);
      if (!cellIn(ni, nj)) {
        zipper(pa, pb, levels(ai, aj, b0, Z[pa]), levels(bi, bj, b0, Z[pb]));
      } else {
        const bn = B[nj * nx + ni];
        if (bn > b0) zipper(pa, pb, levels(ai, aj, b0, bn), levels(bi, bj, b0, bn)); // Taschenwand, Blick in die Tasche
      }
    }
  }
  return { pos: pos.slice(0, np), col: col.slice(0, nt) };
}
