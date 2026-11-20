// Karten-Studio: 3D-Karten aus Aktivitäten (GPX/FIT/TCX) oder Gebieten.
// Links 2D-Karte mit festem Sucher (= Ausschnitt) bzw. 3D-Vorschau, rechts Einstellungen.
// Beim Laden einer Aktivität entsteht sofort ein Vorschlag (Ausschnitt, Überhöhung, Farben,
// Titel mit Statistik) – danach ist alles einstellbar.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as GPX from './gpx.js';
import * as GEO from './geo.js';
import { buildMap, defaultMapConfig, CLASSES, merc, unmerc, areaMerc, layoutMap } from './terrain.js';
import * as MOD from './modules.js';

const $ = (id) => document.getElementById(id);
const WORLD = 2 * Math.PI * 6378137;
const de = (x, d = 1) => (+x).toFixed(d).replace('.', ',');

export const FONTS = {
  sans: ['Sans fett', "bold {px}px 'DejaVu Sans','Segoe UI',Arial,sans-serif"],
  narrow: ['Schmal fett', "bold {px}px 'DejaVu Sans Condensed','Arial Narrow','Roboto Condensed',sans-serif"],
  serif: ['Serif fett', "bold {px}px 'DejaVu Serif',Georgia,'Times New Roman',serif"],
  black: ['Plakativ', "900 {px}px Impact,'Arial Black','DejaVu Sans',sans-serif"],
  mono: ['Mono', "bold {px}px 'DejaVu Sans Mono',Consolas,monospace"],
};
const TEXT_MODES = { raise: 'erhaben (folgt dem Gelände)', flat: 'eben, abgehoben', plaque: 'auf Plakette', engrave: 'eingraviert', flush: 'nur farbig (bündig)' };
const BAND_MODES = { raise: 'erhaben', engrave: 'eingraviert', flush: 'nur farbig (bündig)' };
const TRACK_MODES = { raise: 'erhaben', flush: 'bündig (nur Farbe)', engrave: 'vertieft (Rinne)' };
const LABEL_KINDS = { city: 'Städte', town: 'Kleinstädte', village: 'Dörfer', hamlet: 'Weiler', suburb: 'Stadtteile', peak: 'Gipfel', water: 'Seen' };
const KIND_RANK = { city: 0, town: 1, peak: 2, village: 3, water: 4, suburb: 5, hamlet: 6, locality: 7, volcano: 2, saddle: 8 };
const KIND_SIZE = { city: 1.3, town: 1.1, village: 0.9, hamlet: 0.8, suburb: 0.85, peak: 0.85, water: 0.85, volcano: 0.85, locality: 0.75, saddle: 0.75 };

// Rollen = was eingefärbt wird -> Filament
const ROLES = {
  base: 'Gelände (sonst)', farmland: 'Acker / Feld', meadow: 'Wiese / Grünfläche', forest: 'Wald', rock: 'Fels / Geröll', glacier: 'Gletscher / Schnee',
  urban: 'Siedlung', water: 'Wasser', road: 'Straßen', building: 'Gebäude', frame: 'Rahmen', band: 'Titelleiste', side: 'Seiten & Unterseite',
  title: 'Titel & Statistik', labels: 'Ortsnamen', plaque: 'Plakette', marker: 'Start / Ziel', modPlate: 'Module (Stecksystem)', modText: 'Schrift auf Modulen',
};
const NAMED = {
  weiss: ['Weiß', '#f2f2f2'], schwarz: ['Schwarz', '#222222'], dgruen: ['Dunkelgrün', '#2f6b35'], hgruen: ['Hellgrün', '#8cc56b'],
  blau: ['Blau', '#2f6fd0'], rot: ['Rot', '#d62828'], grau: ['Grau', '#8d8d8d'], sand: ['Sand', '#e3cf9a'],
  orange: ['Orange', '#f77f00'], gelb: ['Gelb', '#f7c600'], lila: ['Lila', '#8e44ad'], pink: ['Pink', '#ec6fb0'],
  braun: ['Braun', '#8a5a33'], hblau: ['Hellblau', '#7cc0f0'], tuerkis: ['Türkis', '#1fb5a8'], dgrau: ['Dunkelgrau', '#4b4b4e'],
};
const HYPS = [['hgruen', 'dgruen', 'braun', 'weiss'], ['dgruen', 'hgruen', 'sand', 'braun', 'grau', 'weiss']];

