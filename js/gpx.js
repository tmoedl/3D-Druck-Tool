// Aktivitäten und Routen einlesen: GPX, TCX und FIT (auch .gz, wie im Strava-Export).
// Liefert Tracks mit Punkten {lat, lon, ele, t} und berechnet Statistiken.
// Multisport-FIT-Dateien (z. B. Triathlon) werden automatisch in Teilstrecken getrennt.
// Reines JS ohne DOM-Abhängigkeit außer DOMParser (im Browser) – FIT/Statistik auch in Node testbar.

export const SPORTS = {
  run: { name: 'Lauf', pace: 'km' },
  bike: { name: 'Radfahrt', pace: 'speed' },
  swim: { name: 'Schwimmen', pace: '100m' },
  hike: { name: 'Wanderung', pace: 'speed' },
  walk: { name: 'Spaziergang', pace: 'km' },
  ski: { name: 'Ski', pace: 'speed' },
  other: { name: 'Aktivität', pace: 'speed' },
};

// ---------------------------------------------------------------- Einlesen
export async function readActivityFile(file) {
  let buf = new Uint8Array(await file.arrayBuffer());
  let name = file.name;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    name = name.replace(/\.gz$/i, '');
  }
  return parseActivity(buf, name);
}

export function parseActivity(buf, name = 'Aktivität') {
  const base = name.replace(/\.[^.]+$/, '');
  const isFit = buf.length > 12 && buf[8] === 0x2e && buf[9] === 0x46 && buf[10] === 0x49 && buf[11] === 0x54; // ".FIT"
  let tracks;
  if (isFit) tracks = parseFIT(buf);
  else {
    const text = new TextDecoder().decode(buf);
    if (/<TrainingCenterDatabase/i.test(text)) tracks = parseTCX(text);
    else if (/<gpx/i.test(text)) tracks = parseGPX(text);
    else throw new Error(`${name}: unbekanntes Format (GPX, TCX oder FIT erwartet).`);
  }
  // Ohne GPS (z. B. Hallenbad): behalten, wenn Distanz/Zeit bekannt – zählt für Statistik, wird nicht gezeichnet
  tracks = tracks.filter((t) => t.points.length >= 2 || (t.session && (t.session.dist > 0 || t.session.elapsed > 0)));
  if (!tracks.length) throw new Error(`${name}: keine GPS-Punkte gefunden.`);
  for (const t of tracks) {
    t.noGps = t.points.length < 2;
    if (t.noGps) t.points = [];
    else cleanTrack(t);
    t.stats = trackStats(t);
    if (!t.sport || t.sport === 'other') t.sport = guessSport(t.stats, t.sport);
    // Reine Nummern (Strava-Export) oder Dateinamen durch z. B. „Wanderung 12.05.2026“ ersetzen
    if (!t.name || /^[\d_\-.]+$/.test(t.name) || /\.(gpx|fit|tcx)$/i.test(t.name)) {
      t.name = (/^[\d_\-.]+$/.test(base) ? '' : base) || [SPORTS[t.sport]?.name || 'Aktivität', fmtDate(t.stats.start)].filter(Boolean).join(' ');
    }
  }
  return tracks;
}

const num = (s) => (s == null || s === '' ? NaN : +s);

function sportFromText(s) {
  s = String(s || '').toLowerCase();
  if (/run|lauf|jog|trail/.test(s)) return 'run';
  if (/bik|cycl|rad|ride/.test(s) && !/ski/.test(s)) return 'bike';
  if (/swim|schwimm/.test(s)) return 'swim';
  if (/hik|wander|mountaineer/.test(s)) return 'hike';
  if (/walk|spazier/.test(s)) return 'walk';
  if (/ski|snowboard/.test(s)) return 'ski';
  return '';
}

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const out = [];
  const docName = doc.querySelector('metadata > name')?.textContent?.trim() || '';
  const timeOf = (el) => { const t = el.getElementsByTagName('time')[0]; return t ? Date.parse(t.textContent) : NaN; };
  const eleOf = (el) => { const e = el.getElementsByTagName('ele')[0]; return e ? num(e.textContent) : NaN; };
  const pts = (list) => Array.from(list, (p) => ({ lat: num(p.getAttribute('lat')), lon: num(p.getAttribute('lon')), ele: eleOf(p), t: timeOf(p) }))
    .filter((p) => isFinite(p.lat) && isFinite(p.lon));
  for (const trk of doc.getElementsByTagName('trk')) {
    const nm = trk.getElementsByTagName('name')[0]?.textContent?.trim() || docName;
    const type = trk.getElementsByTagName('type')[0]?.textContent || '';
    const segs = Array.from(trk.getElementsByTagName('trkseg'), (s) => pts(s.getElementsByTagName('trkpt'))).filter((s) => s.length);
    if (!segs.length) continue;
    out.push({ name: nm, sport: sportFromText(type) || sportFromText(nm), points: segs.flat(), breaks: segBreaks(segs) });
  }
  for (const rte of doc.getElementsByTagName('rte')) {
    const nm = rte.getElementsByTagName('name')[0]?.textContent?.trim() || docName;
    const p = pts(rte.getElementsByTagName('rtept'));
    if (p.length) out.push({ name: nm, sport: sportFromText(nm), points: p, breaks: [], route: true });
  }
  return out;
}

