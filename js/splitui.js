// Werkzeug „Teilen“: Schnittebene finden (Achse, Kante, dünnster Querschnitt, Fläche, 3 Punkte, Bauraum),
// Verbinder auf der Schnittfläche setzen und prüfen, teilen, Teile für den Druck hinlegen und anordnen.
import * as THREE from 'three';
import * as SP from './split.js';
import * as IO from './io.js';

const $ = (id) => document.getElementById(id);

const MODE_NOTES = {
  axis: 'Ebene quer zu einer Achse. Ein Klick auf das Modell setzt die Position.',
  edge: 'Mit der Maus über eine Kante fahren, der erkannte Kantenzug leuchtet. Ein Klick legt die Ebene genau durch diese Kante, z. B. einen Absatz oder Knick im Modell.',
  thin: 'Klick auf die Oberfläche: Die Ebene läuft quer zur Form durch die angeklickte Stelle, mit dem kleinsten Querschnitt. Gut für Arme, Rohre und geschwungene Formen.',
  face: 'Klick auf eine Fläche: Die Ebene liegt parallel dazu. Mit „Versatz“ ins Modell hinein schieben.',
  pts: 'Drei Punkte auf dem Modell anklicken. Die Ebene läuft durch alle drei.',
  region: 'Klick wählt eine glatte Fläche bis zu ihren Kanten aus (z. B. den Schaft). Shift+Klick fügt weitere Flächen hinzu, Strg+Klick nimmt welche weg. Jede Grenze der Auswahl kann Schnittlinie werden – auch wenn sie schräg oder geschwungen verläuft.',
  auto: 'Zerlegt das Modell so, dass jedes Teil in den Bauraum passt. Die Verbinder werden auf jeder Schnittfläche automatisch verteilt.',
};

