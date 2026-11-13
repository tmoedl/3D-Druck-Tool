// Bild -> wenige Farben (nach Flächenanteil) und Bild -> farbige Platte.

export const TRANSPARENT = 255;

// Bilddatei laden und auf maxDim verkleinern -> {w,h,data}
export async function loadImage(file, maxDim = 800) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  return { w, h, data: id.data };
}

// Helligkeit/Kontrast (-100..100), Sättigung (0..200 %), Drehen (Vierteldrehungen), Spiegeln
export function preprocess(img, { brightness = 0, contrast = 0, saturation = 100, rotate = 0, mirror = false } = {}) {
  let { w, h } = img;
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  const cf = (259 * (contrast * 1.275 + 255)) / (255 * (259 - contrast * 1.275));
  const sf = saturation / 100, bf = brightness * 1.28;
  const r = ((rotate % 4) + 4) % 4;
  const W2 = r % 2 ? h : w, H2 = r % 2 ? w : h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      let R = cf * (src[i] - 128) + 128 + bf, G = cf * (src[i + 1] - 128) + 128 + bf, B = cf * (src[i + 2] - 128) + 128 + bf;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      R = L + (R - L) * sf; G = L + (G - L) * sf; B = L + (B - L) * sf;
      let xx = mirror ? w - 1 - x : x, yy = y;
      let nx = xx, ny = yy;
      if (r === 1) { nx = h - 1 - yy; ny = xx; }
      else if (r === 2) { nx = w - 1 - xx; ny = h - 1 - yy; }
      else if (r === 3) { nx = yy; ny = w - 1 - xx; }
      const o = 4 * (ny * W2 + nx);
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = src[i + 3];
    }
  }
  return { w: W2, h: H2, data: out };
}

// Häufigstes Label in den vier Ecken (typisch: Hintergrund)
export function cornerLabel(q) {
  const cnt = new Map();
  const s = Math.max(1, Math.round(Math.min(q.w, q.h) * 0.04));
  for (const [cx, cy] of [[0, 0], [q.w - s, 0], [0, q.h - s], [q.w - s, q.h - s]]) {
    for (let y = cy; y < cy + s; y++) for (let x = cx; x < cx + s; x++) {
      const l = q.labels[y * q.w + x];
      cnt.set(l, (cnt.get(l) || 0) + 1);
    }
  }
  let best = TRANSPARENT, bc = 0;
  for (const [l, c] of cnt) if (c > bc) { bc = c; best = l; }
  return best;
}

const WR = 2, WG = 4, WB = 3; // einfache Wahrnehmungs-Gewichtung
const dist = (r1, g1, b1, r2, g2, b2) => WR * (r1 - r2) ** 2 + WG * (g1 - g2) ** 2 + WB * (b1 - b2) ** 2;