function segBreaks(segs) {
  const b = [];
  let n = 0;
  for (let i = 0; i < segs.length - 1; i++) { n += segs[i].length; b.push(n); }
  return b;
}

export function parseTCX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const out = [];
  const val = (el, tag) => { const e = el.getElementsByTagName(tag)[0]; return e ? e.textContent : null; };
  for (const act of doc.getElementsByTagName('Activity')) {
    const sport = sportFromText(act.getAttribute('Sport'));
    const p = [];
    for (const tp of act.getElementsByTagName('Trackpoint')) {
      const pos = tp.getElementsByTagName('Position')[0];
      if (!pos) continue;
      p.push({ lat: num(val(pos, 'LatitudeDegrees')), lon: num(val(pos, 'LongitudeDegrees')), ele: num(val(tp, 'AltitudeMeters')), t: Date.parse(val(tp, 'Time')) });
    }
    out.push({ name: '', sport, points: p.filter((q) => isFinite(q.lat) && isFinite(q.lon)), breaks: [] });
  }
  for (const c of doc.getElementsByTagName('Course')) {
    const p = [];
    for (const tp of c.getElementsByTagName('Trackpoint')) {
      const pos = tp.getElementsByTagName('Position')[0];
      if (pos) p.push({ lat: num(val(pos, 'LatitudeDegrees')), lon: num(val(pos, 'LongitudeDegrees')), ele: num(val(tp, 'AltitudeMeters')), t: NaN });
    }
    out.push({ name: val(c, 'Name') || '', sport: '', points: p, breaks: [], route: true });
  }
  return out;
}

// ---------------------------------------------------------------- FIT (Garmin/Wahoo/Strava-Export)
const FIT_EPOCH = Date.UTC(1989, 11, 31);
const FIT_SPORT = { 1: 'run', 2: 'bike', 5: 'swim', 11: 'walk', 17: 'hike', 13: 'ski', 12: 'ski', 14: 'ski', 15: 'other', 4: 'other' };
const SEMI = 180 / 2 ** 31;