export function initSplit(app) {
  const st = {
    mode: 'axis', axis: 'z', axisPos: null,
    base: null, // Grundebene {O, N} vor der Feinjustage
    offset: 0, tiltU: 0, tiltW: 0, flip: false,
    scope: 'all', localPt: null, snap: 0.002,
    pts: [],
    prm: SP.defaultConnParams(),
    conns: [], manual: false,
    plan: null,
    pv: null,
    edgeHover: null, edgeInfo: '', planeInfo: '',
    region: { sel: null, loops: [], li: -1 },
    curve: null, // Schnitt entlang einer Grenze: {ids, N, fr, field}
  };
  let active = false, timer = 0, lastHover = '', drag = null, view = null;

  // ------------------------------------------------ 3D-Überlagerung
  const grp = new THREE.Group();
  grp.visible = false;
  app.scene.add(grp);
  const objs = {};
  function setObj(name, obj) {
    const old = objs[name];
    if (old) {
      grp.remove(old);
      old.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    objs[name] = obj || null;
    if (obj) { obj.traverse((o) => { o.renderOrder = 14; o.frustumCulled = false; }); grp.add(obj); }
    app.requestRender();
  }
  const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity });
  function segObj(pairs, color, opacity = 1) {
    if (!pairs.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pairs.flat()), 3));
    return new THREE.LineSegments(g, lineMat(color, opacity));
  }
  const world = (P, u, w, lift = 0) => [P.O[0] + u * P.U[0] + w * P.W[0] + lift * P.N[0], P.O[1] + u * P.U[1] + w * P.W[1] + lift * P.N[1], P.O[2] + u * P.U[2] + w * P.W[2] + lift * P.N[2]];
  function loopPairs(P, loops, lift = 0) {
    const out = [];
    for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) out.push(world(P, L[j][0], L[j][1], lift), world(P, L[i][0], L[i][1], lift));
    return out;
  }
  function planeQuad(P, box, color = 0x3b82f6) {
    const pad = Math.max(2, 0.12 * Math.max(box[1] - box[0], box[3] - box[2]));
    const u0 = box[0] - pad, u1 = box[1] + pad, w0 = box[2] - pad, w1 = box[3] + pad;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    const U = new THREE.Vector3(...P.U), W = new THREE.Vector3(...P.W), N = new THREE.Vector3(...P.N);
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(U.multiplyScalar(u1 - u0), W.multiplyScalar(w1 - w0), N).setPosition(new THREE.Vector3(...world(P, (u0 + u1) / 2, (w0 + w1) / 2)));
    const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0))), lineMat(color, 0.7));
    m.add(e);
    return m;
  }

  // ------------------------------------------------ Ebene
  const diag = () => { const b = app.getPaint().bbox; return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 10; };
  function rotateAround(v, k, deg) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
    const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * d * (1 - c));
  }
  function plane() {
    if (st.curve) return st.curve.fr.P;
    if (!st.base) return null;
    let N = st.base.N.slice();
    if (st.flip) N = N.map((x) => -x);
    const P0 = SP.makePlane(st.base.O, N);
    if (st.tiltU) N = rotateAround(N, P0.U, st.tiltU);
    if (st.tiltW) N = rotateAround(N, P0.W, st.tiltW);
    const l = Math.hypot(...N);
    N = N.map((x) => x / l);
    return SP.makePlane(st.base.O.map((x, i) => x + st.offset * N[i]), N);
  }
  function setBase(base, scope, localPt) {
    st.base = base;
    st.offset = 0; st.tiltU = 0; st.tiltW = 0; st.flip = false;
    st.scope = scope; st.localPt = localPt;
    st.manual = false;
    syncTune();
    schedule(0);
  }
  function axisPlane() {
    const pm = app.getPaint();
    if (!pm) return;
    const k = 'xyz'.indexOf(st.axis), b = pm.bbox;
    if (st.axisPos === null || st.axisPos < b.min[k] || st.axisPos > b.max[k]) st.axisPos = (b.min[k] + b.max[k]) / 2;
    const O = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
    O[k] = st.axisPos;
    const N = [0, 0, 0];
    N[k] = 1;
    const keep = st.base && st.mode === 'axis';
    st.base = { O, N };
    if (!keep) { st.offset = 0; st.tiltU = 0; st.tiltW = 0; st.flip = false; }
    if (st.scope === 'local' && !st.localPt) st.scope = 'all';
    syncAxis();
    syncTune();
    schedule(30);
  }
  function surfNormal(pm, t, hp) {
    const fn = pm.fn, n0 = [fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]], N = [0, 0, 0];
    pm.sphereRegion(t, hp[0], hp[1], hp[2], Math.max(0.3, diag() * 0.01));
    for (let i = 0; i < pm.outCount; i++) {
      const s = pm.out[i], n = [fn[3 * s], fn[3 * s + 1], fn[3 * s + 2]];
      if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.85) { N[0] += n[0]; N[1] += n[1]; N[2] += n[2]; }
    }
    const l = Math.hypot(...N);
    return l > 1e-9 ? N.map((x) => x / l) : n0;
  }
  const camDir = () => { const v = new THREE.Vector3(); app.camera.getWorldDirection(v); return v.toArray(); };
  function edgeAt(pm, t, hp) {
    return SP.featureLoop(pm, t, hp, +$('spEdgeAng').value, Math.max(0.5, diag() * 0.02));
  }
  function setEdgePlane(L) {
    const f = L.fit;
    let N = f.N;
    if (f.line) {
      const d = camDir(), a = f.axis;
      N = [a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]];
      const l = Math.hypot(...N) || 1;
      N = N.map((x) => x / l);
    }
    const d = camDir();
    if (N[0] * d[0] + N[1] * d[1] + N[2] * d[2] > 0) N = N.map((x) => -x);
    setBase({ O: f.O, N }, 'local', L.pts[0]);
    st.snap = Math.min(0.25, Math.max(0.002, f.dev * 1.5 + 0.002));
    $('spSnap').value = +st.snap.toFixed(3);
    st.edgeInfo = `Kantenzug: ${L.ids.length} Punkte, ${L.closed ? 'geschlossen' : 'offen'}` + (f.line ? ', gerade (Ebene durch die Kante in Blickrichtung)' : `, Abweichung von der Ebene ${app.fmtMm(f.dev)} mm`) +
      (f.dev > 0.002 ? `. Punkte bis ${app.fmtMm(st.snap)} mm werden auf die Ebene gezogen.` : '.');
  }

  // ------------------------------------------------ Analyse: Schnittfläche, Prüfung, Verbinder
  function analyseCurve(V, I, cv, keepConns) {
    const prm = st.prm, fr = cv.fr, P = fr.P;
    const regs = [{ outer: fr.pts, holes: [], area: fr.area }];
    const n0 = SP.connNeeds(prm);
    // Bohrungen beginnen auf der gekrümmten Fläche: Prüftiefe um den Höhenbereich verlängern
    const needs = { ...n0, dA: n0.dA + Math.max(0, -fr.hmin), dB: n0.dB + Math.max(0, fr.hmax) };
    const a = { P, regs, sel: regs, needs, slices: null, conns: [], feats: null, curve: cv };
    if (prm.type === 'none') return a;
    if (!SP.isPointType(prm.type)) { a.unsupported = true; return a; }
    a.slices = SP.depthSlices(V, I, P, needs.dA + 0.01, needs.dB + 0.01, 0.005);
    a.conns = keepConns || SP.autoPlace(regs, a.slices, needs, prm);
    for (const c of a.conns) Object.assign(c, SP.checkConn(c, regs, a.slices, needs, prm, a.conns));
    return a;
  }
  function analyse(V, I, P, localPt, keepConns) {
    const prm = st.prm;
    const eps = Math.max(2 * st.snap, 0.005), sv = SP.vertexDist(V, P);
    const rA = SP.sectionRegions(SP.slice(V, I, P, -eps, sv)), rB = SP.sectionRegions(SP.slice(V, I, P, eps, sv));
    const sum = (rs) => rs.reduce((s, r) => s + r.area, 0);
    const regs = rA.length && (!rB.length || sum(rA) <= sum(rB)) ? rA : rB;
    let sel = regs;
    if (localPt) {
      const [u, w] = SP.uv3(localPt, P);
      let best = null, bd = Infinity;
      for (const r of regs) {
        if (SP.inRegion(u, w, r)) { best = r; break; }
        const d = SP.regionDist(u, w, r);
        if (d < bd) { bd = d; best = r; }
      }
      sel = best ? [best] : [];
    }
    const needs = SP.connNeeds(prm);
    const a = { P, regs, sel, needs, slices: null, conns: [], feats: null, warn: '' };
    if (prm.type === 'none' || !sel.length) return a;
    a.slices = SP.depthSlices(V, I, P, needs.dA + 0.01, needs.dB + 0.01, eps);
    if (SP.isPointType(prm.type)) {
      a.conns = keepConns || SP.autoPlace(sel, a.slices, needs, prm);
      for (const c of a.conns) Object.assign(c, SP.checkConn(c, sel, a.slices, needs, prm, a.conns));
    } else {
      a.feats = bandFeatures(sel, a.slices);
    }
    return a;
  }
  function bandFeatures(sel, slices) {
    const p = st.prm, box = SP.regionBox(sel);
    const size = Math.max(box[1] - box[0], box[3] - box[2]);
    let res = Math.max(0.03, Math.min(0.1, p.tClear / 2, p.tEdge / 4));
    res = Math.max(res, size / 1400);
    const fd = SP.distanceField([SP.regionSegs(sel), SP.segsFlat(slices.A[0].sl), SP.segsFlat(slices.B[0].sl)], box, res);
    const f = SP.bandConnector(fd, p);
    const gs = p.tSide === 'A' ? 'B' : 'A', depth = p.tHeight + p.tExtra;
    let bad = 0, total = 0;
    for (const g of f[gs]) {
      const pts = g.rings[0].pts, step = Math.max(1, Math.floor(pts.length / 200));
      for (let i = 0; i < pts.length; i += step) {
        total++;
        const c = SP.clearanceAt(slices, pts[i][0], pts[i][1], gs === 'A' ? depth : 0, gs === 'B' ? depth : 0, p.wall * 2);
        if (c < p.wall * 0.98) bad++;
      }
    }
    return { A: f.A, B: f.B, fd, bad, total, empty: !f.A.length || !f.B.length, res, gs };
  }
  // Ringe für den Schnitt aus einer Analyse; zählt Dübel
  function featuresOf(a) {
    const featA = [], featB = [];
    let n = 0, skipped = 0;
    if (SP.isPointType(st.prm.type)) {
      for (const c of a.conns) {
        if (!c.ok) { skipped++; continue; }
        const f = SP.connFeatures(c, st.prm);
        featA.push(...f.A); featB.push(...f.B);
        n++;
      }
    } else if (a.feats && !a.feats.empty) {
      featA.push(...a.feats.A); featB.push(...a.feats.B);
    }
    return { featA, featB, n, skipped };
  }

  function schedule(delay = 80) {
    clearTimeout(timer);
    if (!active) return;
    timer = setTimeout(update, delay);
  }
  function update() {
    const pm = app.getPaint();
    if (!active || !pm) return;
    const P = plane();
    if (!P) { st.pv = null; drawOverlay(); render2D(); info(); return; }
    const t0 = performance.now();
    st.pv = st.curve ? analyseCurve(pm.verts, pm.idx, st.curve, st.manual ? st.conns : null) : analyse(pm.verts, pm.idx, P, st.scope === 'local' ? st.localPt : null, st.manual ? st.conns : null);
    st.conns = st.pv.conns;
    st.pv.ms = performance.now() - t0;
    drawOverlay();
    render2D();
    info();
  }

  // ------------------------------------------------ Darstellung 3D
  function drawOverlay() {
    const pv = st.pv;
    if (!pv || !pv.regs.length) {
      setObj('quad', st.base ? planeQuad(plane(), modelBoxOnPlane(plane())) : null);
      for (const k of ['sel', 'other', 'conn', 'arrow']) setObj(k, null);
      drawPlan();
      return;
    }
    const P = pv.P, show = pv.sel.length ? pv.sel : pv.regs;
    const ring = (r) => [r.outer, ...r.holes];
    const lift = (u, w) => (pv.curve ? pv.curve.field.at(u, w) + 0.03 : 0.02);
    if (pv.curve) {
      setObj('quad', null);
      const pm = app.getPaint(), ids = pv.curve.ids;
      setObj('sel', segObj(ids.map((v, i) => { const q = ids[(i + 1) % ids.length]; return [[pm.verts[3 * v], pm.verts[3 * v + 1], pm.verts[3 * v + 2]], [pm.verts[3 * q], pm.verts[3 * q + 1], pm.verts[3 * q + 2]]]; }).flat(), 0xfacc15));
      setObj('other', null);
    } else {
      setObj('quad', planeQuad(P, SP.regionBox(pv.regs)));
      setObj('sel', segObj(loopPairs(P, pv.sel.flatMap(ring)), 0xfacc15));
      setObj('other', segObj(loopPairs(P, pv.regs.filter((r) => !pv.sel.includes(r)).flatMap(ring)), 0x9aa1ad, 0.6));
    }
    // Verbinder
    const good = [], bad = [];
    if (SP.isPointType(st.prm.type)) {
      for (const c of pv.conns) {
        const pts = SP.polyPts(c.u, c.w, pv.needs.rMax, st.prm.type === 'magnet' ? 'round' : st.prm.shape, c.rot || 0);
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) (c.ok ? good : bad).push(world(P, pts[j][0], pts[j][1], lift(pts[j][0], pts[j][1])), world(P, pts[i][0], pts[i][1], lift(pts[i][0], pts[i][1])));
      }
    } else if (pv.feats) {
      const t = pv.feats[st.prm.tSide];
      good.push(...loopPairs(P, t.map((f) => f.rings[0].pts), 0.02));
    }
    const g = new THREE.Group();
    const og = segObj(good, 0x22c55e), ob = segObj(bad, 0xef4444);
    if (og) g.add(og);
    if (ob) g.add(ob);
    setObj('conn', g);
    // Pfeil zu Teil 2
    const box = SP.regionBox(show), c = world(P, (box[0] + box[1]) / 2, (box[2] + box[3]) / 2, pv.curve ? lift((box[0] + box[1]) / 2, (box[2] + box[3]) / 2) : 0);
    const L = Math.max(3, 0.25 * Math.max(box[1] - box[0], box[3] - box[2]));
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(...P.N), new THREE.Vector3(...c), L, 0xf97316, L * 0.25, L * 0.14);
    arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } });
    setObj('arrow', arrow);
    drawPlan();
  }
  function modelBoxOnPlane(P) {
    const pm = app.getPaint(), b = pm.bbox;
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
      const [u, w] = SP.uv3(p, P);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
    }
    return [u0, u1, w0, w1];
  }
  function drawPlan() {
    if (st.mode !== 'auto' || !st.plan || !st.plan.length) { setObj('plan', null); return; }
    const g = new THREE.Group();
    for (const p of st.plan) { const P = SP.makePlane(p.O, p.N); g.add(planeQuad(P, modelBoxOnPlane(P), 0xf59e0b)); }
    setObj('plan', g);
  }
  function drawPts() {
    if (st.mode !== 'pts' || !st.pts.length) { setObj('pts', null); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(st.pts.flat()), 3));
    setObj('pts', new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf97316, size: 10, sizeAttenuation: false, depthTest: false, transparent: true })));
  }

  // ------------------------------------------------ Schnittansicht 2D (Verbinder setzen/verschieben)
  const cv = $('spCanvas');
  function render2D() {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 280, H = cv.clientHeight || 220;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const pv = st.pv;
    view = null;
    g.fillStyle = '#9aa1ad';
    g.font = '12px system-ui, sans-serif';
    if (!app.getPaint()) { g.fillText('Kein Modell geladen.', 10, 20); return; }
    if (!pv) { g.fillText(st.mode === 'auto' ? 'Bauraum-Modus: siehe unten.' : 'Noch keine Ebene: auf das Modell klicken.', 10, 20); return; }
    if (!pv.regs.length) { g.fillText('Die Ebene schneidet das Modell nicht.', 10, 20); return; }
    const show = pv.sel.length ? pv.sel : pv.regs;
    const box = SP.regionBox(show);
    const bw = Math.max(1e-3, box[1] - box[0]), bh = Math.max(1e-3, box[3] - box[2]);
    const s = Math.min((W - 24) / bw, (H - 24) / bh);
    const cu = (box[0] + box[1]) / 2, cw = (box[2] + box[3]) / 2;
    view = { s, cu, cw, W, H };
    const X = (u) => W / 2 + (u - cu) * s, Y = (w) => H / 2 - (w - cw) * s;
    const path = (r) => {
      g.beginPath();
      for (const L of [r.outer, ...r.holes]) { L.forEach(([u, w], i) => (i ? g.lineTo(X(u), Y(w)) : g.moveTo(X(u), Y(w)))); g.closePath(); }
    };
    for (const r of pv.regs) {
      const on = pv.sel.includes(r);
      path(r);
      g.fillStyle = on ? '#3a4352' : '#262a32';
      g.fill('evenodd');
      g.strokeStyle = on ? '#facc15' : '#5a6070';
      g.lineWidth = 1.2;
      g.stroke();
    }
    if (pv.feats) {
      const draw = (feats, color, dash) => {
        g.setLineDash(dash);
        g.strokeStyle = color;
        for (const f of feats) { const L = f.rings[0].pts; g.beginPath(); L.forEach(([u, w], i) => (i ? g.lineTo(X(u), Y(w)) : g.moveTo(X(u), Y(w)))); g.closePath(); g.stroke(); }
        g.setLineDash([]);
      };
      draw(pv.feats[pv.feats.gs], '#f97316', [4, 3]);
      draw(pv.feats[st.prm.tSide], '#22c55e', []);
    }
    if (SP.isPointType(st.prm.type)) {
      const r = pv.needs.rMax * s;
      pv.conns.forEach((c, i) => {
        g.beginPath();
        g.arc(X(c.u), Y(c.w), Math.max(3, r), 0, Math.PI * 2);
        g.fillStyle = c.ok ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.45)';
        g.fill();
        g.strokeStyle = c.ok ? '#22c55e' : '#ef4444';
        g.lineWidth = drag && drag.c === c ? 2.5 : 1.5;
        g.stroke();
        g.fillStyle = '#e3e6eb';
        g.fillText(String(i + 1), X(c.u) + Math.max(3, r) + 2, Y(c.w) - 2);
      });
    }
    // Maßstab
    const target = 60 / s, pow = Math.pow(10, Math.floor(Math.log10(target)));
    const len = [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= target * 0.6) || pow;
    g.strokeStyle = '#9aa1ad';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(10, H - 10); g.lineTo(10 + len * s, H - 10); g.stroke();
    g.fillStyle = '#9aa1ad';
    g.fillText(`${String(+len.toPrecision(3)).replace('.', ',')} mm`, 14 + len * s, H - 6);
  }
  const toUV = (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return [view.cu + (x - view.W / 2) / view.s, view.cw - (y - view.H / 2) / view.s];
  };
  function connAt(u, w) {
    const pv = st.pv;
    if (!pv) return null;
    const R = Math.max(pv.needs.rMax, 6 / view.s);
    let best = null, bd = R;
    for (const c of pv.conns) { const d = Math.hypot(c.u - u, c.w - w); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function recheck() {
    const pv = st.pv;
    for (const c of pv.conns) Object.assign(c, SP.checkConn(c, pv.sel, pv.slices, pv.needs, st.prm, pv.conns));
  }
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (!view || !st.pv || !SP.isPointType(st.prm.type) || !st.pv.slices) return;
    const [u, w] = toUV(e), c = connAt(u, w);
    if (e.button === 2) {
      if (c) { st.pv.conns.splice(st.pv.conns.indexOf(c), 1); st.manual = true; recheck(); drawOverlay(); render2D(); info(); }
      return;
    }
    if (e.button !== 0) return;
    st.manual = true;
    if (c) drag = { c, du: c.u - u, dw: c.w - w };
    else if (st.pv.sel.some((r) => SP.inRegion(u, w, r))) {
      const n = { u, w, rot: 0 };
      st.pv.conns.push(n);
      drag = { c: n, du: 0, dw: 0 };
      recheck(); render2D(); info();
    }
    if (drag) cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!view || !st.pv) return;
    const [u, w] = toUV(e);
    if (drag) {
      drag.c.u = u + drag.du; drag.c.w = w + drag.dw;
      recheck(); render2D();
      return;
    }
    const c = connAt(u, w);
    cv.title = c ? (c.ok ? 'Verbinder in Ordnung · ziehen = verschieben · Rechtsklick = entfernen' : 'Problem: ' + c.why) : '';
    cv.style.cursor = c ? 'grab' : 'crosshair';
  });
  cv.addEventListener('pointerup', () => { if (drag) { drag = null; drawOverlay(); render2D(); info(); } });

  // ------------------------------------------------ Texte
  function info() {
    const pv = st.pv, fmt = app.fmtMm;
    let t = '';
    if (pv && pv.regs.length) {
      const area = pv.sel.reduce((s, r) => s + r.area, 0);
      t = `Schnittfläche: ${pv.sel.length} von ${pv.regs.length} Stück${pv.regs.length === 1 ? '' : 'en'}, ${fmt(area)} mm²`;
      if (st.scope === 'local' && pv.regs.length > pv.sel.length) t += ' (nur die gelbe wird geschnitten)';
      t += '.';
    }
    if (st.edgeInfo && (st.mode === 'edge')) t = st.edgeInfo + (t ? ' ' + t : '');
    if (pv && pv.curve) {
      const fr = pv.curve.fr;
      t = `Schnitt folgt der Grenze (Höhenunterschied ${app.fmtMm(fr.hmax - fr.hmin)} mm), Schnittfläche ${app.fmtMm(fr.area)} mm², glatt gewölbt. Beide Teile passen genau aufeinander.`;
    }
    if (st.planeInfo) t = st.planeInfo + (t ? ' ' + t : '');
    $('spPlaneInfo').textContent = t;
    let c = '';
    const type = st.prm.type;
    if (pv && pv.unsupported) c = 'Nut & Feder und Falz gehen nur bei ebenen Schnitten. Für die gekrümmte Schnittfläche Dübel, Zapfen, Magnete oder Bohrungen wählen.';
    else if (pv && pv.sel.length && type !== 'none') {
      if (SP.isPointType(type)) {
        const okN = pv.conns.filter((x) => x.ok).length, badL = pv.conns.filter((x) => !x.ok);
        c = pv.conns.length ? `${pv.conns.length} Verbinder` + (badL.length ? `, ${badL.length} mit Problem (werden weggelassen): ${[...new Set(badL.map((x) => x.why))].join('; ')}` : ', alle in Ordnung') : 'Kein Platz für Verbinder mit diesen Maßen. Kleiner wählen oder Mindestwand verringern.';
        if (type === 'dowel' && okN) c += `. Dazu werden ${okN} Dübel Ø ${fmt(st.prm.d)} × ${fmt(st.prm.len)} mm erzeugt.`;
        if (st.manual) c += ' (von Hand gesetzt)';
      } else if (pv.feats) {
        const f = pv.feats;
        c = f.empty ? 'Die Fläche ist zu schmal für diese Maße (Abstand vom Rand + Breite).'
          : `${type === 'tongue' ? 'Feder' : 'Absatz'} an Teil ${st.prm.tSide === 'A' ? 1 : 2}, Nut an Teil ${st.prm.tSide === 'A' ? 2 : 1}.` +
            (f.bad ? ` Achtung: Die Nut kommt der Außenwand näher als ${fmt(st.prm.wall)} mm (${f.bad} von ${f.total} geprüften Stellen).` : ' Wandstärke überall ausreichend.');
      }
    }
    $('spConnInfo').textContent = c;
    $('spDo').disabled = !(pv && pv.sel.length) && !(st.mode === 'auto' && st.plan && st.plan.length);
    $('spDo').textContent = st.mode === 'auto' ? `${st.plan ? st.plan.length : 0} Schnitte ausführen` : rep() > 1 ? `${rep()}× teilen` : 'Teilen';
  }
  const rep = () => (st.mode === 'axis' ? Math.max(1, Math.round(+$('spRepeat').value || 1)) : 1);

  // ------------------------------------------------ Teilen
  function majoritySlot(pm) {
    const c = pm.counts();
    let b = 0;
    for (let i = 1; i < c.length; i++) if (c[i] > c[b]) b = i;
    return b;
  }
  function addDowels(V, I, C, count, slot) {
    if (!count) return;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    for (let i = 0; i < V.length; i += 3) { x0 = Math.min(x0, V[i]); y0 = Math.min(y0, V[i + 1]); z0 = Math.min(z0, V[i + 2]); }
    const d = SP.dowelMesh(st.prm);
    let mx = Infinity, Mx = -Infinity, my = Infinity, My = -Infinity, mz = Infinity;
    for (let i = 0; i < d.V.length; i += 3) { mx = Math.min(mx, d.V[i]); Mx = Math.max(Mx, d.V[i]); my = Math.min(my, d.V[i + 1]); My = Math.max(My, d.V[i + 1]); mz = Math.min(mz, d.V[i + 2]); }
    const step = My - my + 4;
    for (let k = 0; k < count; k++) {
      const off = V.length / 3, dx = x0 - mx, dy = y0 - 10 - (My - my) - k * step - my, dz = z0 - mz;
      for (let i = 0; i < d.V.length; i += 3) V.push(d.V[i] + dx, d.V[i + 1] + dy, d.V[i + 2] + dz);
      for (const i of d.I) I.push(i + off);
      for (let t = 0; t < d.I.length / 3; t++) C.push(slot);
    }
  }
  function capSlot() { return +$('spCapSlot').value; }
  function doSplit() {
    const pm = app.getPaint();
    if (!pm) return;
    if (st.mode === 'auto') { runPlan(st.plan); return; }
    if (rep() > 1) {
      const P = plane(), gap = +$('spRepeatGap').value || 0;
      if (!P || !(gap > 0)) { app.toast('Für mehrere Schnitte einen Abstand > 0 angeben.'); return; }
      runPlan(Array.from({ length: rep() }, (_, i) => ({ O: P.O.map((x, k) => x + i * gap * P.N[k]), N: P.N })));
      return;
    }
    if (st.curve) { splitCurve(); return; }
    app.withBusy('Teile …', () => {
      const P = plane();
      const a = analyse(pm.verts, pm.idx, P, st.scope === 'local' ? st.localPt : null, st.manual ? st.conns : null);
      if (!a.sel.length) { app.toast('Keine Schnittfläche getroffen.'); return; }
      if (a.feats && a.feats.empty && st.prm.type !== 'none') { app.toast('Nut & Feder passt nicht auf diese Schnittfläche – Maße verkleinern.'); return; }
      const f = featuresOf(a);
      const gap = Math.max(0.1, +$('spGap').value || 0);
      app.snapshot(true);
      const r = SP.cutMesh(pm.verts, pm.idx, pm.col, P, { snap: st.snap, localPts: st.scope === 'local' && st.localPt ? [st.localPt] : null, featA: f.featA, featB: f.featB, capSlot: capSlot(), gap });
      if (r.error) { app.dropSnapshot(); app.toast(r.error); return; }
      if (r.notSeparated) { app.dropSnapshot(); app.toast('Der Schnitt trennt das Teil nicht in zwei Stücke (z. B. bei einem Ring). „Ganze Ebene“ wählen oder an zwei Stellen schneiden.', 7000); return; }
      const before = app.partCount();
      if (st.prm.type === 'dowel') addDowels(r.V, r.I, r.C, f.n, capSlot() >= 0 ? capSlot() : majoritySlot(pm));
      app.applyGeometry(SP.toPos(r.V, r.I), Uint8Array.from(r.C));
      const after = app.partCount();
      let msg = `Geteilt: ${before} → ${after} Teile`;
      if (f.n) msg += ` · ${f.n} Verbinder` + (st.prm.type === 'dowel' ? ` + ${f.n} Dübel (neben dem Modell)` : '');
      if (f.skipped) msg += ` · ${f.skipped} ungültige weggelassen`;
      if (r.coplanar) msg += ' · Absatz in der Schnittebene berücksichtigt';
      app.toast(msg, 6000);
      st.base = null; st.pts = []; st.conns = []; st.manual = false; st.edgeInfo = ''; st.planeInfo = '';
      if (st.mode === 'region') clearRegion();
      drawPts();
      schedule(0);
    });
  }
  function splitCurve() {
    const pm = app.getPaint();
    app.withBusy('Teile entlang der Grenze …', () => {
      const a = analyseCurve(pm.verts, pm.idx, st.curve, st.manual ? st.conns : null);
      if (a.unsupported) { app.toast('Nut & Feder und Falz gehen nur bei ebenen Schnitten.'); return; }
      const f = featuresOf(a);
      const gap = Math.max(0.1, +$('spGap').value || 0);
      app.snapshot(true);
      const r = SP.cutAlongLoop(pm, st.curve.ids, st.curve.N, { featA: f.featA, featB: f.featB, capSlot: capSlot(), gap });
      if (r.error) { app.dropSnapshot(); app.toast(r.error, 6000); return; }
      const before = app.partCount();
      if (st.prm.type === 'dowel') addDowels(r.V, r.I, r.C, f.n, capSlot() >= 0 ? capSlot() : majoritySlot(pm));
      app.applyGeometry(SP.toPos(r.V, r.I), Uint8Array.from(r.C));
      let msg = `Entlang der Grenze geteilt: ${before} → ${app.partCount()} Teile`;
      if (f.n) msg += ` · ${f.n} Verbinder` + (st.prm.type === 'dowel' ? ` + ${f.n} Dübel` : '');
      if (f.skipped) msg += ` · ${f.skipped} ungültige weggelassen`;
      app.toast(msg, 6000);
      clearRegion();
      schedule(0);
    });
  }

  // ------------------------------------------------ Bereich auswählen
  const regAng = () => +$('spRegAng').value;
  function selList() {
    const s2 = st.region.sel, out = [];
    if (s2) for (let t = 0; t < s2.length; t++) if (s2[t]) out.push(t);
    return out;
  }
  function showSel() { app.highlight(active && st.mode === 'region' ? selList() : []); }
  function clearRegion() {
    st.region = { sel: null, loops: [], li: -1 };
    st.curve = null;
    st.conns = []; st.manual = false;
    renderLoops();
    showSel();
  }
  function regionClick(pm, t, hp, e) {
    const R = st.region;
    if (!R.sel || R.sel.length !== pm.n) R.sel = new Uint8Array(pm.n);
    if (e && (e.ctrlKey || e.metaKey)) SP.smoothRegion(pm, t, regAng(), R.sel, 0);
    else {
      if (!(e && e.shiftKey)) R.sel.fill(0);
      SP.smoothRegion(pm, t, regAng(), R.sel, 1);
    }
    R.loops = SP.selectionLoops(pm, R.sel).sort((a, b) => b.len - a.len);
    // Grenze nahe am Klick vorwählen
    let best = -1, bd = Infinity;
    R.loops.forEach((L, i) => { for (const p of L.pts) { const d = Math.hypot(p[0] - hp[0], p[1] - hp[1], p[2] - hp[2]); if (d < bd) { bd = d; best = i; } } });
    R.li = best;
    showSel();
    renderLoops();
    applyLoop();
  }
  function loopDir(L) {
    const m = $('spDir').value;
    if (m === 'z') return [0, 0, 1];
    if (m === 'view') return camDir();
    return L.dir;
  }
  function applyLoop() {
    const pm = app.getPaint(), R = st.region, L = R.loops[R.li];
    st.conns = []; st.manual = false;
    if (!pm || !L) { st.curve = null; st.base = null; schedule(0); return; }
    const form = $('spForm').value, N = loopDir(L);
    st.planeInfo = '';
    if (form === 'curve') {
      const fr = SP.loopFrame(pm, L.ids, N);
      if (!fr.simple || Math.abs(fr.area) < 1e-6) {
        st.curve = null;
        st.planeInfo = 'Diese Grenze lässt sich in der gewählten Richtung nicht als Fläche abbilden – andere Richtung oder eben schneiden.';
        st.base = null;
        syncTune(); schedule(0);
        return;
      }
      st.curve = { ids: L.ids, N, fr, field: SP.heightField(fr) };
      st.base = null;
    } else {
      st.curve = null;
      // Richtung wie beim gekrümmten Schnitt: von der Auswahl (Teil 1) weg
      const n = SP.loopFrame(pm, L.ids, N).P.N;
      const c = [0, 1, 2].map((k) => L.pts.reduce((s2, p) => s2 + p[k], 0) / L.pts.length);
      const sv = L.pts.map((p) => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]);
      const lo = Math.min(...sv), hi = Math.max(...sv), m = Math.max(0, +$('spMargin').value || 0);
      // „innerhalb“ = auf der Seite der Auswahl, „außerhalb“ = jenseits der Grenze
      const s0 = form === 'below' ? lo - m : form === 'above' ? hi + m : (lo + hi) / 2;
      const O = c.map((x, k) => x + s0 * n[k]);
      st.base = { O, N: n };
      st.offset = 0; st.tiltU = 0; st.tiltW = 0; st.flip = false;
      st.scope = 'local'; st.localPt = O;
    }
    syncTune();
    syncMode();
    schedule(0);
  }
  function renderLoops() {
    const el = $('spLoops'), R = st.region, pm = app.getPaint();
    if (!R.loops.length) { el.innerHTML = '<p class="note">Noch keine Auswahl.</p>'; return; }
    el.innerHTML = R.loops.map((L, i) => {
      const d = L.dir, sv = L.pts.map((p) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2]), range = Math.max(...sv) - Math.min(...sv);
      const kind = L.fit.dev < 0.01 ? 'eben' : `geschwungen, ${app.fmtMm(range)} mm Höhenunterschied`;
      return `<label class="check"><input type="radio" name="spLoop" value="${i}"${i === R.li ? ' checked' : ''}> Grenze ${i + 1}: ${app.fmtMm(L.len)} mm lang, ${kind}</label>`;
    }).join('');
    el.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => { R.li = +r.value; applyLoop(); }));
    el.querySelectorAll('label').forEach((lab, i) => {
      lab.addEventListener('mouseenter', () => { const L = R.loops[i]; setObj('edge', segObj(L.pts.map((p, k) => [p, L.pts[(k + 1) % L.pts.length]]), 0x22d3ee)); });
      lab.addEventListener('mouseleave', () => setObj('edge', null));
    });
    void pm;
  }

  // Mehrere Schnitte nacheinander (Bauraum, Wiederholen); die Teile werden danach je Schnitt auseinandergezogen
  function runPlan(planes) {
    const pm = app.getPaint();
    if (!pm || !planes || !planes.length) return;
    app.withBusy(`${planes.length} Schnitte …`, () => {
      let V = Array.from(pm.verts), I = Array.from(pm.idx), C = Array.from(pm.col);
      let done = 0, conns = 0, dowels = 0, skipped = 0;
      const used = [];
      for (const p of planes) {
        const P = SP.makePlane(p.O, p.N);
        const a = analyse(V, I, P, null, null);
        if (!a.sel.length) continue;
        const f = featuresOf(a);
        const r = SP.cutMesh(V, I, C, P, { snap: st.snap, featA: f.featA, featB: f.featB, capSlot: capSlot(), gap: 0 });
        if (r.error || r.notSeparated) continue;
        V = r.V; I = r.I; C = r.C;
        done++; conns += f.n; skipped += f.skipped;
        if (st.prm.type === 'dowel') dowels += f.n;
        used.push(P);
      }
      if (!done) { app.toast('Kein Schnitt möglich.'); return; }
      // auseinanderziehen: je Teil um gap entlang jeder Ebene, auf deren Seite 2 es liegt
      const gap = Math.max(0.1, +$('spGap').value || 0);
      const comp = SP.triComponents(I, V.length / 3);
      const cen = Array.from({ length: comp.count }, () => [0, 0, 0, 0]);
      for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const v = I[3 * t + k], c = cen[comp.id[t]]; c[0] += V[3 * v]; c[1] += V[3 * v + 1]; c[2] += V[3 * v + 2]; c[3]++; }
      const shift = cen.map((c) => {
        const p = [c[0] / c[3], c[1] / c[3], c[2] / c[3]], s = [0, 0, 0];
        for (const P of used) if ((p[0] - P.O[0]) * P.N[0] + (p[1] - P.O[1]) * P.N[1] + (p[2] - P.O[2]) * P.N[2] > 0) for (let k = 0; k < 3; k++) s[k] += gap * P.N[k];
        return s;
      });
      const moved = new Uint8Array(V.length / 3);
      for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) {
        const v = I[3 * t + k];
        if (moved[v]) continue;
        moved[v] = 1;
        const s = shift[comp.id[t]];
        V[3 * v] += s[0]; V[3 * v + 1] += s[1]; V[3 * v + 2] += s[2];
      }
      app.snapshot(true);
      const before = app.partCount();
      addDowels(V, I, C, dowels, capSlot() >= 0 ? capSlot() : majoritySlot(pm));
      app.applyGeometry(SP.toPos(V, I), Uint8Array.from(C));
      app.toast(`${done} Schnitte: ${before} → ${app.partCount()} Teile` + (conns ? ` · ${conns} Verbinder` : '') + (dowels ? ` + ${dowels} Dübel` : '') + (skipped ? ` · ${skipped} ungültige weggelassen` : ''), 6000);
      st.base = null; st.plan = null; st.conns = []; st.manual = false;
      schedule(0);
    });
  }

  // ------------------------------------------------ Bauraum
  const bed = () => [+$('spBedX').value || 250, +$('spBedY').value || 250, +$('spBedZ').value || 250];
  function sectionArea(V, I, P) {
    const sl = SP.slice(V, I, P, 0);
    let a = 0;
    for (let i = 0; i < sl.segs.length; i += 2) { const p = sl.segs[i], q = sl.segs[i + 1]; a += sl.pts[2 * p] * sl.pts[2 * q + 1] - sl.pts[2 * q] * sl.pts[2 * p + 1]; }
    return Math.abs(a / 2);
  }
  function planAuto() {
    const pm = app.getPaint();
    if (!pm) return;
    const B = bed(), margin = Math.max(0, +$('spBedMargin').value || 0), thin = $('spThin').checked, b = pm.bbox;
    const O = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
    const plan = [];
    for (let k = 0; k < 3; k++) {
      const size = b.max[k] - b.min[k], lim = Math.max(1, B[k] - margin);
      const n = Math.ceil(size / lim - 1e-9);
      for (let i = 1; i < n; i++) {
        let pos = b.min[k] + (i * size) / n;
        const N = [0, 0, 0];
        N[k] = 1;
        if (thin) {
          const slack = Math.max(0, lim - size / n) * 0.95;
          let best = Infinity;
          for (let j = 0; j <= 16; j++) {
            const p = b.min[k] + (i * size) / n - slack / 2 + (slack * j) / 16, o = O.slice();
            o[k] = p;
            const a = sectionArea(pm.verts, pm.idx, SP.makePlane(o, N));
            if (a > 0 && a < best) { best = a; pos = p; }
          }
        }
        const o = O.slice();
        o[k] = pos;
        plan.push({ O: o, N, axis: 'XYZ'[k], pos });
      }
    }
    st.plan = plan;
    $('spPlanInfo').textContent = plan.length
      ? `${plan.length} Schnitt${plan.length > 1 ? 'e' : ''}: ` + plan.map((p) => `${p.axis} = ${app.fmtMm(p.pos)}`).join(', ') + ` mm → ca. ${planParts(plan)} Teile.`
      : 'Das Modell passt schon in den Bauraum – kein Schnitt nötig.';
    drawPlan();
    info();
  }
  const planParts = (plan) => ['X', 'Y', 'Z'].reduce((n, a) => n * (plan.filter((p) => p.axis === a).length + 1), 1);

  // ------------------------------------------------ Teileliste, Anordnen, STL-Export
  let partsCache = null;
  function renderParts() {
    const pm = app.getPaint(), el = $('spParts');
    if (!pm) { el.innerHTML = ''; return; }
    const { parts, comp } = SP.partsInfo(pm.verts, pm.idx);
    partsCache = { idx: pm.idx, comp };
    const B = bed(), fmt = app.fmtMm;
    const fits = (s) => s[0] <= B[0] && s[1] <= B[1] && s[2] <= B[2];
    const fitsRot = (s) => { const a = s.slice().sort((x, y) => x - y), c = B.slice().sort((x, y) => x - y); return a[0] <= c[0] && a[1] <= c[1] && a[2] <= c[2]; };
    el.innerHTML = parts.slice(0, 40).map((p, i) => {
      const f = fits(p.size) ? '<span class="ok">passt</span>' : fitsRot(p.size) ? '<span class="warn">passt gedreht</span>' : '<span class="bad">zu groß</span>';
      return `<div class="part" data-i="${i}"><b>${i + 1}</b> ${fmt(p.size[0])} × ${fmt(p.size[1])} × ${fmt(p.size[2])} mm ${f}</div>`;
    }).join('') + (parts.length > 40 ? `<div class="note">… und ${parts.length - 40} weitere</div>` : '');
    $('spPartsHead').textContent = `${parts.length} Teil${parts.length === 1 ? '' : 'e'}`;
    el.querySelectorAll('.part').forEach((d) => {
      d.addEventListener('mouseenter', () => {
        const pm2 = app.getPaint(), k = +d.dataset.i, list = [];
        if (!partsCache || partsCache.idx !== pm2.idx) return;
        for (let t = 0; t < pm2.n; t++) if (partsCache.comp.id[t] === k) list.push(t);
        app.highlight(list);
      });
      d.addEventListener('mouseleave', showSel);
    });
  }
  function arrangeParts(orient) {
    const pm = app.getPaint();
    if (!pm) return;
    app.withBusy(orient ? 'Lege Teile hin …' : 'Ordne an …', () => {
      const B = bed();
      app.snapshot(true);
      const r = SP.arrange(Array.from(pm.verts), Array.from(pm.idx), { bed: [B[0], B[1]], spacing: Math.max(1, +$('spSpacing').value || 6), orient });
      app.applyGeometry(SP.toPos(r.V, Array.from(pm.idx)), pm.col.slice(), true);
      const over = r.layout[0] > B[0] || r.layout[1] > B[1];
      app.toast(`${r.parts.length} Teile angeordnet: ${app.fmtMm(r.layout[0])} × ${app.fmtMm(r.layout[1])} mm` + (over ? ' – größer als das Druckbett, im Slicer auf mehrere Platten verteilen.' : '.'), 6000);
    });
  }
  async function exportStlZip() {
    const pm = app.getPaint();
    if (!pm) return;
    await app.withBusy('Exportiere STL …', async () => {
      const { comp } = SP.partsInfo(pm.verts, pm.idx), lists = Array.from({ length: comp.count }, () => []);
      for (let t = 0; t < pm.n; t++) lists[comp.id[t]].push(t);
      const files = lists.map((l, i) => {
        const pos = new Float32Array(l.length * 9);
        l.forEach((t, k) => pos.set(pm.pos.subarray(9 * t, 9 * t + 9), 9 * k));
        return { name: `${app.modelName()}_Teil_${String(i + 1).padStart(2, '0')}.stl`, data: new Uint8Array(IO.writeSTL(pos)) };
      });
      app.download(await IO.makeZip(files), `${app.modelName()}_Teile.zip`);
      app.toast(`${files.length} STL-Dateien als ZIP gespeichert.`);
    });
  }

  // ------------------------------------------------ Bedienelemente
  function syncMode() {
    document.querySelectorAll('#spMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === st.mode));
    document.querySelectorAll('.spm').forEach((d) => (d.hidden = d.dataset.m !== st.mode));
    $('spModeNote').textContent = MODE_NOTES[st.mode];
    $('spTune').hidden = st.mode === 'auto' || !!st.curve;
    drawPts(); drawPlan();
  }
  function syncAxis() {
    const pm = app.getPaint(), s = $('spPos');
    if (!pm) return;
    const k = 'xyz'.indexOf(st.axis), b = pm.bbox;
    s.min = b.min[k]; s.max = b.max[k]; s.step = Math.max(0.01, (b.max[k] - b.min[k]) / 1000);
    if (st.axisPos !== null) s.value = st.axisPos;
    $('spPosNum').value = st.axisPos === null ? '' : +st.axisPos.toFixed(2);
  }
  function syncTune() {
    $('spOffset').value = +st.offset.toFixed(2);
    $('spOffsetR').value = st.offset;
    if (app.getPaint()) { const d = diag() / 2; $('spOffsetR').min = -d; $('spOffsetR').max = d; }
    $('spTiltU').value = st.tiltU; $('spTiltW').value = st.tiltW;
    document.querySelectorAll('input[name=spScope]').forEach((r) => { r.checked = r.value === st.scope; });
    $('spScopeLocal').disabled = !st.localPt;
    $('spSnap').value = +st.snap.toFixed(3);
  }
  function syncConn() {
    const t = st.prm.type;
    document.querySelectorAll('#spConnBox [data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(t); });
    for (const el of document.querySelectorAll('#spConnBox [data-p]')) {
      const k = el.dataset.p;
      if (el.type === 'checkbox') el.checked = !!st.prm[k];
      else el.value = st.prm[k];
    }
    $('spConn').value = t;
    $('spEditor').hidden = t === 'none';
  }
  function renderCapSlots() {
    const sel = $('spCapSlot'), prev = sel.value;
    sel.innerHTML = '<option value="-1">wie angrenzend</option>' + app.state.palette.map((p, i) => `<option value="${i}">${i + 1}: ${app.escapeHtml(p.name)}</option>`).join('');
    sel.value = prev !== '' && [...sel.options].some((o) => o.value === prev) ? prev : '-1';
  }

  $('spConn').innerHTML = Object.entries(SP.CONNECTORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('spShape').innerHTML = Object.entries(SP.SHAPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  document.querySelectorAll('#spMode button').forEach((b) => b.addEventListener('click', () => {
    st.mode = b.dataset.m;
    st.edgeInfo = ''; st.planeInfo = '';
    setObj('edge', null);
    if (st.mode !== 'region') { st.curve = null; } else if (st.region.loops.length) applyLoop();
    showSel();
    if (st.mode === 'axis') axisPlane();
    else if (st.mode === 'auto') { st.base = null; planAuto(); schedule(0); }
    else if (st.mode === 'pts') { st.pts = []; }
    syncMode();
    info();
  }));
  $('spAxis').addEventListener('change', (e) => { st.axis = e.target.value; st.axisPos = null; st.base = null; st.localPt = null; axisPlane(); });
  $('spPos').addEventListener('input', (e) => { st.axisPos = +e.target.value; axisPlane(); });
  $('spPosNum').addEventListener('change', (e) => { st.axisPos = +e.target.value; axisPlane(); });
  $('spRepeat').addEventListener('input', info);
  $('spEdgeAng').addEventListener('input', (e) => { $('spEdgeAngOut').textContent = e.target.value + '°'; lastHover = ''; });
  $('spPtsReset').addEventListener('click', () => { st.pts = []; drawPts(); });
  $('spOffsetR').addEventListener('input', (e) => { st.offset = +e.target.value; $('spOffset').value = +st.offset.toFixed(2); schedule(60); });
  $('spOffset').addEventListener('change', (e) => { st.offset = +e.target.value || 0; $('spOffsetR').value = st.offset; schedule(0); });
  $('spTiltU').addEventListener('change', (e) => { st.tiltU = +e.target.value || 0; schedule(0); });
  $('spTiltW').addEventListener('change', (e) => { st.tiltW = +e.target.value || 0; schedule(0); });
  $('spFlip').addEventListener('click', () => { st.flip = !st.flip; st.conns = []; st.manual = false; schedule(0); });
  $('spLook').addEventListener('click', () => {
    const P = plane();
    if (!P) return;
    const pv = st.pv, box = pv && pv.regs.length ? SP.regionBox(pv.sel.length ? pv.sel : pv.regs) : [0, 0, 0, 0];
    app.viewAlong(world(P, (box[0] + box[1]) / 2, (box[2] + box[3]) / 2), P.N.map((x) => -x));
  });
  document.querySelectorAll('input[name=spScope]').forEach((r) => r.addEventListener('change', (e) => { st.scope = e.target.value; st.manual = false; schedule(0); }));
  $('spSnap').addEventListener('change', (e) => { st.snap = Math.max(0, +e.target.value || 0); schedule(0); });
  $('spConn').addEventListener('change', (e) => { st.prm.type = e.target.value; st.conns = []; st.manual = false; syncConn(); schedule(0); });
  for (const el of document.querySelectorAll('#spConnBox [data-p]')) {
    const k = el.dataset.p;
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      st.prm[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && isNaN(+el.value) ? el.value : +el.value;
      if (k === 'count') st.manual = false;
      schedule(SP.isRegionType(st.prm.type) ? 250 : 120);
    });
  }
  $('spAuto').addEventListener('click', () => { st.manual = false; schedule(0); });
  $('spClear').addEventListener('click', () => { st.manual = true; st.conns = []; schedule(0); });
  $('spDo').addEventListener('click', doSplit);
  $('spRegAng').addEventListener('input', (e) => { $('spRegAngOut').textContent = e.target.value + '°'; });
  $('spRegAngOut').textContent = $('spRegAng').value + '°';
  ['spForm', 'spDir'].forEach((id) => $(id).addEventListener('change', () => { $('spMarginRow').hidden = $('spForm').value === 'curve' || $('spForm').value === 'mid'; applyLoop(); }));
  $('spMargin').addEventListener('change', applyLoop);
  $('spRegClear').addEventListener('click', () => { clearRegion(); schedule(0); });
  $('spMarginRow').hidden = true;
  $('spPlan').addEventListener('click', planAuto);
  ['spBedX', 'spBedY', 'spBedZ'].forEach((id) => $(id).addEventListener('change', () => { renderParts(); if (st.mode === 'auto') planAuto(); }));
  $('spArrange').addEventListener('click', () => arrangeParts(true));
  $('spArrangeOnly').addEventListener('click', () => arrangeParts(false));
  $('spStl').addEventListener('click', exportStlZip);
  $('spEdgeAngOut').textContent = $('spEdgeAng').value + '°';
  new ResizeObserver(() => { if (active) render2D(); }).observe(cv);

  // ------------------------------------------------ Schnittstelle zu main.js
  function click(t, x, y, e) {
    const pm = app.getPaint();
    if (!pm || t < 0) return;
    const hp = app.hitPoint(t, x, y).toArray();
    st.planeInfo = '';
    switch (st.mode) {
      case 'region':
        regionClick(pm, t, hp, e);
        break;
      case 'axis': {
        st.axisPos = hp['xyz'.indexOf(st.axis)];
        st.localPt = hp;
        axisPlane();
        break;
      }
      case 'edge': {
        const L = edgeAt(pm, t, hp);
        if (!L) { app.toast('Keine Kante in der Nähe gefunden – näher an die Kante klicken oder den Kantenwinkel verringern.'); return; }
        setEdgePlane(L);
        setObj('edge', segObj(L.pts.map((p, i) => [p, L.pts[(i + 1) % L.pts.length]]).slice(0, L.closed ? L.pts.length : L.pts.length - 1), 0x22d3ee));
        break;
      }
      case 'thin': {
        app.withBusy('Suche den kleinsten Querschnitt …', () => {
          const r = SP.minSectionPlane(pm, t, hp, surfNormal(pm, t, hp));
          if (!r) { app.toast('Hier lässt sich kein Querschnitt bestimmen (Netz offen?).'); return; }
          setBase({ O: hp, N: r.N }, 'local', hp);
          st.planeInfo = `Kleinster Querschnitt: ${app.fmtMm(r.area)} mm².`;
          info();
        });
        break;
      }
      case 'face': {
        const n = surfNormal(pm, t, hp);
        setBase({ O: hp, N: n.map((v) => -v) }, 'all', hp);
        break;
      }
      case 'pts': {
        if (st.pts.length >= 3) st.pts = [];
        st.pts.push(hp);
        drawPts();
        if (st.pts.length === 3) {
          const [a, b, c] = st.pts, u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
          const N = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...N);
          if (l < 1e-9) { app.toast('Die drei Punkte liegen auf einer Linie.'); st.pts = []; drawPts(); return; }
          setBase({ O: [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3), N: N.map((v) => v / l) }, 'all', a);
        } else {
          $('spPlaneInfo').textContent = `Punkt ${st.pts.length} von 3 gesetzt.`;
        }
        break;
      }
    }
  }
  function hover(t, x, y) {
    if (st.mode !== 'edge') return;
    const pm = app.getPaint();
    if (!pm || t < 0) { if (lastHover) { lastHover = ''; if (!st.base) setObj('edge', null); } return; }
    const hp = app.hitPoint(t, x, y).toArray();
    const key = t + '|' + $('spEdgeAng').value;
    if (key === lastHover) return;
    lastHover = key;
    const L = edgeAt(pm, t, hp);
    setObj('edge', L ? segObj(L.pts.map((p, i) => [p, L.pts[(i + 1) % L.pts.length]]).slice(0, L.closed ? L.pts.length : L.pts.length - 1), 0x22d3ee) : null);
  }
  function setActive(on) {
    active = on;
    grp.visible = on;
    if (on) {
      renderCapSlots();
      syncMode(); syncConn(); syncTune();
      if (st.mode === 'axis' && !st.base) axisPlane();
      renderParts();
      renderLoops();
      showSel();
      schedule(0);
    }
    app.requestRender();
  }
  function meshChanged() {
    const pm = app.getPaint();
    if (st.region.sel && (!pm || st.region.sel.length !== pm.n)) { st.region = { sel: null, loops: [], li: -1 }; st.curve = null; renderLoops(); }
    if (!active) return;
    lastHover = '';
    syncAxis();
    renderParts();
    schedule(0);
  }
  function escape() {
    if (st.mode === 'region') clearRegion();
    st.base = null; st.pts = []; st.conns = []; st.manual = false; st.edgeInfo = ''; st.planeInfo = '';
    setObj('edge', null);
    drawPts();
    schedule(0);
  }
  return { setActive, click, hover, meshChanged, escape, renderCapSlots, state: st, update };
}