// Reduziert ein Bild auf k Farben. Farben werden nach Flächenanteil gewählt;
// kleine Ausreißer (einzelne Pixel, Rauschen, Kantenglättung) werden ignoriert.
// opts.smooth: Anzahl Durchläufe Mehrheitsfilter (entfernt Einzelpixel)
// opts.minPct: Farben mit weniger Fläche (in %) werden der nächsten Farbe zugeschlagen
// opts.fixed: vorgegebene Farben [[r,g,b],...] statt automatischer Bestimmung
// opts.peaks: Farben an den Häufigkeitsspitzen wählen (für Logos: reine Farben statt
//             Mischtönen der Kantenglättung)
export function quantize(img, k, { smooth = 2, minPct = 1, alphaCut = 128, fixed = null, peaks = false } = {}) {
  const { w, h, data } = img, N = w * h;
  const cnt = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  let opaque = 0;
  for (let p = 0; p < N; p++) {
    if (data[4 * p + 3] < alphaCut) continue;
    const r = data[4 * p], g = data[4 * p + 1], b = data[4 * p + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    cnt[key]++; sr[key] += r; sg[key] += g; sb[key] += b;
    opaque++;
  }
  const labels = new Uint8Array(N).fill(TRANSPARENT);
  if (opaque === 0) return { w, h, labels, colors: [], counts: [], transparent: N };

  let centers;
  if (fixed && fixed.length) {
    centers = fixed.map((c) => c.slice());
  } else if (peaks) {
    centers = peakCenters(cnt, sr, sg, sb, k);
  } else {
  // Histogramm-Bins
  const bins = [];
  for (let i = 0; i < 32768; i++) if (cnt[i]) bins.push({ c: cnt[i], r: sr[i] / cnt[i], g: sg[i] / cnt[i], b: sb[i] / cnt[i] });
  bins.sort((a, b) => b.c - a.c);

  // Startzentren: größte Fläche zuerst, dann weit entfernte aber signifikante Farben
  const minCount = opaque * 0.004;
  let cand = bins.filter((b) => b.c >= minCount);
  if (cand.length < k) cand = bins.slice(0, Math.max(k, 64));
  centers = [[cand[0].r, cand[0].g, cand[0].b]];
  while (centers.length < k) {
    let best = null, bs = 0;
    for (const b of cand) {
      let md = Infinity;
      for (const c of centers) md = Math.min(md, dist(b.r, b.g, b.b, c[0], c[1], c[2]));
      const s = md * b.c;
      if (s > bs) { bs = s; best = b; }
    }
    if (!best || bs < 1) break;
    centers.push([best.r, best.g, best.b]);
  }

  // k-Means auf dem gewichteten Histogramm
  const K = centers.length;
  const assign = new Int32Array(bins.length);
  for (let it = 0; it < 40; it++) {
    const acc = Array.from({ length: K }, () => [0, 0, 0, 0]);
    let moved = false;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < K; c++) {
        const d = dist(b.r, b.g, b.b, centers[c][0], centers[c][1], centers[c][2]);
        if (d < bd) { bd = d; bi = c; }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
      const a = acc[bi];
      a[0] += b.r * b.c; a[1] += b.g * b.c; a[2] += b.b * b.c; a[3] += b.c;
    }
    for (let c = 0; c < K; c++) if (acc[c][3]) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    if (!moved && it > 0) break;
  }
  }
  const K = centers.length;

  let colors = centers.map((c) => c.slice());
  const fixedCols = fixed && fixed.length ? centers.map((c) => c.slice()) : null;
  const nearest = (r, g, b, cols, skip = -1) => {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < cols.length; c++) {
      if (c === skip || !cols[c]) continue;
      const d = dist(r, g, b, cols[c][0], cols[c][1], cols[c][2]);
      if (d < bd) { bd = d; bi = c; }
    }
    return bi;
  };
  for (let p = 0; p < N; p++) {
    if (data[4 * p + 3] < alphaCut) continue;
    labels[p] = nearest(data[4 * p], data[4 * p + 1], data[4 * p + 2], colors);
  }

  // Mehrheitsfilter gegen Einzelpixel / Rauschen
  modeFilter(labels, w, h, K, smooth);

  // Zu kleine Farbflächen auflösen
  for (;;) {
    const counts = new Uint32Array(K);
    for (let p = 0; p < N; p++) if (labels[p] !== TRANSPARENT) counts[labels[p]]++;
    let worst = -1;
    for (let c = 0; c < K; c++) {
      if (!colors[c]) continue;
      if (counts[c] < (opaque * minPct) / 100 && (worst < 0 || counts[c] < counts[worst])) worst = c;
    }
    const alive = colors.filter(Boolean).length;
    if (worst < 0 || alive <= 1) break;
    for (let p = 0; p < N; p++) {
      if (labels[p] === worst) labels[p] = nearest(data[4 * p], data[4 * p + 1], data[4 * p + 2], colors, worst);
    }
    colors[worst] = null;
  }

  // Endgültige Farben = Mittelwert, nach Fläche sortiert
  const acc = Array.from({ length: K }, () => [0, 0, 0, 0]);
  let transparent = 0;
  for (let p = 0; p < N; p++) {
    const l = labels[p];
    if (l === TRANSPARENT) { transparent++; continue; }
    acc[l][0] += data[4 * p]; acc[l][1] += data[4 * p + 1]; acc[l][2] += data[4 * p + 2]; acc[l][3]++;
  }
  const order = [];
  for (let c = 0; c < K; c++) if (acc[c][3] > 0) order.push(c);
  order.sort((a, b) => acc[b][3] - acc[a][3]);
  const remap = new Uint8Array(256).fill(TRANSPARENT);
  order.forEach((c, i) => { remap[c] = i; });
  for (let p = 0; p < N; p++) labels[p] = remap[labels[p]];
  colors = order.map((c) => fixedCols ? fixedCols[c] : [Math.round(acc[c][0] / acc[c][3]), Math.round(acc[c][1] / acc[c][3]), Math.round(acc[c][2] / acc[c][3])]);
  const counts = order.map((c) => acc[c][3]);
  return { w, h, labels, colors, counts, transparent, origin: order };
}