export function parseFIT(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hlen = u8[0];
  const dataLen = dv.getUint32(4, true);
  let p = hlen;
  const end = Math.min(u8.length, hlen + dataLen);
  const defs = {};
  const records = [], sessions = [];
  let lastTs = 0;
  const readVal = (off, size, base, little) => {
    const t = base & 0x1f;
    switch (t) {
      case 0: case 2: case 10: case 13: return size === 1 ? u8[off] : NaN; // enum, uint8, uint8z, byte
      case 1: return size === 1 ? dv.getInt8(off) : NaN;
      case 3: return size === 2 ? dv.getInt16(off, little) : NaN;
      case 4: case 11: return size === 2 ? dv.getUint16(off, little) : NaN;
      case 5: return size === 4 ? dv.getInt32(off, little) : NaN;
      case 6: case 12: return size === 4 ? dv.getUint32(off, little) : NaN;
      default: return NaN;
    }
  };
  const invalid = (v, base) => {
    const t = base & 0x1f;
    return (t === 0 || t === 2) ? v === 0xff : t === 1 ? v === 0x7f : t === 3 ? v === 0x7fff : t === 4 ? v === 0xffff
      : t === 5 ? v === 0x7fffffff : t === 6 ? v === 0xffffffff : (t === 10 || t === 11 || t === 12) ? v === 0 : false;
  };
  while (p < end) {
    const h = u8[p++];
    if (h & 0x80) { // komprimierter Zeitstempel
      const local = (h >> 5) & 3, off = h & 0x1f;
      const def = defs[local];
      if (!def) break;
      let ts = (lastTs & ~0x1f) + off;
      if (off < (lastTs & 0x1f)) ts += 0x20;
      lastTs = ts;
      const msg = readMsg(def, p);
      p += def.size;
      msg[253] = ts;
      handle(def.gnum, msg);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) { // Definition
      const little = u8[p + 1] === 0;
      const gnum = little ? dv.getUint16(p + 2, true) : dv.getUint16(p + 2, false);
      const nf = u8[p + 4];
      p += 5;
      const fields = [];
      let size = 0;
      for (let i = 0; i < nf; i++) { fields.push({ num: u8[p], size: u8[p + 1], base: u8[p + 2], off: size }); size += u8[p + 1]; p += 3; }
      if (h & 0x20) { const nd = u8[p++]; for (let i = 0; i < nd; i++) { size += u8[p + 1]; p += 3; } }
      defs[local] = { gnum, fields, size, little };
    } else {
      const def = defs[local];
      if (!def) break;
      const msg = readMsg(def, p);
      p += def.size;
      if (msg[253] != null) lastTs = msg[253];
      handle(def.gnum, msg);
    }
  }
  function readMsg(def, at) {
    const m = {};
    for (const f of def.fields) {
      const v = readVal(at + f.off, f.size, f.base, def.little);
      if (!isNaN(v) && !invalid(v, f.base)) m[f.num] = v;
    }
    return m;
  }
  function handle(g, m) {
    if (g === 20) {
      if (m[0] == null || m[1] == null) return;
      const alt = m[78] != null ? m[78] / 5 - 500 : m[2] != null ? m[2] / 5 - 500 : NaN;
      records.push({ lat: m[0] * SEMI, lon: m[1] * SEMI, ele: alt, t: m[253] != null ? FIT_EPOCH + m[253] * 1000 : NaN });
    } else if (g === 18) {
      sessions.push({ sport: FIT_SPORT[m[5]] || 'other', start: m[2] != null ? FIT_EPOCH + m[2] * 1000 : NaN, elapsed: (m[7] || 0) / 1000, timer: (m[8] || 0) / 1000, dist: (m[9] || 0) / 100 });
    }
  }
  const pts = records.filter((r) => Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180 && !(r.lat === 0 && r.lon === 0));
  const real = sessions.filter((s) => s.sport !== 'other' || s.dist > 50);
  if (real.length > 1 && real.every((s) => isFinite(s.start))) {
    // Multisport: Punkte den Sessions zuordnen (Wechselzonen = „other“ werden weggelassen)
    real.sort((a, b) => a.start - b.start);
    return real.map((s) => {
      const t1 = s.start + s.elapsed * 1000 + 999;
      return { name: SPORTS[s.sport]?.name || 'Teil', sport: s.sport, points: pts.filter((q) => q.t >= s.start && q.t <= t1), breaks: [], session: s };
    }).filter((t) => t.points.length >= 2 || t.session.dist > 0);
  }
  const s = sessions[0];
  return [{ name: '', sport: s ? s.sport : '', points: pts, breaks: [], session: s }];
}