export function initMap(app) {
  const S = {
    cfg: defaultMapConfig(),
    tracks: [],
    pal: [],
    roles: {},
    maxSlots: 8,
    text: { title: '{name}', sub: '{datum} · {distanz} · {zeit} · {pace}', sub2: '', pos: 'band', font: 'sans', size: 8, mode: 'raise', h: 0.8, overrides: {} },
    labels: { on: false, kinds: ['city', 'town', 'village', 'peak'], size: 3.5, mode: 'raise', h: 0.6, max: 12 },
    mods: MOD.defaultModuleConfig(),
    margin: 12,
    shape: 'rect',
  };
  let open = false, view = '2d', lmap = null, trackLayer = null, built = null, dataCache = { key: '', dem: null, osm: null }, pendingSuggest = false;
  let idSeq = 1;

  // ---------------------------------------------------------------- Farben
  function autoColors(n = S.maxSlots) {
    const names = n <= 4 ? ['weiss', 'dgruen', 'blau', 'rot'] : n <= 8 ? ['weiss', 'schwarz', 'dgruen', 'hgruen', 'blau', 'rot', 'grau', 'sand']
      : ['weiss', 'schwarz', 'dgruen', 'hgruen', 'blau', 'rot', 'grau', 'sand', 'orange', 'gelb', 'lila', 'braun', 'hblau', 'pink', 'tuerkis', 'dgrau'];
    S.pal = names.map((k) => ({ name: NAMED[k][0], color: NAMED[k][1], key: k }));
    const at = (k, f = 'weiss') => { const i = names.indexOf(k); return i >= 0 ? i : names.indexOf(f); };
    S.roles = {
      base: at('sand', 'weiss'), farmland: at('sand', 'weiss'), meadow: at('hgruen', 'weiss'), forest: at('dgruen'), rock: at('grau', 'weiss'), glacier: at('weiss'),
      urban: at('grau', 'weiss'), water: at('blau'), road: at('weiss'), building: n > 8 ? at('dgrau') : at('rot'), frame: at('weiss'), band: at('weiss'), side: at('weiss'),
      title: at('schwarz', 'rot'), labels: at('schwarz', 'rot'), plaque: at('weiss'), marker: at('schwarz', 'rot'), modPlate: at('weiss'), modText: at('schwarz', 'rot'),
      hyps: (n > 8 ? HYPS[1] : HYPS[0]).map((k) => at(k, 'weiss')),
    };
    if (n <= 4) { S.roles.meadow = at('weiss'); S.roles.building = at('rot'); }
    // Routen: kontrastreich zu Wald/Wiese/Wasser; nur gezeichnete Routen bekommen eine Farbe
    const trackOrder = n <= 4 ? ['rot'] : n <= 8 ? ['rot', 'weiss', 'schwarz', 'grau'] : ['rot', 'orange', 'lila', 'gelb', 'pink', 'schwarz'];
    let k = 0;
    for (const t of S.tracks) t.slot = t.noGps ? at('rot') : at(trackOrder[k++ % trackOrder.length], 'rot');
  }
  const slotColor = (i) => (S.pal[i] ? S.pal[i].color : '#888888');
  const slotOptions = (sel) => S.pal.map((p, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i + 1}: ${app.escapeHtml(p.name)}</option>`).join('');

  // ---------------------------------------------------------------- Texte -> Masken
  function textMask(lines, sizes, fontKey, align = 'center', ppm = 10) {
    const fmt = (FONTS[fontKey] || FONTS.sans)[1];
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    const metrics = lines.map((l, k) => {
      const px = Math.max(4, (sizes[k] || sizes[0]) * ppm / 0.72);
      g.font = fmt.replace('{px}', px.toFixed(1));
      return { l, px, w: g.measureText(l).width };
    });
    const W = Math.ceil(Math.max(1, ...metrics.map((m) => m.w)) + 8), H = Math.ceil(metrics.reduce((s, m) => s + m.px * 1.22, 0) + 8);
    if (W * H > 24e6) return null;
    cv.width = W; cv.height = H;
    g.fillStyle = '#fff';
    let y = 4;
    for (const m of metrics) {
      g.font = fmt.replace('{px}', m.px.toFixed(1));
      g.textBaseline = 'alphabetic';
      y += m.px * 0.95;
      const x = align === 'left' ? 4 : align === 'right' ? W - 4 - m.w : (W - m.w) / 2;
      g.fillText(m.l, x, y);
      y += m.px * 0.27;
    }
    const px = g.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (px[4 * (j * W + i) + 3] >= 128) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 < 0) return null;
    const cols = x1 - x0 + 1, rows = y1 - y0 + 1, data = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = px[4 * ((j + y0) * W + i + x0) + 3];
    return { cols, rows, data, w: cols / ppm, h: rows / ppm };
  }
  const place = (m, cx, cy) => ({ ...m, x0: cx - m.w / 2, y0: cy - m.h / 2 });
  // Maske in ein Rechteck einpassen (verkleinern falls nötig)
  function fitMask(lines, sizes, font, maxW, maxH, ppm = 10) {
    let m = textMask(lines, sizes, font, 'center', ppm);
    if (!m) return null;
    const f = Math.min(1, maxW / m.w, maxH / m.h);
    if (f < 0.999) m = textMask(lines, sizes.map((s) => s * f * 0.98), font, 'center', ppm);
    return m;
  }

  // ---------------------------------------------------------------- Werte / Statistik
  function statVals() {
    const tr = S.tracks.filter((t) => t.visible);
    let v = {};
    if (tr.length) {
      v = { ...GPX.statValues(tr[0]) };
      const c = GPX.combinedValues(tr);
      v.gesamtzeit = c.zeit; v.gesamtdistanz = c.distanz; v.gesamthm = c.hm;
      if (tr.length > 1) { v.datum = c.datum; v.distanz = c.distanz; v.zeit = c.zeit; v.hm = c.hm; if (new Set(tr.map((t) => t.sport)).size > 1) v.pace = ''; }
      tr.forEach((t, i) => { const s = GPX.statValues(t); for (const k in s) v[`${i + 1}.${k}`] = s[k]; });
    }
    for (const [k, x] of Object.entries(S.text.overrides)) if (x !== '' && x != null) v[k] = x;
    v.titel = GPX.fillTemplate((S.text.title || '').replace(/\{titel\}/g, ''), v) || v.name || '';
    return v;
  }
  // Mehrkampf erkennen: mehrere Sportarten -> Titel wie „Triathlon“
  function multiTitle(tr) {
    const s = new Set(tr.map((t) => t.sport));
    if (tr.length < 2 || s.size < 2) return '';
    if (s.has('swim') && s.has('bike') && s.has('run')) return 'Triathlon';
    if (s.has('swim') && s.has('run') && !s.has('bike')) return 'Aquathlon';
    if (s.has('bike') && s.has('run') && !s.has('swim')) return 'Duathlon';
    return 'Multisport';
  }

  // ---------------------------------------------------------------- Aktivitäten
  async function addFiles(files) {
    const added = [];
    for (const f of files) {
      try {
        const tr = await GPX.readActivityFile(f);
        for (const t of tr) added.push(newTrack(t));
      } catch (e) { app.toast(e.message || String(e), 6000); }
    }
    if (!added.length) return;
    S.tracks.push(...added);
    S.tracks.sort((a, b) => (a.stats.start || 0) - (b.stats.start || 0));
    suggest();
    renderTracks();
    showTab('act');
    $('mpName').textContent = '– ' + S.tracks.map((t) => t.name).join(', ').slice(0, 80);
    app.toast(`${added.length} ${added.length === 1 ? 'Route' : 'Routen'} geladen – Vorschlag erstellt. Alles bleibt einstellbar.`, 5000);
  }
  function newTrack(t) {
    return { id: idSeq++, name: t.name, sport: t.sport, points: t.points, breaks: t.breaks || [], stats: t.stats, noGps: !!t.noGps, visible: true, slot: 0, widthMm: 1.2, mode: 'raise', height: 0.8, smoothMm: 1, markers: true };
  }
  function trackLines(t) {
    const out = [];
    let cur = [];
    const br = new Set(t.breaks);
    t.points.forEach((p, i) => {
      if (br.has(i) && cur.length >= 4) { out.push(cur); cur = []; }
      const [x, y] = merc(p.lat, p.lon);
      cur.push(x, y);
    });
    if (cur.length >= 4) out.push(cur);
    return out;
  }
  function tracksBBox(list = S.tracks.filter((t) => t.visible)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of list) for (const p of t.points) { const [x, y] = merc(p.lat, p.lon); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 >= x0 ? [x0, y0, x1, y1] : null;
  }

  // ---------------------------------------------------------------- Vorschlag
  function fitToTracks(chooseAspect) {
    const b = tracksBBox();
    if (!b) return false;
    const m = S.margin / 100;
    const bw = Math.max(b[2] - b[0], 200), bh = Math.max(b[3] - b[1], 200);
    const round = S.shape === 'circle' || S.shape === 'hex';
    let aspect = S.cfg.area.aspect;
    if (round) aspect = 1;
    else if (chooseAspect) {
      const want = bh / bw, opts = [1, 0.75, 1.3333, 0.6667, 1.5, 0.5];
      aspect = opts.reduce((best, a) => (Math.abs(Math.log(a / want)) < Math.abs(Math.log(best / want)) ? a : best), 1);
    }
    let w = bw * (1 + 2 * m), h = bh * (1 + 2 * m);
    if (round) { const d = Math.hypot(bw, bh) * (1 + 2 * m) * (S.shape === 'hex' ? 1.08 : 1); w = h = d; }
    if (h / w > aspect) w = h / aspect;
    const [lat, lon] = unmerc((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    S.cfg.area = { lat, lon, widthM: w * Math.cos(lat * Math.PI / 180), aspect };
    return true;
  }
  function suggest() {
    const tr = S.tracks.filter((t) => t.visible);
    const cfg = S.cfg;
    if (tr.length) fitToTracks(true);
    const a = cfg.area;
    // Größe: längste Seite ~ 200 mm, passt mit Rahmen und Leiste auf 250er Druckbett
    const band = 22, f = 6;
    cfg.sizeMm = Math.round(Math.min(200, (230 - band - 2 * f) / Math.max(a.aspect, 0.01), 230 - 2 * f));
    cfg.frame = { ...cfg.frame, width: f, height: 1.5, mode: 'follow', style: 'bevelIn', profileMm: 1.2, trans: 'hard', transMm: 3, band: tr.length ? 'bottom' : 'none', bandMm: band };
    cfg.res = cfg.sizeMm > 170 ? 0.4 : 0.35;
    cfg.surface.mode = 'osm';
    cfg.buildings.on = a.widthM < 3500;
    cfg.roads.on = a.widthM < 2500;
    cfg.roads.raise = 0;
    // Routen
    const wTrack = Math.round(Math.max(0.9, Math.min(2, cfg.sizeMm / 140)) * 10) / 10;
    for (const t of tr) Object.assign(t, { widthMm: wTrack, mode: 'raise', height: 0.8, smoothMm: a.widthM > 20000 ? 1.5 : 0.8, markers: true });
    autoColors(S.maxSlots);
    // Beschriftung
    if (multiTitle(tr)) {
      S.text.title = multiTitle(tr);
      S.text.sub = tr.map((t, i) => `${GPX.SPORTS[t.sport]?.name || 'Teil'} {${i + 1}.zeit}`).join(' · ');
      S.text.sub2 = '{datum} · Gesamt {gesamtzeit}';
    } else if (tr.length) {
      const sp = tr[0].sport;
      S.text.title = '{name}';
      S.text.sub = sp === 'hike' || sp === 'walk' ? '{datum} · {distanz} · {hm} · {zeit}' : sp === 'bike' ? '{datum} · {distanz} · {zeit} · {pace} · {hm}' : '{datum} · {distanz} · {zeit} · {pace}';
      S.text.sub2 = '';
      if (GPX.fmtDate(tr[0].stats.start) && tr[0].name.includes(GPX.fmtDate(tr[0].stats.start))) S.text.sub = S.text.sub.replace('{datum} · ', '');
    } else {
      S.text.title = ''; S.text.sub = ''; S.text.sub2 = '';
    }
    S.text.pos = tr.length ? 'band' : 'none';
    S.text.size = 8; S.text.mode = 'raise';
    S.labels.on = true;
    S.labels.kinds = a.widthM > 15000 ? ['city', 'town', 'peak'] : ['city', 'town', 'village', 'peak', 'water'];
    S.labels.max = 10;
    S.labels.size = Math.round(Math.max(2.8, Math.min(4.5, cfg.sizeMm / 45)) * 2) / 2;
    pendingSuggest = true; // Überhöhung folgt, sobald Höhendaten da sind
    syncUI();
    setAreaView();
    redrawTracks();
    if (view === '3d') schedule(0);
  }
  function suggestRelief(info) {
    const cfg = S.cfg;
    const range = info.eMax - info.eMin;
    const natural = range * info.mmPerM;
    const target = range > 800 ? 16 : range > 250 ? 13 : 9;
    cfg.terrain.exag = Math.round(Math.max(1, Math.min(8, target / Math.max(natural, 0.01))) * 10) / 10;
    cfg.terrain.autoRelief = 0;
    syncUI();
  }

  // ---------------------------------------------------------------- 2D-Karte (Leaflet)
  function ensureLeaflet() {
    if (lmap || !window.L) return;
    const L = window.L;
    lmap = L.map('mpLeaflet', { zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, attributionControl: true });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc', attribution: 'Karte: © OpenTopoMap (CC-BY-SA), © OpenStreetMap' });
    topo.addTo(lmap);
    L.control.layers({ 'Topografisch (OpenTopoMap)': topo, 'Straßenkarte (OSM)': osm }, null, { position: 'topright' }).addTo(lmap);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(lmap);
    trackLayer = L.layerGroup().addTo(lmap);
    lmap.setView([S.cfg.area.lat, S.cfg.area.lon], 12);
    lmap.on('moveend', () => { if (!settingView) readAreaFromView(); });
    lmap.on('move zoom', updateFinderLabel);
    new ResizeObserver(() => { if (open && view === '2d') { lmap.invalidateSize(); layoutFinder(); setAreaView(); } }).observe($('mpLeaflet'));
  }
  let settingView = false;
  function finderPx() {
    const st = $('mpLeaflet').getBoundingClientRect();
    const round = S.shape === 'circle' || S.shape === 'hex';
    const asp = round ? 1 : S.cfg.area.aspect;
    const aw = Math.max(80, st.width - 90), ah = Math.max(80, st.height - 110);
    const w = Math.min(aw, ah / asp);
    return { w, h: w * asp };
  }
  function layoutFinder() {
    const { w, h } = finderPx();
    const fr = $('mpFinder').querySelector('.mpfr');
    fr.style.width = w + 'px'; fr.style.height = h + 'px';
    fr.className = 'mpfr' + (S.shape === 'circle' ? ' circle' : S.shape === 'round' ? ' round' : '');
    fr.style.clipPath = '';
    updateFinderLabel();
  }
  function setAreaView() {
    if (!lmap || !open) return;
    const a = S.cfg.area;
    const { w } = finderPx();
    const wMerc = a.widthM / Math.cos(a.lat * Math.PI / 180);
    const z = Math.log2((w * WORLD) / (256 * wMerc));
    settingView = true;
    lmap.setView([a.lat, a.lon], Math.max(1, Math.min(18, z)), { animate: false });
    settingView = false;
    updateFinderLabel();
  }
  function readAreaFromView() {
    if (!lmap._loaded) return;
    const c = lmap.getCenter(), z = lmap.getZoom();
    const { w } = finderPx();
    const wMerc = (w * WORLD) / (256 * 2 ** z);
    S.cfg.area = { ...S.cfg.area, lat: c.lat, lon: c.lng, widthM: wMerc * Math.cos(c.lat * Math.PI / 180) };
    $('mpWidthKm').value = de(S.cfg.area.widthM / 1000, 2).replace(',', '.');
    updateInfo();
  }
  function updateFinderLabel() {
    if (!lmap || !lmap._loaded) return;
    const z = lmap.getZoom(), c = lmap.getCenter();
    const { w, h } = finderPx();
    const wm = ((w * WORLD) / (256 * 2 ** z)) * Math.cos(c.lat * Math.PI / 180);
    const lbl = $('mpFinderLbl');
    lbl.textContent = `Ausschnitt ${de(wm / 1000, wm < 10000 ? 2 : 1)} × ${de((wm * h) / w / 1000, wm < 10000 ? 2 : 1)} km`;
    lbl.style.transform = `translateY(${-h / 2 - 14}px)`;
  }
  function redrawTracks() {
    if (!trackLayer) return;
    trackLayer.clearLayers();
    for (const t of S.tracks) {
      if (!t.visible) continue;
      for (const ln of trackLines(t)) {
        const ll = [];
        for (let k = 0; k < ln.length; k += 2) ll.push(unmerc(ln[k], ln[k + 1]));
        window.L.polyline(ll, { color: slotColor(t.slot), weight: 4, opacity: 0.95 }).addTo(trackLayer);
      }
    }
  }

  // ---------------------------------------------------------------- Daten laden
  function dataKey() {
    const c = S.cfg, a = c.area;
    return [a.lat.toFixed(5), a.lon.toFixed(5), Math.round(a.widthM), a.aspect, S.shape === 'circle' || S.shape === 'hex' ? 'r' : 's', c.buildings.on, c.roads.on && c.roads.level].join('|');
  }
  function dataBBox() {
    const A = areaMerc({ ...S.cfg.area, aspect: S.shape === 'circle' || S.shape === 'hex' ? 1 : S.cfg.area.aspect });
    const mx = A.w * 0.04, my = A.h * 0.04;
    return [A.cx - A.w / 2 - mx, A.cy - A.h / 2 - my, A.cx + A.w / 2 + mx, A.cy + A.h / 2 + my];
  }
  // Untergrund im Hintergrund laden – das Gelände ist sofort zu sehen
  function startOsm(dc, bbox) {
    $('mpOsmInfo').textContent = 'Untergrund (OpenStreetMap) wird geladen …';
    dc.osmErr = '';
    dc.osmPending = GEO.loadOSM(bbox, { buildings: S.cfg.buildings.on, roads: S.cfg.roads.on ? S.cfg.roads.level : false, streams: S.cfg.area.widthM < 12000 }, () => {})
      .then((osm) => { dc.osm = osm; })
      .catch((e) => { dc.osmErr = e.message; dc.osmFailedAt = Date.now(); })
      .finally(() => {
        dc.osmPending = null;
        $('mpOsmInfo').textContent = dc.osmErr ? '⚠ ' + dc.osmErr + ' – Karte vorerst ohne Untergrund. Bei der nächsten Änderung wird es erneut versucht.' : `${dc.osm.features.length.toLocaleString('de-DE')} Kartenobjekte, ${dc.osm.places.length} Namen · Höhen: Zoomstufe ${dc.dem.z}, ${dc.dem.tiles} Kacheln (~${Math.round(dc.dem.resM * Math.cos(S.cfg.area.lat * Math.PI / 180))} m)`;
        if (!dc.osmErr && dataCache === dc) schedule(50);
      });
  }
  async function ensureData(status, waitOsm = false) {
    const key = dataKey();
    if (dataCache.key !== key || !dataCache.dem) {
      const bbox = dataBBox();
      const A = areaMerc(S.cfg.area);
      const cellM = (Math.max(S.cfg.res, 0.3) / S.cfg.sizeMm) * A.w;
      status('Lade Höhendaten …');
      const dem = await GEO.loadDEM(bbox, cellM, (d, n) => status(`Lade Höhendaten … ${d}/${n}`));
      if (dataKey() !== key) return ensureData(status, waitOsm);
      dataCache = { key, dem, osm: { features: [], places: [] }, osmErr: '', osmPending: null };
      startOsm(dataCache, bbox);
    } else if (dataCache.osmErr && !dataCache.osmPending && Date.now() - dataCache.osmFailedAt > 15000) {
      startOsm(dataCache, dataBBox()); // erneuter Versuch nach einem Fehler
    }
    if (waitOsm && dataCache.osmPending) { status('Warte auf Untergrund (OpenStreetMap) …'); await dataCache.osmPending; }
    return dataCache;
  }

  // ---------------------------------------------------------------- Modell bauen
  function mapCfg(res) {
    const c = structuredClone(S.cfg);
    c.shape = S.shape === 'round' ? 'rect' : S.shape;
    c.radius = S.shape === 'round' ? (+$('mpRadius').value || 0) : 0;
    if (c.shape !== 'rect') c.area.aspect = 1;
    c.res = res;
    const R = S.roles;
    c.slots = { ...Object.fromEntries(Object.keys(CLASSES).map((k) => [k, R[k] ?? R.base])), frame: R.frame, band: R.band, side: R.side, hyps: R.hyps };
    if (c.surface.mode === 'mono') { for (const k of Object.keys(CLASSES)) c.slots[k] = R.base; c.surface.mode = 'osm'; }
    if (S.mods.on && c.shape === 'rect') c.terrain.base = Math.max(c.terrain.base, S.mods.key.t + S.mods.key.depthExtra + 1.2);
    return c;
  }
  function buildTexts(c, L, d, info) {
    const texts = [];
    const vals = statVals();
    const R = S.roles;
    const T = S.text;
    const lines = [T.title, T.sub, T.sub2].map((l) => GPX.fillTemplate(l || '', vals)).filter((l, i) => l || i === 0);
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const titleRects = [];
    if (T.pos !== 'none' && lines.some((l) => l)) {
      const sizes = lines.map((_, i) => (i === 0 ? T.size : T.size * 0.62));
      if (T.pos === 'band' && L.bandRect) {
        const [x0, y0, x1, y1] = L.bandRect;
        const m = fitMask(lines.map((l) => l || ' '), sizes, T.font, (x1 - x0) - 8, (y1 - y0) - 4);
        if (m) texts.push({ mask: place(m, (x0 + x1) / 2, (y0 + y1) / 2), mode: T.mode === 'engrave' ? 'engrave' : T.mode === 'flush' ? 'flush' : 'raise', height: T.h, slot: R.title, region: 'band' });
      } else if (T.pos !== 'band') {
        const m = fitMask(lines.map((l) => l || ' '), sizes, T.font, L.W * 0.8, L.H * 0.4);
        if (m) {
          const pad = 3 + (T.mode === 'plaque' ? 2 : 0);
          let cx = 0, cy = 0;
          if (T.pos.includes('l')) cx = -L.W / 2 + pad + m.w / 2; else if (T.pos.endsWith('r')) cx = L.W / 2 - pad - m.w / 2;
          if (T.pos.includes('b')) cy = -L.H / 2 + pad + m.h / 2; else if (T.pos.includes('t')) cy = L.H / 2 - pad - m.h / 2;
          if (T.pos === 'map-c') { cx = 0; cy = 0; }
          const mk = place(m, cx, cy);
          const t = { mask: mk, mode: T.mode === 'plaque' ? 'raise' : T.mode, height: T.h, slot: R.title, region: 'map' };
          if (T.mode === 'plaque') t.plaque = { rect: [mk.x0 - 2, mk.y0 - 2, mk.x0 + mk.w + 2, mk.y0 + mk.h + 2], slot: R.plaque, height: 1.2 };
          texts.push(t);
          titleRects.push([mk.x0 - 2, mk.y0 - 2, mk.x0 + mk.w + 2, mk.y0 + mk.h + 2]);
        }
      }
    }
    // Ortsnamen
    if (S.labels.on && d.osm && d.osm.places.length) {
      const A = areaMerc(c.area), s = L.W / A.w;
      const cand = d.osm.places.filter((p) => S.labels.kinds.includes(p.kind) || (p.kind === 'volcano' && S.labels.kinds.includes('peak')))
        .map((p) => ({ ...p, x: (p.x - A.cx) * s, y: (p.y - A.cy) * s }))
        .filter((p) => L.sdMap(p.x, p.y) < -3)
        .sort((p, q) => (KIND_RANK[p.kind] ?? 9) - (KIND_RANK[q.kind] ?? 9) || (q.pop || 0) - (p.pop || 0) || (q.ele || 0) - (p.ele || 0));
      const placed = titleRects.slice();
      const seen = new Set();
      // Routenpunkte (mm): Namen sollen keine Route verdecken
      const tpts = [];
      for (const t of S.tracks) {
        if (!t.visible || t.noGps) continue;
        const pad = t.widthMm / 2 + 0.6;
        for (const ln of trackLines(t)) for (let k = 0; k < ln.length; k += 2) tpts.push((ln[k] - A.cx) * s, (ln[k + 1] - A.cy) * s, pad);
      }
      const hitsTrack = (r) => { for (let k = 0; k < tpts.length; k += 3) { const x = tpts[k], y = tpts[k + 1], p = tpts[k + 2]; if (x > r[0] - p && x < r[2] + p && y > r[1] - p && y < r[3] + p) return true; } return false; };
      for (const p of cand) {
        if (texts.length - (T.pos !== 'none' ? 1 : 0) >= S.labels.max) break;
        if (!p.name || seen.has(p.name)) continue;
        const m = textMask([p.name], [S.labels.size * (KIND_SIZE[p.kind] || 1)], T.font);
        if (!m) continue;
        const cy = p.kind === 'peak' ? p.y + m.h * 0.75 : p.y;
        const mk = place(m, p.x, cy);
        const r = [mk.x0 - 1, mk.y0 - 1, mk.x0 + mk.w + 1, mk.y0 + mk.h + 1];
        if (L.sdMap(r[0], r[1]) > -1 || L.sdMap(r[2], r[3]) > -1 || L.sdMap(r[0], r[3]) > -1 || L.sdMap(r[2], r[1]) > -1) continue;
        if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
        if (hitsTrack(r)) continue;
        placed.push(r); seen.add(p.name);
        const t = { mask: mk, mode: S.labels.mode === 'plaque' ? 'raise' : S.labels.mode, height: S.labels.h, slot: R.labels, region: 'map' };
        if (S.labels.mode === 'plaque') t.plaque = { rect: [mk.x0 - 1.2, mk.y0 - 1.2, mk.x0 + mk.w + 1.2, mk.y0 + mk.h + 1.2], slot: R.plaque, height: 1 };
        texts.push(t);
      }
    }
    return texts;
  }

  async function build(final, status = setStatus) {
    const d = await ensureData(status, final);
    const res = final ? S.cfg.res : Math.max(S.cfg.res, S.cfg.sizeMm / 240);
    const c = mapCfg(res);
    let L = layoutMap(c);
    const A = areaMerc(c.area);
    // Relief-Vorschlag erst, wenn Höhen vorliegen
    if (pendingSuggest) {
      let eMin = Infinity, eMax = -Infinity;
      for (let j = 0; j <= 40; j++) for (let i = 0; i <= 40; i++) {
        const e = d.dem.elev(A.cx + (i / 40 - 0.5) * A.w, A.cy + (j / 40 - 0.5) * A.h);
        if (e < eMin) eMin = e; if (e > eMax) eMax = e;
      }
      suggestRelief({ eMin, eMax, mmPerM: L.W / A.w / Math.cos(c.area.lat * Math.PI / 180) });
      // Titelleiste an die niedrigere Kante (oben/unten) legen – sonst wird sie bei „folgt dem Rand“ zum hohen Block
      if (S.cfg.frame.band !== 'none') {
        let south = -Infinity, north = -Infinity;
        for (let i = 0; i <= 60; i++) {
          const mx = A.cx + (i / 60 - 0.5) * A.w;
          south = Math.max(south, d.dem.elev(mx, A.cy - A.h / 2 * 0.98));
          north = Math.max(north, d.dem.elev(mx, A.cy + A.h / 2 * 0.98));
        }
        S.cfg.frame.band = north < south - (eMax - eMin) * 0.1 ? 'top' : 'bottom';
        c.frame.band = S.cfg.frame.band;
        L = layoutMap(c);
        syncUI();
      }
      pendingSuggest = false;
      Object.assign(c.terrain, S.cfg.terrain);
    }
    status('Berechne Modell …');
    await new Promise((r) => setTimeout(r, 10));
    const tracks = S.tracks.filter((t) => t.visible && !t.noGps).map((t) => ({ lines: trackLines(t), slot: t.slot, widthMm: t.widthMm, mode: t.mode, height: t.height, smoothMm: t.smoothMm, markers: t.markers, markerSlot: S.roles.marker }));
    const feats = d.osm.features;
    const texts = buildTexts(c, L, d);
    // Stecksystem
    let plan = null;
    const pockets = [];
    if (S.mods.on && c.shape === 'rect') {
      plan = MOD.planModules(S.mods, L.bbox);
      pockets.push(...plan.mods[0].pockets);
    }
    const r = buildMap(c, { elev: d.dem.elev, features: feats, tracks, texts, pockets }, (p) => status('Berechne ' + p + ' …'));
    const parts = [{ pos: r.pos, col: r.col, name: 'Karte' }];
    const decor = [];
    let modInfo = '';
    if (plan) {
      const T = S.mods.thickness;
      const R = S.roles;
      const vals = statVals();
      for (const m of plan.mods.slice(1)) {
        const w = m.rect[2] - m.rect[0], h = m.rect[3] - m.rect[1], cx = (m.rect[0] + m.rect[2]) / 2, cy = (m.rect[1] + m.rect[3]) / 2;
        const loc = m.pockets.map((p) => ({ ...p, rect: [p.rect[0] - cx, p.rect[1] - cy, p.rect[2] - cx, p.rect[3] - cy] }));
        let res2;
        if (m.type === 'photo') {
          const P = { ...S.mods.photo, ...MOD.photoDims(S.mods.photo) };
          if (P.h + 12 > h || P.w + 12 > w) modInfo += `⚠ Foto ${P.w}×${P.h} passt nicht in ${Math.round(w)}×${Math.round(h)} mm – Kartengröße erhöhen oder Foto drehen. `;
          res2 = MOD.photoFrame(P, w, h, T, loc, { frame: R.modPlate, back: R.modPlate });
          decor.push({ type: 'photo', rect: res2.photo.map((v, k) => v + (k % 2 ? cy : cx)), z: res2.back, mod: m });
        } else if (m.type === 'medal') {
          const Md = S.mods.medal;
          const Lt = MOD.medalLayout(Md, w, h);
          const l1 = GPX.fillTemplate(Md.line1 || '', vals), l2 = GPX.fillTemplate(Md.line2 || '', vals);
          const masks = [];
          const put = (lines, sizes, ar) => {
            const ls = lines.filter((x) => x);
            if (!ls.length || ar.x1 - ar.x0 < 8 || ar.y1 - ar.y0 < 4) return;
            const tm = fitMask(ls, sizes.slice(0, ls.length), S.text.font, ar.x1 - ar.x0, ar.y1 - ar.y0, 5);
            if (tm) masks.push(place(tm, (ar.x0 + ar.x1) / 2, (ar.y0 + ar.y1) / 2));
          };
          if (Lt.wide) { put([l1], [Md.textSize * 1.25], Lt.areas[0]); put(l2.split('\n'), [Md.textSize, Md.textSize], Lt.areas[1]); }
          else put([l1, ...l2.split('\n')], [Md.textSize * 1.15, Md.textSize, Md.textSize], Lt.areas[0]);
          res2 = MOD.medalSingle(Md, w, h, T, loc, masks, { plate: R.modPlate, text: R.modText });
          decor.push({ type: 'medal', cx: res2.layout.cx + cx, cy: res2.layout.cy + cy, r: Md.diameter / 2, z: T - 0.8, hook: res2.layout.hook.map((v, k) => v + (k % 2 ? cy : cx)), top: T + Md.pegLen, mod: m });
          modInfo += res2.info + ' · ';
        } else if (m.type === 'medalbar') {
          const tm = S.mods.medalbar.text ? fitMask([GPX.fillTemplate(S.mods.medalbar.text, vals)], [S.mods.medalbar.textSize || 8], S.text.font, w * 0.8, h * 0.32, 5) : null;
          const masks = tm ? [place(tm, 0, h / 2 - 4 - tm.h / 2)] : [];
          res2 = MOD.medalHolder({ ...S.mods.medalbar, textH: 1 }, w, h, T, loc, masks, { plate: R.modPlate, text: R.modText });
        } else {
          const lines = GPX.fillTemplate(S.mods.text.lines, vals).split('\n');
          const tm = fitMask(lines, lines.map((_, i) => (i ? 0.7 : 1) * S.mods.text.textSize), S.text.font, w - 10, h - 10, 5);
          res2 = MOD.textPlate({ ...S.mods.text, textH: 1 }, w, h, T, [...loc], tm ? [place(tm, 0, 0)] : [], { plate: R.modPlate, text: R.modText });
        }
        const g = S.mods.gap;
        const ox = cx + Math.sign(Math.round(cx)) * g, oy = cy + Math.sign(Math.round(cy)) * g;
        const p = res2.mesh.pos;
        for (let k = 0; k < p.length; k += 3) { p[k] += ox; p[k + 1] += oy; }
        for (const d of decor) if (d.mod === m) { const ddx = ox - cx, ddy = oy - cy; if (d.rect) d.rect = [d.rect[0] + ddx, d.rect[1] + ddy, d.rect[2] + ddx, d.rect[3] + ddy]; if (d.hook) { d.cx += ddx; d.cy += ddy; d.hook = [d.hook[0] + ddx, d.hook[1] + ddy, d.hook[2] + ddx, d.hook[3] + ddy]; } delete d.mod; }
        parts.push({ pos: p, col: res2.mesh.col, name: MOD.MODULE_TYPES[m.type] });
      }
      // Verbinder unter dem Ganzen
      const K = S.mods.key;
      const ymin = Math.min(...plan.mods.map((m) => m.rect[1])) - 25;
      const len = K.neckL + 2 * K.headL;
      for (let k = 0; k < plan.keys + 1; k++) {
        const km = MOD.keyPart({ ...K }, R.modPlate);
        const p = km.pos;
        const ox = L.bbox[0] + 10 + k * (len + 6), oy = ymin;
        for (let q = 0; q < p.length; q += 3) { p[q] += ox; p[q + 1] += oy; }
        parts.push({ pos: p, col: km.col, name: 'Verbinder' });
      }
      modInfo += `${plan.mods.length} Module · ${plan.keys} Verbinder (+1 Reserve) · Taschentiefe ${de(plan.depth)} mm`;
    }
    $('mdInfo').textContent = S.mods.on ? (c.shape !== 'rect' ? 'Das Stecksystem gibt es für rechteckige Karten.' : modInfo) : '';
    let n = 0;
    for (const p of parts) n += p.pos.length;
    const pos = new Float32Array(n), col = new Uint8Array(n / 9);
    let o = 0;
    for (const p of parts) { pos.set(p.pos, o); col.set(p.col, o / 9); o += p.pos.length; }
    const mainTris = parts.filter((q) => q.name !== 'Verbinder').reduce((a2, q) => a2 + q.col.length, 0);
    built = { pos, col, info: r.info, layout: L, parts: parts.length, final, decor, mainTris };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = 0;
    for (let k = 0; k < pos.length; k += 3) { const x = pos[k], y = pos[k + 1], z = pos[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > z1) z1 = z; }
    const tris = col.length;
    $('mpTerrainInfo').textContent = `Höhen ${Math.round(r.info.eMin)}–${Math.round(r.info.eMax)} m · Relief ${de(r.info.zMax - r.info.base)} mm über Grund · Maßstab ca. 1:${r.info.scale.toLocaleString('de-DE')}`;
    status(`${(x1 - x0).toFixed(0)} × ${(y1 - y0).toFixed(0)} × ${z1.toFixed(1)} mm${parts.length > 1 ? ` (${parts.length} Teile)` : ''} · ${tris.toLocaleString('de-DE')} Dreiecke${final ? '' : ' (Vorschau, gröber)'} · 1:${r.info.scale.toLocaleString('de-DE')}`);
    return built;
  }

  // ---------------------------------------------------------------- 3D-Vorschau
  let r3 = null;
  function ensure3D() {
    if (r3) return r3;
    const canvas = $('mpCanvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15181e);
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50505a, 0.9));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-1, 1, 1.4);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(0.3, -1, 0.4);
    scene.add(fill);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    scene.add(mesh);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    };
    new ResizeObserver(resize).observe(canvas);
    r3 = { renderer, scene, camera, controls, mesh, render, resize, fitted: false };
    return r3;
  }
  function show3D(b, refit) {
    const R = ensure3D();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
    const cols = new Float32Array(b.pos.length);
    const lin = S.pal.map((p) => { const c = new THREE.Color(p.color); return [c.r, c.g, c.b]; });
    for (let t = 0; t < b.col.length; t++) { const c = lin[b.col[t]] || [0.5, 0.5, 0.5]; for (let k = 0; k < 3; k++) { cols[9 * t + 3 * k] = c[0]; cols[9 * t + 3 * k + 1] = c[1]; cols[9 * t + 3 * k + 2] = c[2]; } }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    R.mesh.geometry.dispose();
    R.mesh.geometry = g;
    const size0 = g.boundingBox.getSize(new THREE.Vector3()).length();
    if (R.fitSize && Math.abs(size0 - R.fitSize) / R.fitSize > 0.12) refit = true; // z. B. Module dazu
    if (refit || !R.fitted) {
      const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()).length();
      R.fitSize = size;
      R.controls.target.copy(c);
      R.camera.position.set(c.x - size * 0.05, c.y - size * 0.95, c.z + size * 0.85);
      R.camera.near = size / 200; R.camera.far = size * 20; R.camera.updateProjectionMatrix();
      R.controls.update();
      R.fitted = true;
    }
    R.resize();
    R.render();
  }
  let timer = 0, building = false, again = false;
  function schedule(ms = 350) {
    if (!open) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (view !== '3d') return;
      if (building) { again = true; return; }
      building = true;
      $('mpBusy').hidden = false;
      try {
        const refit = !r3 || !r3.fitted;
        const b = await build(false, (m) => { $('mpBusy').textContent = m; setStatus(m); });
        show3D(b, refit);
      } catch (e) { console.error(e); setStatus('⚠ ' + (e.message || e)); }
      finally { building = false; $('mpBusy').hidden = true; if (again) { again = false; schedule(50); } }
    }, ms);
  }
  const setStatus = (m) => { $('mpStatus').textContent = m; };

  function setView(v) {
    view = v;
    document.querySelectorAll('#mpViewSeg button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    $('mp3d').hidden = v !== '3d';
    $('mpFinder').hidden = v !== '2d';
    document.querySelector('.mpsearch').hidden = v !== '2d';
    $('mpHint').innerHTML = v === '2d' ? 'Karte verschieben und zoomen – <b>der Rahmen ist der Ausschnitt</b>. Weiter herauszoomen = größeres Gebiet.' : 'Rechte/linke Maustaste dreht, Mausrad zoomt. Änderungen rechts werden sofort berechnet (Vorschau etwas gröber als das Ergebnis).';
    if (v === '3d') { if (r3) r3.fitted = false; schedule(0); } else if (lmap) { lmap.invalidateSize(); layoutFinder(); setAreaView(); }
  }

  // ---------------------------------------------------------------- UI aufbauen
  const fontOpts = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
  $('mpFont').innerHTML = fontOpts;
  const modeOpts = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('mpLabelMode').innerHTML = modeOpts(TEXT_MODES);
  for (const id of ['mdLeft', 'mdRight', 'mdTop', 'mdBottom']) $(id).innerHTML = modeOpts(MOD.MODULE_TYPES);
  $('mpLabelKinds').innerHTML = Object.entries(LABEL_KINDS).map(([k, v]) => `<label><input type="checkbox" data-kind="${k}"> ${v}</label>`).join('');
  const CHIPS = { titel: 'Titel', name: 'Name', datum: 'Datum', distanz: 'Distanz', zeit: 'Zeit', bewegungszeit: 'Bewegungszeit', pace: 'Pace/Tempo', hm: 'Höhenmeter', maxhoehe: 'max. Höhe', sport: 'Sportart', gesamtzeit: 'Gesamtzeit' };
  $('mpChips').innerHTML = 'Einfügen: ' + Object.entries(CHIPS).map(([k, v]) => `<button data-ph="${k}" title="{${k}}">${v}</button>`).join('');
  let lastTextInput = $('mpSub');
  for (const id of ['mpTitle', 'mpSub', 'mpSub2']) $(id).addEventListener('focus', () => { lastTextInput = $(id); });
  $('mpChips').addEventListener('click', (e) => {
    const k = e.target.dataset && e.target.dataset.ph;
    if (!k) return;
    const el = lastTextInput, p = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, p) + (p && el.value[p - 1] !== ' ' ? ' ' : '') + `{${k}}` + el.value.slice(p);
    el.dispatchEvent(new Event('input'));
  });

  function renderTracks() {
    const el = $('mpTracks');
    if (!S.tracks.length) { el.innerHTML = '<p class="note">Noch keine Route. Ohne Route entsteht eine reine Geländekarte – Ausschnitt links wählen oder oben suchen.</p>'; return; }
    el.innerHTML = '';
    S.tracks.forEach((t) => {
      const st = t.stats;
      const div = document.createElement('div');
      div.className = 'trk';
      div.innerHTML = `<div class="hd"><span class="sw" style="background:${slotColor(t.slot)}"></span><input type="text" data-k="name"><select data-k="sport">${Object.entries(GPX.SPORTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
        <label class="check" style="margin:0" title="anzeigen"><input type="checkbox" data-k="visible"> 👁</label><button class="del" title="Route entfernen">✕</button></div>
        <div class="st">${[GPX.fmtDate(st.start), GPX.fmtDist(st.dist), GPX.fmtDuration(st.elapsed), GPX.fmtPace(st, t.sport), st.up > 0 ? Math.round(st.up) + ' hm' : ''].filter(Boolean).join(' · ')}</div>
        ${t.noGps ? '<p class="note">Ohne GPS-Punkte (z.&nbsp;B. Hallenbad) – zählt für Statistik und Texte, wird nicht gezeichnet.</p>' : ''}
        <div class="grid2"${t.noGps ? ' hidden' : ''}>
          <label>Filament <select data-k="slot" data-num>${slotOptions(t.slot)}</select></label>
          <label>Darstellung <select data-k="mode">${modeOpts(TRACK_MODES)}</select></label>
          <label>Breite (mm) <input type="number" data-k="widthMm" data-num min="0.4" step="0.1"></label>
          <label>Höhe (mm) <input type="number" data-k="height" data-num min="0" step="0.1"></label>
          <label title="Glättet GPS-Zacken">Glättung (mm) <input type="number" data-k="smoothMm" data-num min="0" step="0.5"></label>
          <label class="check" style="flex-direction:row;align-items:center"><input type="checkbox" data-k="markers"> Start / Ziel markieren</label>
        </div>`;
      div.querySelectorAll('[data-k]').forEach((inp) => {
        const k = inp.dataset.k;
        if (inp.type === 'checkbox') inp.checked = !!t[k]; else inp.value = t[k];
        inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          t[k] = inp.type === 'checkbox' ? inp.checked : inp.dataset.num !== undefined ? +inp.value : inp.value;
          if (k === 'slot') div.querySelector('.sw').style.background = slotColor(t.slot);
          if (k === 'visible' || k === 'slot') redrawTracks();
          if (k === 'sport') renderTracks();
          changed();
        });
      });
      div.querySelector('.del').addEventListener('click', () => { S.tracks = S.tracks.filter((x) => x !== t); renderTracks(); redrawTracks(); changed(); });
      el.appendChild(div);
    });
  }

  function renderColors() {
    const R = S.roles;
    const rows = Object.entries(ROLES).filter(([k]) => k !== 'hyps').map(([k, v]) => `<tr><td>${v}</td><td><span class="sw" style="background:${slotColor(R[k])};display:inline-block;width:16px;height:14px;border-radius:3px;vertical-align:middle"></span> <select data-role="${k}">${slotOptions(R[k])}</select></td></tr>`);
    (R.hyps || []).forEach((s, i) => rows.push(`<tr><td>Höhenstufe ${i + 1}</td><td><select data-hyps="${i}">${slotOptions(s)}</select></td></tr>`));
    $('mpRoles').innerHTML = rows.join('');
    $('mpRoles').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
      if (sel.dataset.role) R[sel.dataset.role] = +sel.value; else R.hyps[+sel.dataset.hyps] = +sel.value;
      renderColors(); renderClasses(); changed();
    }));
    const pe = $('mpPalette');
    pe.innerHTML = '';
    S.pal.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'slot';
      row.innerHTML = `<span class="num">${i + 1}</span><input type="color" value="${p.color}"><input type="text">`;
      const [ci, ni] = row.querySelectorAll('input');
      ni.value = p.name;
      ci.addEventListener('input', () => { p.color = ci.value; redrawTracks(); changed(); });
      ci.addEventListener('change', () => { renderTracks(); renderClasses(); renderColors(); });
      ni.addEventListener('change', () => { p.name = ni.value; renderTracks(); renderClasses(); renderColors(); });
      pe.appendChild(row);
    });
  }
  function renderClasses() {
    const R = S.roles;
    $('mpClasses').innerHTML = '<tr><th>Untergrund</th><th>Filament</th></tr>' + ['forest', 'meadow', 'farmland', 'urban', 'water', 'rock', 'glacier', 'base'].map((k) =>
      `<tr><td><span class="sw" style="background:${slotColor(R[k])};display:inline-block;width:16px;height:14px;border-radius:3px;vertical-align:middle"></span> ${CLASSES[k].name}</td><td><select data-role="${k}">${slotOptions(R[k])}</select></td></tr>`).join('');
    $('mpClasses').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => { R[sel.dataset.role] = +sel.value; renderClasses(); renderColors(); changed(); }));
  }

  // Werte -> Formular
  function syncUI() {
    const c = S.cfg;
    $('mpWidthKm').value = (c.area.widthM / 1000).toFixed(2);
    $('mpMargin').value = S.margin; $('mpMarginO').textContent = S.margin + ' %';
    document.querySelectorAll('#mpShape button').forEach((b) => b.classList.toggle('active', b.dataset.s === S.shape));
    $('mpAspectRow').querySelector('label').hidden = S.shape === 'circle' || S.shape === 'hex';
    $('mpRadiusL').hidden = S.shape !== 'round';
    const asp = $('mpAspect');
    if (![...asp.options].some((o) => Math.abs(+o.value - c.area.aspect) < 1e-3)) asp.add(new Option('frei ' + de(1 / c.area.aspect, 2) + ' : 1', c.area.aspect));
    asp.value = [...asp.options].find((o) => Math.abs(+o.value - c.area.aspect) < 1e-3).value;
    $('mpSize').value = c.sizeMm;
    $('mpRes').value = String(c.res);
    if ($('mpRes').value !== String(c.res)) { $('mpRes').add(new Option(de(c.res, 2) + ' mm', c.res)); $('mpRes').value = String(c.res); }
    $('mpExag').value = c.terrain.exag; $('mpExagO').textContent = de(c.terrain.exag) + ' ×';
    $('mpAutoRelief').checked = c.terrain.autoRelief > 0;
    if (c.terrain.autoRelief > 0) $('mpRelief').value = c.terrain.autoRelief;
    $('mpExag').disabled = c.terrain.autoRelief > 0;
    $('mpBase').value = c.terrain.base; $('mpSmooth').value = c.terrain.smooth; $('mpSea').checked = c.terrain.sea;
    document.querySelectorAll('#mpSurfMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === c.surface.mode));
    $('mpSurfOsm').hidden = c.surface.mode !== 'osm'; $('mpSurfHyps').hidden = c.surface.mode !== 'hyps';
    $('mpWaterDepth').value = c.surface.waterDepth; $('mpRivers').checked = c.surface.rivers; $('mpHypsN').value = c.surface.hypsBands;
    $('mpBuild').checked = c.buildings.on; $('mpBuildF').value = c.buildings.factor; $('mpBuildMin').value = c.buildings.minMm;
    $('mpRoads').checked = c.roads.on; $('mpRoadLevel').value = c.roads.level; $('mpRoadW').value = c.roads.widthMm; $('mpRoadRaise').value = c.roads.raise;
    $('mpFrameW').value = c.frame.width; $('mpFrameH').value = c.frame.height; $('mpBand').value = c.frame.band; $('mpBandMm').value = c.frame.bandMm;
    $('mpFrameMode').value = c.frame.mode || 'fixed'; $('mpFrameStyle').value = c.frame.style || 'flat'; $('mpFrameProf').value = c.frame.profileMm ?? 1.2;
    $('mpTrans').value = c.frame.trans || 'hard'; $('mpTransMm').value = c.frame.transMm ?? 3; $('mpTransL').hidden = (c.frame.trans || 'hard') === 'hard';
    $('mpFrameNote').textContent = { follow: 'Der Rahmen steigt und fällt mit dem Gelände am Rand und liegt überall knapp darüber – schöne Übergänge ohne hohe Wände. Die Titelleiste bleibt eben.', edge: 'Der Rahmen liegt immer über dem höchsten Geländepunkt am Kartenrand – die Karte sitzt wie in einer Schale, die Bergflanken verschwinden hinter dem Rahmen.', peak: 'Der Rahmen überragt die ganze Karte – schützt die Gipfel, braucht mehr Material.', fixed: 'Wie bisher: niedriger Rahmen als Sockel, das Gelände steht mit sichtbaren Seitenwänden darauf.' }[c.frame.mode || 'fixed'];
    renderFramePick();
    const T = S.text;
    $('mpTitle').value = T.title; $('mpSub').value = T.sub; $('mpSub2').value = T.sub2; $('mpTitlePos').value = T.pos; $('mpFont').value = T.font;
    $('mpTitleSize').value = T.size; $('mpTitleH').value = T.h;
    $('mpTitleMode').innerHTML = modeOpts(T.pos === 'band' ? BAND_MODES : TEXT_MODES);
    $('mpTitleMode').value = T.pos === 'band' && !BAND_MODES[T.mode] ? 'raise' : T.mode;
    $('mpLabels').checked = S.labels.on; $('mpLabelSize').value = S.labels.size; $('mpLabelMode').value = S.labels.mode; $('mpLabelMax').value = S.labels.max;
    $('mpLabelKinds').querySelectorAll('input').forEach((i) => { i.checked = S.labels.kinds.includes(i.dataset.kind); });
    renderOverrides();
    const M = S.mods;
    $('mdOn').checked = M.on; $('mdBox').hidden = !M.on;
    $('mdLeft').value = M.left; $('mdRight').value = M.right; $('mdTop').value = M.top; $('mdBottom').value = M.bottom;
    $('mdPhotoFmt').value = M.photo.format; $('mdPhotoOr').value = M.photo.orient; $('mdPhotoCustom').hidden = M.photo.format !== 'custom';
    $('mdPhotoW').value = M.photo.w; $('mdPhotoH').value = M.photo.h; $('mdPhotoBorder').value = M.photo.border; $('mdPhotoOverlap').value = M.photo.overlap;
    $('mdMedalH').value = M.medalbar.height; $('mdMedalN').value = M.medalbar.pegs; $('mdMedalL').value = M.medalbar.pegLen; $('mdMedalText').value = M.medalbar.text;
    $('mdMedD').value = M.medal.diameter; $('mdMedSize').value = M.medal.textSize; $('mdMed1').value = M.medal.line1; $('mdMed2').value = M.medal.line2; $('mdMedBorder').checked = M.medal.border;
    $('mdTextH').value = M.text.height; $('mdTextSize').value = M.text.textSize; $('mdText').value = M.text.lines;
    $('mdThick').value = M.thickness; $('mdClear').value = M.key.clear; $('mdSpacing').value = M.key.spacing; $('mdHang').checked = M.hang.on;
    $('mpMaxSlots').value = String(S.maxSlots);
    renderTracks(); renderColors(); renderClasses();
    layoutFinder();
    updateInfo();
  }
  function renderOverrides() {
    const auto = (() => { const o = S.text.overrides; S.text.overrides = {}; const v = statVals(); S.text.overrides = o; return v; })();
    const keys = ['name', 'datum', 'distanz', 'zeit', 'pace', 'hm', 'gesamtzeit'];
    $('mpOverrides').innerHTML = keys.map((k) => `<label>${CHIPS[k]} <input type="text" data-ov="${k}" placeholder="${app.escapeHtml(auto[k] || '–')}" value="${app.escapeHtml(S.text.overrides[k] || '')}"></label>`).join('');
    $('mpOverrides').querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { S.text.overrides[i.dataset.ov] = i.value; changed(); }));
  }
  function updateInfo() {
    const c = S.cfg;
    const L = layoutMap(mapCfg(c.res));
    const nx = (L.bbox[2] - L.bbox[0]) / c.res, ny = (L.bbox[3] - L.bbox[1]) / c.res;
    const scale = Math.round((c.area.widthM * 1000) / c.sizeMm);
    $('mpAreaInfo').innerHTML = `Gesamt ${Math.round(L.bbox[2] - L.bbox[0])} × ${Math.round(L.bbox[3] - L.bbox[1])} mm (mit Rahmen) · Maßstab ca. 1:${scale.toLocaleString('de-DE')} · ca. ${Math.round((nx * ny * 2.2) / 1000).toLocaleString('de-DE')} Tsd. Dreiecke` +
      (L.bbox[2] - L.bbox[0] > 250 || L.bbox[3] - L.bbox[1] > 250 ? '<br><span style="color:#fbbf24">Größer als ein 250-mm-Druckbett – mit „Teilen“ zerlegen oder kleiner wählen.</span>' : '');
  }
  function changed() { updateInfo(); schedule(); }

  // Formular -> Werte
  const num = (id) => +$(id).value;
  const bind = (id, fn, ev = 'input') => $(id).addEventListener(ev, () => { fn(); changed(); });
  bind('mpWidthKm', () => { const v = num('mpWidthKm'); if (v > 0.05) { S.cfg.area.widthM = v * 1000; setAreaView(); } }, 'change');
  bind('mpMargin', () => { S.margin = num('mpMargin'); $('mpMarginO').textContent = S.margin + ' %'; });
  $('mpMargin').addEventListener('change', () => { if (fitToTracks(false)) { setAreaView(); syncUI(); changed(); } });
  $('mpFitTracks').addEventListener('click', () => { if (fitToTracks(false)) { setAreaView(); syncUI(); changed(); } else app.toast('Erst eine Route laden.'); });
  document.querySelectorAll('#mpShape button').forEach((b) => b.addEventListener('click', () => {
    S.shape = b.dataset.s;
    if (S.shape === 'round' && !(+$('mpRadius').value > 0)) $('mpRadius').value = 10;
    if (S.tracks.length) fitToTracks(false);
    syncUI(); setAreaView(); changed();
  }));
  bind('mpAspect', () => { S.cfg.area.aspect = num('mpAspect'); layoutFinder(); setAreaView(); }, 'change');
  bind('mpRadius', () => {});
  bind('mpSize', () => { S.cfg.sizeMm = Math.max(20, num('mpSize')); }, 'change');
  bind('mpRes', () => { S.cfg.res = num('mpRes'); }, 'change');
  bind('mpExag', () => { S.cfg.terrain.exag = num('mpExag'); $('mpExagO').textContent = de(S.cfg.terrain.exag) + ' ×'; });
  bind('mpAutoRelief', () => { S.cfg.terrain.autoRelief = $('mpAutoRelief').checked ? num('mpRelief') : 0; $('mpExag').disabled = S.cfg.terrain.autoRelief > 0; }, 'change');
  bind('mpRelief', () => { if ($('mpAutoRelief').checked) S.cfg.terrain.autoRelief = num('mpRelief'); });
  bind('mpBase', () => { S.cfg.terrain.base = num('mpBase'); });
  bind('mpSmooth', () => { S.cfg.terrain.smooth = num('mpSmooth'); });
  bind('mpSea', () => { S.cfg.terrain.sea = $('mpSea').checked; }, 'change');
  document.querySelectorAll('#mpSurfMode button').forEach((b) => b.addEventListener('click', () => { S.cfg.surface.mode = b.dataset.m; syncUI(); changed(); }));
  bind('mpWaterDepth', () => { S.cfg.surface.waterDepth = num('mpWaterDepth'); });
  bind('mpRivers', () => { S.cfg.surface.rivers = $('mpRivers').checked; }, 'change');
  bind('mpHypsN', () => {
    S.cfg.surface.hypsBands = num('mpHypsN');
    const base = S.maxSlots > 8 ? HYPS[1] : HYPS[0];
    const idx = (k) => Math.max(0, S.pal.findIndex((p) => p.key === k));
    S.roles.hyps = Array.from({ length: S.cfg.surface.hypsBands }, (_, i) => idx(base[Math.round((i / Math.max(1, S.cfg.surface.hypsBands - 1)) * (base.length - 1))]));
    renderColors();
  }, 'change');
  bind('mpBuild', () => { S.cfg.buildings.on = $('mpBuild').checked; }, 'change');
  bind('mpBuildF', () => { S.cfg.buildings.factor = num('mpBuildF'); });
  bind('mpBuildMin', () => { S.cfg.buildings.minMm = num('mpBuildMin'); });
  bind('mpRoads', () => { S.cfg.roads.on = $('mpRoads').checked; }, 'change');
  bind('mpRoadLevel', () => { S.cfg.roads.level = $('mpRoadLevel').value; }, 'change');
  bind('mpRoadW', () => { S.cfg.roads.widthMm = num('mpRoadW'); });
  bind('mpRoadRaise', () => { S.cfg.roads.raise = num('mpRoadRaise'); });
  bind('mpFrameW', () => { S.cfg.frame.width = num('mpFrameW'); });
  bind('mpFrameH', () => { S.cfg.frame.height = num('mpFrameH'); });
  bind('mpFrameMode', () => { S.cfg.frame.mode = $('mpFrameMode').value; syncUI(); }, 'change');
  bind('mpFrameStyle', () => { S.cfg.frame.style = $('mpFrameStyle').value; renderFramePick(); }, 'change');
  bind('mpFrameProf', () => { S.cfg.frame.profileMm = num('mpFrameProf'); renderFramePick(); });
  bind('mpTrans', () => { S.cfg.frame.trans = $('mpTrans').value; $('mpTransL').hidden = S.cfg.frame.trans === 'hard'; }, 'change');
  bind('mpTransMm', () => { S.cfg.frame.transMm = num('mpTransMm'); });
  // kleine Profil-Skizzen zum Anklicken
  function renderFramePick() {
    const box = $('mpFramePick');
    const styles = { flat: 'flach', bevelIn: 'Fase innen', bevelOut: 'Fase außen', round: 'abgerundet', step: 'Stufe innen', stepOut: 'Stufe außen' };
    if (!box.children.length) {
      for (const [k, v] of Object.entries(styles)) {
        const b = document.createElement('button');
        b.dataset.s = k;
        b.innerHTML = `<canvas width="84" height="36"></canvas>${v}`;
        b.addEventListener('click', () => { S.cfg.frame.style = k; syncUI(); changed(); });
        box.appendChild(b);
        const g = b.querySelector('canvas').getContext('2d');
        const drop = (sv) => k === 'round' ? 1 - Math.sqrt(Math.max(0, 1 - (2 * sv - 1) ** 2)) : k === 'bevelIn' ? (sv < 0.55 ? (0.55 - sv) / 0.55 : 0) : k === 'bevelOut' ? (sv > 0.45 ? (sv - 0.45) / 0.55 : 0) : k === 'step' ? (sv < 0.4 ? 1 : 0) : k === 'stepOut' ? (sv > 0.6 ? 1 : 0) : 0;
        g.fillStyle = '#5eead4'; g.beginPath(); g.moveTo(60, 34);
        for (let i = 0; i <= 40; i++) { const sv = i / 40; g.lineTo(60 - sv * 50, 8 + drop(sv) * 10); }
        g.lineTo(10, 34); g.closePath(); g.fill();
        g.fillStyle = '#4b5563'; g.fillRect(60, 22, 22, 12); // Gelände innen
      }
    }
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.s === (S.cfg.frame.style || 'flat')));
  }
  bind('mpBand', () => { S.cfg.frame.band = $('mpBand').value; if (S.cfg.frame.band === 'none' && S.text.pos === 'band') { S.text.pos = 'map-bl'; S.text.mode = 'plaque'; } syncUI(); }, 'change');
  bind('mpBandMm', () => { S.cfg.frame.bandMm = num('mpBandMm'); });
  bind('mpTitle', () => { S.text.title = $('mpTitle').value; });
  bind('mpSub', () => { S.text.sub = $('mpSub').value; });
  bind('mpSub2', () => { S.text.sub2 = $('mpSub2').value; });
  bind('mpTitlePos', () => {
    S.text.pos = $('mpTitlePos').value;
    if (S.text.pos === 'band' && S.cfg.frame.band === 'none') S.cfg.frame.band = 'bottom';
    if (S.text.pos.startsWith('map') && S.text.mode === 'raise') S.text.mode = 'plaque';
    syncUI();
  }, 'change');
  bind('mpFont', () => { S.text.font = $('mpFont').value; }, 'change');
  bind('mpTitleSize', () => { S.text.size = num('mpTitleSize'); });
  bind('mpTitleMode', () => { S.text.mode = $('mpTitleMode').value; }, 'change');
  bind('mpTitleH', () => { S.text.h = num('mpTitleH'); });
  bind('mpLabels', () => { S.labels.on = $('mpLabels').checked; }, 'change');
  $('mpLabelKinds').addEventListener('change', () => { S.labels.kinds = [...$('mpLabelKinds').querySelectorAll('input:checked')].map((i) => i.dataset.kind); changed(); });
  bind('mpLabelSize', () => { S.labels.size = num('mpLabelSize'); });
  bind('mpLabelMode', () => { S.labels.mode = $('mpLabelMode').value; }, 'change');
  bind('mpLabelMax', () => { S.labels.max = num('mpLabelMax'); });
  const M = () => S.mods;
  bind('mdOn', () => {
    M().on = $('mdOn').checked; $('mdBox').hidden = !M().on;
    if (M().on && (S.shape === 'circle' || S.shape === 'hex')) { S.shape = 'rect'; syncUI(); }
  }, 'change');
  for (const [id, k] of [['mdLeft', 'left'], ['mdRight', 'right'], ['mdTop', 'top'], ['mdBottom', 'bottom']]) bind(id, () => { M()[k] = $(id).value; }, 'change');
  bind('mdPhotoFmt', () => { M().photo.format = $('mdPhotoFmt').value; $('mdPhotoCustom').hidden = M().photo.format !== 'custom'; }, 'change');
  bind('mdPhotoOr', () => { M().photo.orient = $('mdPhotoOr').value; }, 'change');
  bind('mdPhotoW', () => { M().photo.w = num('mdPhotoW'); });
  bind('mdPhotoH', () => { M().photo.h = num('mdPhotoH'); });
  bind('mdPhotoBorder', () => { M().photo.border = num('mdPhotoBorder'); });
  bind('mdPhotoOverlap', () => { M().photo.overlap = num('mdPhotoOverlap'); });
  bind('mdMedalH', () => { M().medalbar.height = num('mdMedalH'); });
  bind('mdMedalN', () => { M().medalbar.pegs = num('mdMedalN'); });
  bind('mdMedalL', () => { M().medalbar.pegLen = num('mdMedalL'); });
  bind('mdMedalText', () => { M().medalbar.text = $('mdMedalText').value; });
  bind('mdMedD', () => { M().medal.diameter = num('mdMedD'); });
  bind('mdMedSize', () => { M().medal.textSize = num('mdMedSize'); });
  bind('mdMed1', () => { M().medal.line1 = $('mdMed1').value; });
  bind('mdMed2', () => { M().medal.line2 = $('mdMed2').value; });
  bind('mdMedBorder', () => { M().medal.border = $('mdMedBorder').checked; }, 'change');
  bind('mdTextH', () => { M().text.height = num('mdTextH'); });
  bind('mdTextSize', () => { M().text.textSize = num('mdTextSize'); });
  bind('mdText', () => { M().text.lines = $('mdText').value; });
  bind('mdThick', () => { M().thickness = num('mdThick'); });
  bind('mdClear', () => { M().key.clear = num('mdClear'); });
  bind('mdSpacing', () => { M().key.spacing = num('mdSpacing'); });
  bind('mdHang', () => { M().hang.on = $('mdHang').checked; }, 'change');
  bind('mpMaxSlots', () => { S.maxSlots = num('mpMaxSlots'); autoColors(S.maxSlots); syncUI(); redrawTracks(); }, 'change');
  $('mpAutoColors').addEventListener('click', () => { autoColors(S.maxSlots); syncUI(); redrawTracks(); changed(); });

  document.querySelectorAll('#mpTabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(t) {
    document.querySelectorAll('#mpTabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
    document.querySelectorAll('.mpopts .tab').forEach((x) => { x.hidden = x.dataset.tab !== t; });
    if (t === 'text') renderOverrides();
  }
  document.querySelectorAll('#mpViewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
  $('mpSuggest').addEventListener('click', () => { suggest(); changed(); app.toast('Vorschlag übernommen.'); });

  // Dateien
  $('mpAddTrack').addEventListener('click', () => $('fileTrack').click());
  $('mpDemo').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const files = [];
      for (const n of ['eibsee-schwimmen.gpx', 'eibsee-lauf.gpx']) {
        const r = await fetch('docs/demo/' + n);
        if (!r.ok) throw new Error('Beispieldatei fehlt: ' + n);
        files.push(new File([await r.blob()], n));
      }
      await addFiles(files);
    } catch (err) { app.toast(err.message); }
  });
  $('fileTrack').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { if (!open) openStudio(); addFiles(f); } });
  const drop = $('mpDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  $('mapDlg').addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  $('mapDlg').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const f = [...e.dataTransfer.files].filter(isTrackFile); if (f.length) addFiles(f); });

  // Suche
  let searchTimer = 0;
  $('mpSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } if (e.key === 'Escape') { e.stopPropagation(); $('mpResults').hidden = true; } });
  $('mpSearch').addEventListener('input', () => { clearTimeout(searchTimer); if ($('mpSearch').value.trim().length >= 3) searchTimer = setTimeout(runSearch, 700); });
  async function runSearch() {
    const q = $('mpSearch').value.trim();
    if (!q) return;
    try {
      const res = await GEO.geocode(q);
      const box = $('mpResults');
      box.innerHTML = res.length ? '' : '<div>Nichts gefunden.</div>';
      for (const r of res) {
        const d = document.createElement('div');
        d.textContent = r.name;
        d.addEventListener('click', () => {
          box.hidden = true;
          let w = S.cfg.area.widthM;
          if (r.bbox) { const [s, n, wv, e] = r.bbox; w = Math.max(1500, Math.min(60000, GPX.haversine({ lat: (s + n) / 2, lon: wv }, { lat: (s + n) / 2, lon: e }) * 1.4)); }
          S.cfg.area = { ...S.cfg.area, lat: r.lat, lon: r.lon, widthM: w };
          setAreaView(); syncUI(); changed();
        });
        box.appendChild(d);
      }
      box.hidden = false;
    } catch (e) { app.toast(e.message); }
  }

  // ---------------------------------------------------------------- Öffnen / Übernehmen
  function openStudio(project, tab) {
    if (project) setProject(project);
    else if (!S.pal.length) autoColors(S.maxSlots);
    $('mapDlg').hidden = false;
    open = true;
    ensureLeaflet();
    setTimeout(() => {
      lmap.invalidateSize();
      syncUI();
      setAreaView();
      redrawTracks();
      setView(view);
    }, 30);
    $('mpName').textContent = S.tracks.length ? '– ' + S.tracks.map((t) => t.name).join(', ').slice(0, 80) : '';
    showTab(tab || 'act');
  }
  function close() { $('mapDlg').hidden = true; open = false; clearTimeout(timer); }
  $('mpCancel').addEventListener('click', close);
  $('mpPrint').addEventListener('click', async () => {
    $('mpPrint').disabled = true;
    try {
      const b = await build(true, (m) => setStatus(m));
      app.printPreview({ pos: b.pos, col: b.col, palette: S.pal, decor: b.decor, mainTris: b.mainTris, name: GPX.fillTemplate(S.text.title || '', statVals()) || 'Karte' });
    } catch (e) { console.error(e); app.toast('Fehler: ' + (e.message || e)); }
    finally { $('mpPrint').disabled = false; }
  });
  $('mapDlg').addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.activeElement !== $('mpSearch') && $('prDlg').hidden) close(); });

  $('mpApply').addEventListener('click', async () => {
    $('mpApply').disabled = true;
    try {
      const b = await build(true, (m) => { setStatus(m); $('mpBusy').textContent = m; });
      const name = (GPX.fillTemplate(S.text.title || '', statVals()) || 'Karte').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      app.setMapModel(b.pos, b.col, S.pal.map((p) => ({ name: p.name, color: p.color })), name, getProject());
      close();
      app.toast(`Karte erzeugt (${b.col.length.toLocaleString('de-DE')} Dreiecke). Weiter bemalen, speichern oder als 3MF exportieren.`, 6000);
    } catch (e) { console.error(e); alert('Fehler: ' + (e.message || e)); }
    finally { $('mpApply').disabled = false; }
  });

  // ---------------------------------------------------------------- Projekt
  function getProject() {
    return {
      v: 1, cfg: structuredClone(S.cfg), shape: S.shape, radius: +$('mpRadius').value || 0, margin: S.margin, maxSlots: S.maxSlots,
      pal: S.pal.map((p) => ({ ...p })), roles: structuredClone(S.roles), text: structuredClone(S.text), labels: structuredClone(S.labels), mods: structuredClone(S.mods),
      tracks: S.tracks.map((t) => ({ ...t, points: t.points.map((p) => [p.lat, p.lon, p.ele, p.t]) })),
    };
  }
  function setProject(p) {
    const d = defaultMapConfig();
    S.cfg = { ...d, ...p.cfg, terrain: { ...d.terrain, ...p.cfg.terrain }, surface: { ...d.surface, ...p.cfg.surface }, buildings: { ...d.buildings, ...p.cfg.buildings }, roads: { ...d.roads, ...p.cfg.roads }, frame: { ...d.frame, ...p.cfg.frame } };
    S.shape = p.shape || 'rect'; $('mpRadius').value = p.radius || 8; S.margin = p.margin ?? 12; S.maxSlots = p.maxSlots || 8;
    S.pal = p.pal; S.roles = p.roles; S.text = { ...S.text, ...p.text }; S.labels = { ...S.labels, ...p.labels };
    const dm = MOD.defaultModuleConfig();
    S.mods = { ...dm, ...p.mods, key: { ...dm.key, ...(p.mods || {}).key }, hang: { ...dm.hang, ...(p.mods || {}).hang }, photo: { ...dm.photo, ...(p.mods || {}).photo }, medal: { ...dm.medal, ...(p.mods || {}).medal }, medalbar: { ...dm.medalbar, ...(p.mods || {}).medalbar }, text: { ...dm.text, ...(p.mods || {}).text } };
    // Projekte aus v1.1.0: Rahmen wie damals, alte „Medaillenhalter“ = Leiste
    if (!p.cfg.frame || !p.cfg.frame.mode) Object.assign(S.cfg.frame, { mode: 'fixed', style: 'flat', trans: 'hard' });
    if (p.mods && p.mods.medal && 'pegs' in p.mods.medal) {
      S.mods.medalbar = { ...dm.medalbar, ...p.mods.medal };
      S.mods.medal = { ...dm.medal };
      for (const k of ['left', 'right', 'top', 'bottom']) if (S.mods[k] === 'medal') S.mods[k] = 'medalbar';
    }
    S.tracks = (p.tracks || []).map((t) => ({ ...t, id: idSeq++, points: t.points.map((q) => ({ lat: q[0], lon: q[1], ele: q[2] ?? NaN, t: q[3] ?? NaN })) }));
    pendingSuggest = false;
  }

  function isTrackFile(f) { return /\.(gpx|tcx|fit)(\.gz)?$/i.test(f.name); }

  return {
    open: openStudio,
    isOpen: () => open,
    addFiles: (files) => { if (!open) openStudio(); return addFiles(files); },
    isTrackFile,
    // für Tests
    _S: S, _build: build, _suggest: suggest, _setView: setView, _ensureData: ensureData, _show3D: show3D, get _built() { return built; },
  };
}