// Lokale Maxima des (geglätteten) Farbhistogramms, nach Häufigkeit, mit Mindestabstand
function peakCenters(cnt, sr, sg, sb, k) {
  const S = new Float64Array(32768);
  const key = (r, g, b) => (r << 10) | (g << 5) | b;
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const R = r + dr, G = g + dg, B = b + db;
      if (R >= 0 && G >= 0 && B >= 0 && R < 32 && G < 32 && B < 32) s += cnt[key(R, G, B)];
    }
    S[key(r, g, b)] = s;
  }
  const cand = [];
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const kk = key(r, g, b);
    if (!cnt[kk]) continue;
    let max = true;
    for (let dr = -1; dr <= 1 && max; dr++) for (let dg = -1; dg <= 1 && max; dg++) for (let db = -1; db <= 1; db++) {
      const R = r + dr, G = g + dg, B = b + db;
      if ((dr || dg || db) && R >= 0 && G >= 0 && B >= 0 && R < 32 && G < 32 && B < 32 && S[key(R, G, B)] > S[kk]) { max = false; break; }
    }
    if (!max) continue;
    // Farbe = Mittelwert der Umgebung
    let n = 0, ar = 0, ag = 0, ab = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const R = r + dr, G = g + dg, B = b + db;
      if (R < 0 || G < 0 || B < 0 || R > 31 || G > 31 || B > 31) continue;
      const q = key(R, G, B);
      n += cnt[q]; ar += sr[q]; ag += sg[q]; ab += sb[q];
    }
    cand.push({ s: S[kk], c: [ar / n, ag / n, ab / n] });
  }
  cand.sort((a, b) => b.s - a.s);
  const out = [];
  const minD = 9 * 36 * 36;
  for (const p of cand) {
    if (out.length >= k) break;
    if (out.every((c) => dist(c[0], c[1], c[2], p.c[0], p.c[1], p.c[2]) > minD)) out.push(p.c);
  }
  return out.length ? out : [cand[0].c];
}

function modeFilter(labels, w, h, K, iterations) {
  const T = K; // Index für "transparent" im Zähler
  const tmp = new Uint8Array(labels.length);
  const c = new Uint16Array(K + 1);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        c.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const l = labels[yy * w + xx];
            c[l === TRANSPARENT ? T : l]++;
          }
        }
        const cur = labels[y * w + x], ci = cur === TRANSPARENT ? T : cur;
        let best = ci;
        for (let i = 0; i <= K; i++) if (c[i] > c[best]) best = i;
        tmp[y * w + x] = best === T ? TRANSPARENT : best;
      }
    }
    labels.set(tmp);
  }
}

// Vorschaubild der reduzierten Farben (ImageData-kompatibles Array)
export function renderLabels(q, colorOf) {
  const out = new Uint8ClampedArray(q.w * q.h * 4);
  for (let p = 0; p < q.w * q.h; p++) {
    const l = q.labels[p];
    const c = colorOf(l);
    if (!c) { out[4 * p + 3] = 0; continue; }
    out[4 * p] = c[0]; out[4 * p + 1] = c[1]; out[4 * p + 2] = c[2]; out[4 * p + 3] = 255;
  }
  return out;
}

// Label an normierter Bildposition (u,v in 0..1, v=0 oben)
export function labelAt(q, u, v) {
  const x = Math.min(q.w - 1, Math.max(0, Math.floor(u * q.w)));
  const y = Math.min(q.h - 1, Math.max(0, Math.floor(v * q.h)));
  return q.labels[y * q.w + x];
}

