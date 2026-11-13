// Dialog „Logo / Schild“: Bild -> Farben -> Effekte pro Farbe oder Bereich -> Platte und Rahmen -> Netz.
import * as IMG from './image.js';
import * as LG from './logo.js';
import { PaintMesh } from './mesh.js';

const $ = (id) => document.getElementById(id);

// Vorlagen: setzen nur Startwerte, alles bleibt danach einstellbar
const PRESETS = {
  classic: { name: 'Klassisches Schild', cfg: { plate: { shape: 'rect', corner: 'round', radius: 4, pad: 6, thickness: 2 }, frame: { style: 'classic', width: 7, height: 2.2 }, line: { width: 0 } }, effect: { profile: 'flat', h: 1 } },
  modern: { name: 'Modern mit Schattenfuge', cfg: { plate: { shape: 'rect', corner: 'sharp', pad: 8, thickness: 2.4 }, frame: { style: 'shadow', width: 5, height: 1.4 }, line: { width: 0 } }, effect: { profile: 'chamfer', h: 1.2, size: 0.6 } },
  contour: { name: 'Kontur um den Inhalt (Magnet, Anhänger)', cfg: { plate: { shape: 'contour', pad: 2.5, smooth: 3, thickness: 1.6, fillHoles: true }, frame: { style: 'round', width: 2.5, height: 0.9 }, line: { width: 0 } }, effect: { profile: 'round', h: 0.8, size: 0.5 } },
  cutout: { name: 'Nur Logo, knapp ausgeschnitten', cfg: { plate: { shape: 'contour', pad: 0.8, smooth: 0.8, thickness: 1.2, fillHoles: false }, frame: { style: 'none' }, line: { width: 0 } }, effect: { profile: 'flat', h: 1 } },
  engraved: { name: 'Gravur (vertieft)', cfg: { plate: { shape: 'rect', corner: 'round', radius: 3, pad: 6, thickness: 3 }, frame: { style: 'bevelIn', width: 4, height: 0.8 }, line: { width: 0 } }, effect: { profile: 'flat', h: -0.8 } },
  medal: { name: 'Medaillon rund, gewölbt', cfg: { plate: { shape: 'circle', pad: 4, thickness: 2.4 }, frame: { style: 'round', width: 5, height: 2 }, line: { width: 0.6, offset: 1.5, height: 0.6 } }, effect: { profile: 'pillow', h: 1.5 } },
  hex: { name: 'Sechseck mit Stufenrahmen', cfg: { plate: { shape: 'hexagon', pad: 4, thickness: 2 }, frame: { style: 'steps', width: 6, height: 2 }, line: { width: 0 } }, effect: { profile: 'round', h: 1, size: 0.6 } },
  ticket: { name: 'Eingekerbte Ecken, Doppelrahmen', cfg: { plate: { shape: 'rect', corner: 'notch', radius: 7, pad: 6, thickness: 2 }, frame: { style: 'double', width: 5, height: 1.2 }, line: { width: 0 } }, effect: { profile: 'flat', h: 1 } },
};