// ---------------------------------------------------------------- Aufbereitung
const R_EARTH = 6371008.8;
export function haversine(a, b) {
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

// GPS-Ausreißer (Sprünge mit unmöglicher Geschwindigkeit) entfernen, doppelte Punkte zusammenfassen
export function cleanTrack(t) {
  const p = t.points;
  const out = [p[0]];
  const brk = new Set(t.breaks || []), nb = [];
  for (let i = 1; i < p.length; i++) {
    const a = out[out.length - 1], b = p[i];
    const d = haversine(a, b);
    if (brk.has(i)) nb.push(out.length);
    if (d < 0.5) continue;
    const dt = (b.t - a.t) / 1000;
    if (isFinite(dt) && dt > 0 && d / dt > 70 && d > 200) continue; // > 250 km/h: Sprung
    out.push(b);
  }
  t.points = out;
  t.breaks = nb;
  return t;
}

// Höhenmeter mit Hysterese (gegen GPS-Rauschen)
function climb(p) {
  let up = 0, down = 0, ref = NaN;
  for (const q of p) {
    if (!isFinite(q.ele)) continue;
    if (!isFinite(ref)) { ref = q.ele; continue; }
    const d = q.ele - ref;
    if (d > 4) { up += d; ref = q.ele; } else if (d < -4) { down -= d; ref = q.ele; }
  }
  return { up, down };
}

export function trackStats(t) {
  const p = t.points;
  let dist = 0, moving = 0, minE = Infinity, maxE = -Infinity;
  const brk = new Set(t.breaks || []);
  for (let i = 1; i < p.length; i++) {
    if (brk.has(i)) continue;
    const d = haversine(p[i - 1], p[i]);
    dist += d;
    const dt = (p[i].t - p[i - 1].t) / 1000;
    if (isFinite(dt) && dt > 0 && dt < 120 && d / dt > 0.35) moving += dt;
  }
  for (const q of p) if (isFinite(q.ele)) { if (q.ele < minE) minE = q.ele; if (q.ele > maxE) maxE = q.ele; }
  const t0 = p.length ? p[0].t : t.session ? t.session.start : NaN, t1 = p.length ? p[p.length - 1].t : NaN;
  let elapsed = isFinite(t0) && isFinite(t1) ? (t1 - t0) / 1000 : NaN;
  const s = t.session;
  if (s) {
    if (s.dist > 0) dist = s.dist;
    if (s.elapsed > 0) elapsed = s.elapsed;
    if (s.timer > 0) moving = s.timer;
  }
  const { up, down } = climb(p);
  return { dist, elapsed, moving: moving || elapsed, up, down, minE: isFinite(minE) ? minE : NaN, maxE: isFinite(maxE) ? maxE : NaN, start: t0, hasTime: isFinite(elapsed) && elapsed > 0 };
}

export function guessSport(st, fallback = '') {
  if (fallback && fallback !== 'other') return fallback;
  if (!st.hasTime) return 'other';
  const v = st.dist / Math.max(1, st.moving); // m/s
  if (st.up > 600 && v < 2.2) return 'hike';
  if (v < 1.6) return 'walk';
  if (v < 5) return 'run';
  if (v < 15) return 'bike';
  return 'other';
}

// ---------------------------------------------------------------- Formatierung
const de = (x, d = 1) => x.toFixed(d).replace('.', ',');
export function fmtDist(m) {
  if (!isFinite(m)) return '';
  if (m < 1000) return Math.round(m) + ' m';
  return de(m / 1000, m < 10000 ? 2 : 1) + ' km';
}
export function fmtDuration(s) {
  if (!isFinite(s) || s <= 0) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function fmtPace(st, sport) {
  const time = st.moving || st.elapsed;
  if (!(time > 0) || !(st.dist > 0)) return '';
  const kind = SPORTS[sport]?.pace || 'speed';
  if (kind === 'km') { const s = time / (st.dist / 1000); return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km`; }
  if (kind === '100m') { const s = time / (st.dist / 100); return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /100 m`; }
  return de((st.dist / time) * 3.6, 1) + ' km/h';
}
export function fmtDate(ms) {
  if (!isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// Platzhalter für Texte: {name} {datum} {distanz} {zeit} {bewegungszeit} {pace} {hm} {sport} {maxhoehe}
export function statValues(track) {
  const s = track.stats;
  return {
    name: track.name || '',
    datum: fmtDate(s.start),
    distanz: fmtDist(s.dist),
    zeit: fmtDuration(s.elapsed),
    bewegungszeit: fmtDuration(s.moving),
    pace: fmtPace(s, track.sport),
    hm: isFinite(s.up) && s.up > 0 ? Math.round(s.up) + ' hm' : '',
    maxhoehe: isFinite(s.maxE) ? Math.round(s.maxE) + ' m' : '',
    sport: SPORTS[track.sport]?.name || '',
  };
}

// Mehrere Tracks zusammenfassen (z. B. Triathlon: Gesamtdistanz und -zeit)
export function combinedValues(tracks) {
  if (!tracks.length) return {};
  if (tracks.length === 1) return statValues(tracks[0]);
  let dist = 0, el = 0, up = 0, start = Infinity, end = -Infinity;
  for (const t of tracks) {
    dist += t.stats.dist; up += t.stats.up || 0;
    if (isFinite(t.stats.start)) { start = Math.min(start, t.stats.start); end = Math.max(end, t.stats.start + (t.stats.elapsed || 0) * 1000); }
    el += t.stats.elapsed || 0;
  }
  const span = isFinite(start) && end > start ? (end - start) / 1000 : el;
  return { name: tracks[0].name, datum: fmtDate(start), distanz: fmtDist(dist), zeit: fmtDuration(span), bewegungszeit: fmtDuration(el), pace: '', hm: up > 0 ? Math.round(up) + ' hm' : '', maxhoehe: '', sport: tracks.map((t) => SPORTS[t.sport]?.name || '').join(' · ') };
}

export function fillTemplate(tpl, vals) {
  return String(tpl).replace(/\{([\w.]+)\}/g, (_, k) => (vals[k] != null ? vals[k] : ''))
    .split('\n').map((l) => l.replace(/\s*·\s*(·\s*)+/g, ' · ').replace(/^\s*·\s*|\s*·\s*$/g, '').trim()).join('\n').trim();
}

// GPX schreiben (für Demo-Routen und Export bearbeiteter Tracks)
export function writeGPX(tracks) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="3D-Druck-Tool" xmlns="http://www.topografix.com/GPX/1/1">\n';
  for (const t of tracks) {
    s += ` <trk><name>${esc(t.name || '')}</name>${t.sport ? `<type>${t.sport}</type>` : ''}<trkseg>\n`;
    for (const p of t.points) {
      s += `  <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}${isFinite(p.t) ? `<time>${new Date(p.t).toISOString()}</time>` : ''}</trkpt>\n`;
    }
    s += ' </trkseg></trk>\n';
  }
  return s + '</gpx>\n';
}