// Erzeugt eine geschlossene Platte (Schild/Relief) aus dem Farbbild.
// opts: widthMm, cellMm, base (mm), relief[label] (mm zusätzlich), removed[label] (bool),
//       slotOf[label], baseSlot (-1 = Bildfarbe auch für Grundplatte)
export function buildPlate(q, opts) {
  const { widthMm, cellMm, base, relief, removed, slotOf, baseSlot } = opts;
  const border = opts.border || 0, borderSlot = opts.borderSlot || 0, borderRelief = opts.borderRelief || 0;
  const iw = Math.max(1, Math.round(widthMm / cellMm));
  const ih = Math.max(1, Math.round((iw * q.h) / q.w));
  const cs = widthMm / iw;
  const bc = border > 0 ? Math.max(1, Math.round(border / cs)) : 0;
  const gw = iw + 2 * bc, gh = ih + 2 * bc;
  const H = new Float64Array(gw * gh), S = new Uint8Array(gw * gh);
  const levels = new Set([0]);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      let hh, sl;
      if (i < bc || j < bc || i >= gw - bc || j >= gh - bc) {
        hh = base + borderRelief; sl = borderSlot;
      } else {
        const l = labelAt(q, (i - bc + 0.5) / iw, 1 - (j - bc + 0.5) / ih);
        if (l === TRANSPARENT || removed[l]) continue;
        hh = base + (relief[l] || 0); sl = slotOf[l];
      }
      if (!(hh > 0)) continue;
      hh = Math.round(hh * 1000) / 1000;
      H[j * gw + i] = hh;
      S[j * gw + i] = sl;
      levels.add(hh);
    }
  }
  if (base > 0) levels.add(Math.round(base * 1000) / 1000);
  const lv = [...levels].sort((a, b) => a - b);
  const x0 = -(gw * cs) / 2, y0 = -(gh * cs) / 2;
  const out = [], col = [];
  const quad = (a, b, c, d, s) => { out.push(...a, ...b, ...c, ...a, ...c, ...d); col.push(s, s); };
  const hAt = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : H[j * gw + i]);
  const wall = (za, zb, s, fn) => {
    // Wand zwischen za und zb, an allen Höhenstufen geteilt (keine T-Stellen)
    for (let k = 0; k + 1 < lv.length; k++) {
      const a = lv[k], b = lv[k + 1];
      if (a < za - 1e-9 || b > zb + 1e-9) continue;
      const ws = baseSlot >= 0 && b <= base + 1e-9 ? baseSlot : s;
      fn(a, b, ws);
    }
  };
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const h = H[j * gw + i];
      if (h <= 0) continue;
      const s = S[j * gw + i];
      const xa = x0 + i * cs, xb = x0 + (i + 1) * cs, ya = y0 + j * cs, yb = y0 + (j + 1) * cs;
      quad([xa, ya, h], [xb, ya, h], [xb, yb, h], [xa, yb, h], s);
      const bs = baseSlot >= 0 ? baseSlot : s;
      quad([xa, ya, 0], [xa, yb, 0], [xb, yb, 0], [xb, ya, 0], bs);
      let hn;
      if ((hn = hAt(i + 1, j)) < h) wall(hn, h, s, (a, b, ws) => quad([xb, ya, a], [xb, yb, a], [xb, yb, b], [xb, ya, b], ws));
      if ((hn = hAt(i - 1, j)) < h) wall(hn, h, s, (a, b, ws) => quad([xa, yb, a], [xa, ya, a], [xa, ya, b], [xa, yb, b], ws));
      if ((hn = hAt(i, j + 1)) < h) wall(hn, h, s, (a, b, ws) => quad([xb, yb, a], [xa, yb, a], [xa, yb, b], [xb, yb, b], ws));
      if ((hn = hAt(i, j - 1)) < h) wall(hn, h, s, (a, b, ws) => quad([xa, ya, a], [xb, ya, a], [xb, ya, b], [xa, ya, b], ws));
    }
  }
  return { pos: Float32Array.from(out), col: Uint8Array.from(col), gw, gh, cellMm: cs };
}