export function initLogo(app) {
  const { state, MAX_SLOTS, DEFAULT_COLORS } = app;
  const cfg = LG.defaultConfig(); // bleibt zwischen Aufrufen erhalten
  let L = null; // {src, name, img, q, colors, rot}
  let zones = [];
  let show = 'relief', drawing = false, drag = null, selZone = -1, field = null, timer = 0, previewCell = 0;
  let view = null; // Abbildung Inhalt -> Bildschirm: {x, y, w, h}

  const dlg = $('logoDlg'), prev = $('lgPrev'), over = $('lgOver'), wrap = $('lgWrap');

  // ------------------------------------------------ Hilfen
  const fmt = (v) => app.fmtMm(v);
  const opt = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
  const getK = (path) => path.split('.').reduce((o, k) => o[k], cfg);
  const setK = (path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], cfg)[last] = v; };
  const defEffect = () => ({ profile: 'flat', h: 1, size: 0.6, slot: -1 });
  const adopt = () => $('lgAdopt').checked;

  // Farben, wie sie gedruckt werden (Filament-Slots)
  function slotColors() {
    const pal = [];
    for (let i = 0; i < MAX_SLOTS; i++) pal.push(app.hexToRgb(state.palette[i] ? state.palette[i].color : DEFAULT_COLORS[i][1]));
    if (L && L.q && adopt()) {
      const done = new Set();
      L.colors.forEach((c, i) => { if (!done.has(c.slot)) { done.add(c.slot); pal[c.slot] = L.q.colors[i]; } });
    }
    return pal;
  }
  function slotName(i) {
    if (L && L.q && adopt()) {
      const k = L.colors.findIndex((c) => c.slot === i);
      if (k >= 0) return `${i + 1}: ${app.nameOfColor(L.q.colors[k])}`;
    }
    const p = state.palette[i];
    return `${i + 1}: ${p ? p.name : DEFAULT_COLORS[i][0] + ' (neu)'}`;
  }
  const slotOpts = (sel, extra = '') => extra + Array.from({ length: MAX_SLOTS }, (_, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${app.escapeHtml(slotName(i))}</option>`).join('');

  // ------------------------------------------------ Öffnen / Bild
  async function open(fileOrImg, name) {
    await app.withBusy('Analysiere Bild …', async () => {
      const src = fileOrImg instanceof Blob ? await IMG.loadImage(fileOrImg, 1200) : fileOrImg;
      L = { src, name: name || (fileOrImg.name || 'Logo').replace(/\.[^.]+$/, ''), img: null, q: null, colors: [], rot: 0, fresh: true };
      zones = []; selZone = -1;
      $('lgName').textContent = '– ' + L.name;
      for (const [id, v] of [['lgBri', 0], ['lgCon', 0], ['lgSat', 100]]) $(id).value = v;
      $('lgMirror').checked = false;
      updateAdjLabels();
      dlg.hidden = false;
      reprocess();
    });
  }
  function reopen() {
    if (!L) return false;
    dlg.hidden = false;
    layout();
    schedule(true);
    return true;
  }
  function close() { stopDrawing(); dlg.hidden = true; }

  function updateAdjLabels() {
    $('lgBriO').textContent = $('lgBri').value;
    $('lgConO').textContent = $('lgCon').value;
    $('lgSatO').textContent = $('lgSat').value + ' %';
  }
  function reprocess() {
    if (!L) return;
    L.img = IMG.preprocess(L.src, { brightness: +$('lgBri').value, contrast: +$('lgCon').value, saturation: +$('lgSat').value, rotate: L.rot, mirror: $('lgMirror').checked });
    const cv = $('lgSrc');
    cv.width = L.img.w; cv.height = L.img.h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(L.img.data), L.img.w, L.img.h), 0, 0);
    requantize();
  }
  function requantize() {
    if (!L || !L.img) return;
    const q = IMG.quantize(L.img, +$('lgK').value, { smooth: +$('lgSmooth').value, minPct: +$('lgMinPct').value, peaks: true });
    const old = L.colors;
    const bg = $('lgBg').checked ? IMG.cornerLabel(q) : IMG.TRANSPARENT;
    L.q = q;
    L.colors = q.colors.map((c, i) => ({
      slot: old[i] && !L.fresh ? old[i].slot : Math.min(i, MAX_SLOTS - 1),
      removed: i === bg,
      effect: old[i] ? old[i].effect : defEffect(),
    }));
    if (L.fresh) {
      // Startwerte: Platte in Hintergrundfarbe, Rahmen in der größten Logofarbe
      L.fresh = false;
      const bgSlot = bg !== IMG.TRANSPARENT && L.colors[bg] ? L.colors[bg].slot : -1;
      const main = L.colors.findIndex((c) => !c.removed);
      if (bgSlot >= 0) cfg.plate.slot = bgSlot;
      else cfg.plate.slot = Math.min(L.colors.length, MAX_SLOTS - 1);
      if (main >= 0) cfg.frame.slot = cfg.line.slot = L.colors[main].slot;
    }
    zones.forEach((z) => { if (z.label >= L.colors.length) z.label = -1; });
    renderAll();
  }

  // ------------------------------------------------ Tabellen
  function renderColors() {
    const q = L.q, total = q.w * q.h;
    let h = '<tr><th></th><th>Anteil</th><th>Filament</th><th>Effekt</th><th title="+ erhaben · − vertieft · 0 bündig">Höhe</th><th title="Breite der Fase/Rundung bzw. der Kontur">Kante</th><th title="nicht drucken">weg</th></tr>';
    q.colors.forEach((c, i) => {
      const r = L.colors[i], e = r.effect, dis = r.removed ? ' disabled' : '';
      h += `<tr data-i="${i}"><td><div class="sw" style="background:${app.rgbToHex(c)}" title="${app.nameOfColor(c)}"></div></td>` +
        `<td>${((q.counts[i] / total) * 100).toFixed(1).replace('.', ',')} %</td>` +
        `<td><select class="cslot">${slotOpts(r.slot)}</select></td>` +
        `<td><select class="cprof"${dis}>${opt(LG.CONTENT_PROFILES, e.profile)}</select></td>` +
        `<td><input type="number" class="ch" value="${e.h}" step="0.2"${dis}></td>` +
        `<td><input type="number" class="csize" value="${e.size}" min="0" step="0.1"${dis || (e.profile === 'flat' || e.profile === 'pillow' ? ' disabled' : '')}></td>` +
        `<td><input type="checkbox" class="crem"${r.removed ? ' checked' : ''}></td></tr>`;
    });
    if (q.transparent) h += `<tr><td><div class="sw checker"></div></td><td>${((q.transparent / total) * 100).toFixed(1).replace('.', ',')} %</td><td colspan="5" class="note">transparent – dort ist die Platte</td></tr>`;
    const tb = $('lgColors');
    tb.innerHTML = h;
    tb.querySelectorAll('tr[data-i]').forEach((tr) => {
      const r = L.colors[+tr.dataset.i];
      tr.querySelector('.cslot').addEventListener('change', (e) => { r.slot = +e.target.value; renderAll(); });
      tr.querySelector('.cprof').addEventListener('change', (e) => { r.effect.profile = e.target.value; renderColors(); schedule(); });
      tr.querySelector('.ch').addEventListener('input', (e) => { r.effect.h = +e.target.value || 0; schedule(); });
      tr.querySelector('.csize').addEventListener('input', (e) => { r.effect.size = Math.max(0, +e.target.value || 0); schedule(); });
      tr.querySelector('.crem').addEventListener('change', (e) => { r.removed = e.target.checked; renderColors(); schedule(); });
    });
  }

  function renderZones() {
    const tb = $('lgZones');
    if (!zones.length) { tb.innerHTML = '<tr><td class="note">Noch keine Bereiche.</td></tr>'; return; }
    const labOpts = (sel) => `<option value="-1"${sel < 0 ? ' selected' : ''}>alle Farben</option>` +
      L.q.colors.map((c, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>nur ${app.nameOfColor(c)} (${i + 1})</option>`).join('');
    let h = '<tr><th>#</th><th>gilt für</th><th>Effekt</th><th>Höhe</th><th>Kante</th><th>Filament</th><th></th></tr>';
    zones.forEach((z, k) => {
      const e = z.effect;
      h += `<tr data-z="${k}"${k === selZone ? ' class="sel"' : ''}><td>${k + 1}</td><td><select class="zlab">${labOpts(z.label)}</select></td>` +
        `<td><select class="zprof">${opt(LG.CONTENT_PROFILES, e.profile)}</select></td>` +
        `<td><input type="number" class="zh" value="${e.h}" step="0.2"></td>` +
        `<td><input type="number" class="zsize" value="${e.size}" min="0" step="0.1"${e.profile === 'flat' || e.profile === 'pillow' ? ' disabled' : ''}></td>` +
        `<td><select class="zslot">${slotOpts(e.slot, `<option value="-1"${e.slot < 0 ? ' selected' : ''}>wie Farbe</option>`)}</select></td>` +
        `<td><button class="zdel" title="Bereich löschen">✕</button></td></tr>`;
    });
    tb.innerHTML = h;
    tb.querySelectorAll('tr[data-z]').forEach((tr) => {
      const k = +tr.dataset.z, z = zones[k];
      tr.addEventListener('pointerdown', () => { if (selZone !== k) { selZone = k; tb.querySelectorAll('tr[data-z]').forEach((t) => t.classList.toggle('sel', +t.dataset.z === k)); drawOverlay(); } });
      tr.querySelector('.zlab').addEventListener('change', (e) => { z.label = +e.target.value; schedule(); });
      tr.querySelector('.zprof').addEventListener('change', (e) => { z.effect.profile = e.target.value; renderZones(); schedule(); });
      tr.querySelector('.zh').addEventListener('input', (e) => { z.effect.h = +e.target.value || 0; schedule(); });
      tr.querySelector('.zsize').addEventListener('input', (e) => { z.effect.size = Math.max(0, +e.target.value || 0); schedule(); });
      tr.querySelector('.zslot').addEventListener('change', (e) => { z.effect.slot = +e.target.value; schedule(); });
      tr.querySelector('.zdel').addEventListener('click', () => { zones.splice(k, 1); selZone = -1; renderZones(); schedule(); });
    });
  }

  // Rahmen-Auswahl mit Profil-Skizze
  function renderFrames() {
    const el = $('lgFrames');
    el.innerHTML = Object.entries(LG.FRAME_STYLES).map(([k, v]) => `<button data-frame="${k}"${k === cfg.frame.style ? ' class="active"' : ''}><canvas width="168" height="72"></canvas>${v}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => {
      const cv = b.querySelector('canvas'), g = cv.getContext('2d');
      const W = cv.width, H = cv.height, base = H * 0.72;
      g.fillStyle = '#5b6372';
      g.beginPath();
      g.moveTo(0, H); g.lineTo(0, base);
      if (b.dataset.frame !== 'none') {
        const fw = W * 0.6;
        for (let x = 0; x <= fw; x++) g.lineTo(x, base - LG.frameProfile(b.dataset.frame, x / fw) * H * 0.55);
        g.lineTo(fw, base);
      }
      g.lineTo(W, base); g.lineTo(W, H); g.closePath(); g.fill();
      if (b.dataset.frame !== 'none') {
        g.fillStyle = '#9aa1ad';
        g.font = '16px system-ui'; g.fillText('außen', 4, 16);
      }
      b.addEventListener('click', () => { cfg.frame.style = b.dataset.frame; el.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); schedule(); });
    });
  }

  function renderSlotSelects() {
    document.querySelectorAll('#logoDlg select[data-slot]').forEach((s) => { s.innerHTML = slotOpts(getK(s.dataset.k)); });
  }

  function syncInputs() {
    document.querySelectorAll('#logoDlg [data-k]').forEach((el) => {
      const v = getK(el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    syncVisibility();
  }
  function syncVisibility() {
    const sh = cfg.plate.shape;
    document.querySelectorAll('#logoDlg .lgrect').forEach((e) => { e.hidden = sh !== 'rect'; });
    document.querySelectorAll('#logoDlg .lgcontour').forEach((e) => { e.hidden = sh !== 'contour'; });
    $('lgFrames').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.frame === cfg.frame.style));
  }

  function renderAll() {
    renderColors();
    renderZones();
    renderSlotSelects();
    syncInputs();
    schedule(true);
  }

  // ------------------------------------------------ Vorschau
  function schedule(now) {
    clearTimeout(timer);
    timer = setTimeout(renderPreview, now ? 0 : 140);
  }
  function renderPreview() {
    if (!L || !L.q || dlg.hidden) return;
    // Vorschau mit begrenzter Auflösung, damit sie flüssig bleibt
    const pc = structuredClone(cfg);
    const est = cfg.widthMm * 1.5 + 2 * (Math.max(0, cfg.plate.pad) + (cfg.frame.style !== 'none' ? cfg.frame.width : 0));
    pc.cellMm = Math.max(cfg.cellMm, est / 560);
    previewCell = pc.cellMm;
    field = LG.buildField(L.q, L.colors, zones, pc);
    const info = LG.fieldInfo(field);
    const pal = slotColors();
    let w, h, px;
    if (show === 'relief') {
      w = field.gw; h = field.gh;
      px = LG.renderField(field, pal);
    } else {
      w = L.q.w; h = L.q.h;
      px = IMG.renderLabels(L.q, (l) => (l === IMG.TRANSPARENT || !L.colors[l] || L.colors[l].removed ? null : L.q.colors[l]));
    }
    prev.width = w; prev.height = h;
    prev.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    const cells = Math.round((info.w / cfg.cellMm) * (info.h / cfg.cellMm));
    $('lgInfo').textContent = info.w ? `Gesamt ${fmt(info.w)} × ${fmt(info.h)} mm, Höhe ${fmt(info.z)} mm` : 'Nichts zu drucken – Dicke oder Höhe > 0 wählen.';
    $('lgTris').textContent = `Pixelgröße ${String(cfg.cellMm).replace('.', ',')} mm` + (cells > 1.2e6 ? ` · sehr fein (${app.fmtInt(cells)} Zellen) – Erzeugen dauert länger` : '') +
      (previewCell > cfg.cellMm * 1.01 ? ' · Vorschau vereinfacht' : '');
    layout();
  }

  // Canvas einpassen und Inhaltsrechteck bestimmen
  function layout() {
    if (!field && show === 'relief') return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H || !prev.width) return;
    const s = Math.min(W / prev.width, H / prev.height);
    const cw = prev.width * s, ch = prev.height * s, x = (W - cw) / 2, y = (H - ch) / 2;
    for (const c of [prev, over]) Object.assign(c.style, { left: x + 'px', top: y + 'px', width: cw + 'px', height: ch + 'px' });
    prev.style.imageRendering = s > 2 ? 'pixelated' : 'auto';
    const dpr = window.devicePixelRatio || 1;
    over.width = Math.round(cw * dpr); over.height = Math.round(ch * dpr);
    if (show === 'relief' && field) {
      const C = field.content;
      view = { x: C.Mx * s, y: (field.gh - C.My - C.ih) * s, w: C.iw * s, h: C.ih * s };
    } else view = { x: 0, y: 0, w: cw, h: ch };
    drawOverlay();
  }
  function drawOverlay() {
    const g = over.getContext('2d'), dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, over.width, over.height);
    if (!view) return;
    const rect = (u0, v0, u1, v1) => [view.x + u0 * view.w, view.y + v0 * view.h, (u1 - u0) * view.w, (v1 - v0) * view.h];
    zones.forEach((z, k) => {
      const [x, y, w, h] = rect(z.u0, z.v0, z.u1, z.v1);
      const sel = k === selZone;
      g.fillStyle = sel ? 'rgba(59,130,246,.18)' : 'rgba(59,130,246,.07)';
      g.fillRect(x, y, w, h);
      g.setLineDash([5, 4]);
      g.lineWidth = sel ? 2 : 1.3;
      g.strokeStyle = sel ? '#60a5fa' : 'rgba(255,255,255,.8)';
      g.strokeRect(x + 0.5, y + 0.5, w, h);
      g.setLineDash([]);
      g.fillStyle = sel ? '#60a5fa' : 'rgba(20,22,28,.85)';
      g.fillRect(x, y, 18, 16);
      g.fillStyle = '#fff'; g.font = '11px system-ui';
      g.fillText(String(k + 1), x + 5, y + 12);
    });
    if (drag) {
      g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.lineWidth = 1.5;
      g.strokeRect(Math.min(drag.x0, drag.x1) + 0.5, Math.min(drag.y0, drag.y1) + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      g.setLineDash([]);
    }
  }
  new ResizeObserver(() => { if (!dlg.hidden) layout(); }).observe(wrap);

  // ------------------------------------------------ Bereiche zeichnen
  function startDrawing() {
    drawing = true;
    over.classList.add('drawing');
    $('lgDrawNote').hidden = false;
  }
  function stopDrawing() {
    drawing = false; drag = null;
    over.classList.remove('drawing');
    $('lgDrawNote').hidden = true;
    drawOverlay();
  }
  const local = (e) => { const r = over.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toUV = (x, y) => [Math.min(1, Math.max(0, (x - view.x) / view.w)), Math.min(1, Math.max(0, (y - view.y) / view.h))];
  over.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    const [x, y] = local(e);
    if (drawing) {
      drag = { x0: x, y0: y, x1: x, y1: y };
      try { over.setPointerCapture(e.pointerId); } catch { /* egal */ }
      return;
    }
    // Bereich anklicken -> auswählen (oberster zuerst)
    const [u, v] = toUV(x, y);
    let hit = -1;
    for (let k = zones.length - 1; k >= 0; k--) { const z = zones[k]; if (u >= z.u0 && u <= z.u1 && v >= z.v0 && v <= z.v1) { hit = k; break; } }
    if (hit !== selZone) { selZone = hit; renderZones(); drawOverlay(); }
    if (hit >= 0) showTab('zones');
  });
  over.addEventListener('pointermove', (e) => {
    if (!drag) return;
    [drag.x1, drag.y1] = local(e);
    drawOverlay();
  });
  over.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (Math.abs(d.x1 - d.x0) > 4 && Math.abs(d.y1 - d.y0) > 4) {
      const [u0, v0] = toUV(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
      const [u1, v1] = toUV(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      zones.push({ u0, v0, u1, v1, label: -1, effect: { profile: 'round', h: 1.5, size: 0.6, slot: -1 } });
      selZone = zones.length - 1;
      renderZones();
      schedule(true);
    }
    stopDrawing();
  });

  // ------------------------------------------------ Tabs, Eingaben
  function showTab(t) {
    $('lgTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    dlg.querySelectorAll('.tab').forEach((d) => { d.hidden = d.dataset.tab !== t; });
  }
  $('lgTabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('lgShow').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    show = b.dataset.show;
    $('lgShow').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    schedule(true);
  }));

  $('lgShape').innerHTML = opt(LG.PLATE_SHAPES, cfg.plate.shape);
  $('lgCorner').innerHTML = opt(LG.CORNER_STYLES, cfg.plate.corner);
  $('lgPreset').innerHTML = '<option value="">Vorlage …</option>' + Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  renderFrames();

  document.querySelectorAll('#logoDlg [data-k]').forEach((el) => {
    const isNum = el.type === 'number' || 'num' in el.dataset || 'slot' in el.dataset;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      let v = el.type === 'checkbox' ? el.checked : isNum ? +el.value : el.value;
      if (isNum && !Number.isFinite(v)) return;
      setK(el.dataset.k, v);
      syncVisibility();
      schedule();
    });
  });

  $('lgPreset').addEventListener('change', (e) => {
    const p = PRESETS[e.target.value];
    e.target.value = '';
    if (!p) return;
    for (const sec of Object.keys(p.cfg)) Object.assign(cfg[sec], p.cfg[sec]);
    if (L) L.colors.forEach((c) => { c.effect = { ...defEffect(), ...p.effect }; });
    zones.forEach((z) => { z.effect = { ...z.effect, ...p.effect, profile: z.effect.profile }; });
    renderAll();
  });

  ['lgK', 'lgSmooth', 'lgMinPct', 'lgBg'].forEach((id) => $(id).addEventListener('change', requantize));
  $('lgAdopt').addEventListener('change', () => { renderColors(); renderZones(); renderSlotSelects(); schedule(true); });
  for (const id of ['lgBri', 'lgCon', 'lgSat']) {
    $(id).addEventListener('input', updateAdjLabels);
    $(id).addEventListener('change', reprocess);
  }
  $('lgMirror').addEventListener('change', reprocess);
  $('lgRotL').addEventListener('click', () => { L.rot = (L.rot + 3) % 4; reprocess(); });
  $('lgRotR').addEventListener('click', () => { L.rot = (L.rot + 1) % 4; reprocess(); });
  $('lgAdjReset').addEventListener('click', () => {
    $('lgBri').value = 0; $('lgCon').value = 0; $('lgSat').value = 100; $('lgMirror').checked = false;
    L.rot = 0; updateAdjLabels(); reprocess();
  });
  $('lgZoneAdd').addEventListener('click', () => (drawing ? stopDrawing() : startDrawing()));
  $('lgCancel').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (dlg.hidden || e.key !== 'Escape') return;
    if (drawing) stopDrawing(); else close();
  });

  // ------------------------------------------------ Erzeugen
  $('lgApply').addEventListener('click', () => {
    if (!L || !L.q) return;
    app.withBusy('Erzeuge Modell …', () => {
      const F = LG.buildField(L.q, L.colors, zones, cfg);
      const M = LG.fieldToMesh(F);
      if (!M.col.length) { alert('Es entsteht kein Modell – Dicke oder Höhe > 0 wählen.'); return; }
      if (M.col.length > 4e6 && !confirm(`${app.fmtInt(M.col.length)} Dreiecke – das wird träge. Trotzdem erzeugen? (Pixelgröße erhöhen hilft.)`)) return;
      // Benutzte Filamente anlegen und ggf. an die Bildfarben anpassen
      let maxSlot = 0;
      for (let t = 0; t < M.col.length; t++) if (M.col[t] > maxSlot) maxSlot = M.col[t];
      while (state.palette.length <= maxSlot) {
        const d = DEFAULT_COLORS[state.palette.length];
        state.palette.push({ name: d[0], color: d[1] });
      }
      if (adopt()) {
        const done = new Set();
        L.colors.forEach((c, i) => {
          if (done.has(c.slot) || c.slot >= state.palette.length) return;
          done.add(c.slot);
          state.palette[c.slot] = { name: app.nameOfColor(L.q.colors[i]), color: app.rgbToHex(L.q.colors[i]) };
        });
      }
      app.renderPalette();
      if (app.getPaint()) app.snapshot(true);
      const pm = new PaintMesh(M.pos, M.col);
      pm.dropToBed();
      app.setModel(pm, L.name);
      app.toast(`Logo-Modell erzeugt: ${app.fmtInt(pm.n)} Dreiecke` + (pm.openEdges ? ` – Achtung, ${pm.openEdges} offene Kanten` : '') + '. „Logo / Schild…“ öffnet die Einstellungen wieder.', 6000);
      close();
    });
  });

  return { open, reopen, close, isOpen: () => !dlg.hidden, hasImage: () => !!L };
}