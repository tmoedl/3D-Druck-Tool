import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PaintMesh, TEX_W, concatPos } from './mesh.js';
import * as IO from './io.js';
import * as IMG from './image.js';
import { Cutter, pointInPolygon, gridContours } from './cut.js';
import * as GRAD from './gradient.js';
import { initLogo } from './logoui.js';
import { initSplit } from './splitui.js';
import { triComponents } from './split.js';
import { initMap } from './mapui.js';
import * as PRJ from './project.js';
import { initPrintRender } from './printrender.js';

const $ = (id) => document.getElementById(id);
const MAX_SLOTS = 16;
const DEFAULT_COLORS = [
  ['Weiß', '#f2f2f2'], ['Schwarz', '#222222'], ['Rot', '#d62828'], ['Blau', '#1d4ed8'],
  ['Gelb', '#f7c600'], ['Grün', '#2a9d3f'], ['Orange', '#f77f00'], ['Lila', '#8e44ad'],
  ['Grau', '#8d8d8d'], ['Braun', '#8a5a33'], ['Hellblau', '#7cc0f0'], ['Pink', '#ec6fb0'],
  ['Dunkelgrün', '#2f6b35'], ['Beige', '#e3cf9a'], ['Türkis', '#1fb5a8'], ['Dunkelgrau', '#4b4b4e'],
];
const COLOR_NAMES = [
  ['Weiß', [245, 245, 245]], ['Schwarz', [20, 20, 20]], ['Grau', [128, 128, 128]], ['Dunkelgrau', [75, 75, 78]], ['Hellgrau', [195, 195, 195]],
  ['Rot', [210, 30, 30]], ['Dunkelrot', [120, 15, 20]], ['Orange', [245, 130, 20]], ['Gelb', [245, 210, 20]],
  ['Grün', [40, 160, 60]], ['Dunkelgrün', [20, 80, 35]], ['Hellgrün', [140, 210, 90]], ['Blau', [30, 70, 210]],
  ['Hellblau', [100, 170, 235]], ['Dunkelblau', [20, 30, 100]], ['Türkis', [30, 180, 180]], ['Lila', [130, 60, 170]],
  ['Pink', [240, 110, 170]], ['Braun', [120, 75, 40]], ['Beige', [225, 205, 165]], ['Gold', [200, 160, 60]],
];

const state = {
  tool: 'brush',
  slot: 1,
  palette: DEFAULT_COLORS.slice(0, 4).map(([name, color]) => ({ name, color })),
  brushR: 3,
  fillAngle: 30,
  fillRel: false,
  fillSame: true,
  rectVis: true,
  heightBelow: false,
  modelName: 'Modell',
  loadShift: [0, 0, 0],
  mapProject: null, // Einstellungen des Karten-Studios, falls das Modell eine Karte ist
};

const HINTS = {
  view: 'Links: drehen · Rechts/Mitte: verschieben · Rad: zoomen',
  brush: 'Malen mit gedrückter linker Maustaste · Strg = Filament 1 · [ ] = Pinselgröße · Alt+Klick = Farbe aufnehmen',
  tri: 'Einzelne Dreiecke färben (Klicken oder Ziehen) · Strg = Filament 1',
  fill: 'Klick füllt die zusammenhängende Fläche bis zu Kanten · Vorschau beim Darüberfahren · Strg = Filament 1',
  rect: 'Rechteck aufziehen – alle Flächen darin werden gefärbt · Strg = Filament 1',
  height: 'Klick färbt alles oberhalb der Klickhöhe · Shift = unterhalb',
  pick: 'Klick übernimmt die Farbe der angeklickten Fläche',
  flat: 'Klick auf eine Fläche legt das Modell mit dieser Seite aufs Druckbett',
  shape: 'Exakte Form – unabhängig von den Dreiecken',
  place: 'Bild auf dem Modell positionieren, Klick setzt es (beliebig oft) · [ ] Größe · , . drehen · Esc / „Fertig“ beendet',
  grad: 'Farbverlauf: Einstellungen rechts · Klick setzt die Mitte des Übergangs (bzw. Start/Ende) · Vorschau am Modell',
  split: 'Teilen: Ebene per Klick festlegen (Modus rechts) · Verbinder in der Schnittansicht setzen · Esc verwirft die Ebene',
};
const NAV_HINT = ' · Rechte Maustaste: drehen · Mitte: verschieben · Rad: zoomen · Leertaste+Links: drehen';
const TOOL_NAMES = { shape: 'Form', place: 'Bild platzieren', view: 'Ansicht', brush: 'Pinsel', tri: 'Dreieck', fill: 'Eimer', rect: 'Rechteck', height: 'Höhe', pick: 'Pipette', flat: 'Hinlegen', grad: 'Verlauf', split: 'Teilen' };

// ---------------------------------------------------------------- Rendering
const canvas = $('c'), vp = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e24);
const pickScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
camera.up.set(0, 0, 1);
camera.position.set(160, -220, 170);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 20);
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.update();

// Druckbett
{
  const grid = new THREE.GridHelper(250, 25, 0x5a6475, 0x353b47);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshBasicMaterial({ color: 0x252a33, transparent: true, opacity: 0.7, depthWrite: false }));
  plate.position.z = -0.05;
  plate.renderOrder = -1;
  scene.add(plate);
  const axes = new THREE.AxesHelper(20);
  axes.position.set(-125, -125, 0.05);
  scene.add(axes);
}

const MESH_VS = /* glsl */`
uniform sampler2D colTex;
uniform sampler2D hiTex;
uniform vec3 palette[16];
flat out vec3 vColor;
flat out float vHi;
out vec3 vViewPos;
out vec3 vBary;
void main() {
  int tid = gl_VertexID / 3;
  int c = gl_VertexID - tid * 3;
  ivec2 uv = ivec2(tid % ${TEX_W}, tid / ${TEX_W});
  int s = int(texelFetch(colTex, uv, 0).r * 255.0 + 0.5);
  vHi = texelFetch(hiTex, uv, 0).r;
  vColor = palette[min(s, 15)];
  vBary = vec3(c == 0 ? 1.0 : 0.0, c == 1 ? 1.0 : 0.0, c == 2 ? 1.0 : 0.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const MESH_FS = /* glsl */`
uniform vec3 hiColor;
uniform float wire;
flat in vec3 vColor;
flat in float vHi;
in vec3 vViewPos;
in vec3 vBary;
out vec4 fragColor;
void main() {
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 v = normalize(-vViewPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
  float d = 0.30 + 0.45 * max(dot(n, L), 0.0) + 0.32 * max(dot(n, v), 0.0);
  vec3 c = vColor;
  if (vHi > 0.001) {
    // gestreifte Vorschau – auch sichtbar, wenn die Fläche schon die aktive Farbe hat
    float stripe = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 7.0), 2.0);
    c = mix(hiColor, vec3(1.0) - step(0.5, dot(hiColor, vec3(0.3, 0.59, 0.11))) * vec3(1.0), stripe * 0.35);
  }
  c *= d;
  c += pow(max(dot(reflect(-L, n), v), 0.0), 24.0) * 0.08;
  if (wire > 0.5) {
    vec3 fw = fwidth(vBary);
    vec3 a = smoothstep(vec3(0.0), fw * 1.3, vBary);
    float e = min(min(a.x, a.y), a.z);
    c = mix(c * 0.45, c, e);
  }
  fragColor = vec4(c, 1.0);
}`;
const PICK_VS = /* glsl */`
flat out int vId;
void main() {
  vId = gl_VertexID / 3 + 1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PICK_FS = /* glsl */`
flat in int vId;
out vec4 fragColor;
void main() {
  fragColor = vec4(float(vId & 255), float((vId >> 8) & 255), float((vId >> 16) & 255), 255.0) / 255.0;
}`;

const uniforms = {
  colTex: { value: null },
  hiTex: { value: null },
  palette: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
  hiColor: { value: new THREE.Vector3(1, 1, 1) },
  wire: { value: 0 },
};
const meshMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: MESH_VS, fragmentShader: MESH_FS, side: THREE.DoubleSide });
const pickMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PICK_VS, fragmentShader: PICK_FS, side: THREE.DoubleSide });

let paint = null; // PaintMesh
let split = null; // Werkzeug „Teilen“ (splitui.js)
let geometry = null, meshObj = null, pickObj = null, colTex = null, hiTex = null;

// Pinsel-Cursor
const ring = new THREE.Group();
{
  const pts = Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); });
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l1 = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  const l2 = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  l2.scale.setScalar(1.04);
  l1.renderOrder = l2.renderOrder = 10;
  ring.add(l2, l1);
  ring.visible = false;
  scene.add(ring);
}

let needRender = true;
const requestRender = () => { needRender = true; };
let pickDirty = true;
controls.addEventListener('change', () => { pickDirty = true; requestRender(); hoverDirty = true; });

function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pickDirty = true;
  requestRender();
}
new ResizeObserver(resize).observe(vp);

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgbToHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

function updatePaletteUniform() {
  state.palette.forEach((p, i) => { const c = hexToRgb(p.color); uniforms.palette.value[i].set(c[0] / 255, c[1] / 255, c[2] / 255); });
  const a = hexToRgb(state.palette[state.slot].color);
  uniforms.hiColor.value.set(a[0] / 255, a[1] / 255, a[2] / 255);
  requestRender();
}

function makeTex(buf, rows) {
  const t = new THREE.DataTexture(buf, TEX_W, rows, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function setMesh(pm, { fit = true } = {}) {
  paint = pm;
  grad = null;
  if (meshObj) {
    scene.remove(meshObj); pickScene.remove(pickObj);
    geometry.dispose(); colTex.dispose(); hiTex.dispose();
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pm.pos, 3));
  colTex = makeTex(pm.colBuf, pm.texRows);
  hiTex = makeTex(pm.hiBuf, pm.texRows);
  uniforms.colTex.value = colTex;
  uniforms.hiTex.value = hiTex;
  meshObj = new THREE.Mesh(geometry, meshMat);
  pickObj = new THREE.Mesh(geometry, pickMat);
  meshObj.frustumCulled = pickObj.frustumCulled = false;
  scene.add(meshObj);
  pickScene.add(pickObj);
  pickDirty = true;
  hiActive = false;
  $('empty').hidden = true;
  updateBrushRange(fit);
  updateInfo();
  updateCounts();
  if (fit) fitView();
  if (split) split.meshChanged();
  requestRender();
}

const rebuildScene = () => setMesh(paint, { fit: false });

function geometryChanged() {
  geometry.attributes.position.needsUpdate = true;
  pickDirty = true;
  updateInfo();
  requestRender();
}

function markColors() {
  colTex.needsUpdate = true;
  paint.lastFillGen = -1;
  hoverDirty = true;
  requestRender();
}

let hiActive = false;
function clearHi() {
  if (!paint || !hiActive) return;
  paint.hi.fill(0);
  hiActive = false;
  hiTex.needsUpdate = true;
  requestRender();
}
function hiFromOut() {
  paint.hi.fill(0);
  const o = paint.out;
  for (let i = 0; i < paint.outCount; i++) paint.hi[o[i]] = 1;
  hiActive = true;
  hiTex.needsUpdate = true;
  requestRender();
}

function fitView() {
  if (!paint) return;
  const b = paint.bbox;
  const c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const size = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 10;
  const dist = (size / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.15;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (!isFinite(dir.x)) dir.set(0.5, -0.7, 0.5).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, size / 500);
  camera.far = size * 200 + 2000;
  camera.updateProjectionMatrix();
  controls.update();
  pickDirty = true;
  requestRender();
}

// ---------------------------------------------------------------- Picking (GPU, ID-Puffer)
const pickRT = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
let pickBuf = new Uint8Array(4), pickW = 1, pickH = 1;
const tmpColor = new THREE.Color();

function updatePick() {
  if (!pickDirty || !paint) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  if (w !== pickW || h !== pickH) {
    pickRT.setSize(w, h);
    pickBuf = new Uint8Array(w * h * 4);
    pickW = w; pickH = h;
  }
  renderer.getClearColor(tmpColor);
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(pickRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(pickScene, camera);
  renderer.readRenderTargetPixels(pickRT, 0, 0, w, h, pickBuf);
  renderer.setRenderTarget(null);
  renderer.setClearColor(tmpColor, alpha);
  pickDirty = false;
}

function pickTri(x, y) {
  if (!paint) return -1;
  updatePick();
  if (x < 0 || y < 0 || x >= pickW || y >= pickH) return -1;
  const i = ((pickH - 1 - y) * pickW + x) * 4;
  const id = pickBuf[i] | (pickBuf[i + 1] << 8) | (pickBuf[i + 2] << 16);
  return id - 1;
}

const raycaster = new THREE.Raycaster();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function hitPoint(t, x, y) {
  const p = paint.pos, o = 9 * t;
  raycaster.setFromCamera(new THREE.Vector2((x / pickW) * 2 - 1, -(y / pickH) * 2 + 1), camera);
  _a.set(p[o], p[o + 1], p[o + 2]); _b.set(p[o + 3], p[o + 4], p[o + 5]); _c.set(p[o + 6], p[o + 7], p[o + 8]);
  const out = new THREE.Vector3();
  if (raycaster.ray.intersectTriangle(_a, _b, _c, false, out)) return out;
  return out.set(paint.cen[3 * t], paint.cen[3 * t + 1], paint.cen[3 * t + 2]);
}

function viewProj() {
  camera.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
}

// Dreiecke im Bildschirm-Rechteck -> paint.out
function rectSelect(x0, y0, x1, y1, visibleOnly) {
  const xa = Math.max(0, Math.min(x0, x1)), xb = Math.min(pickW - 1, Math.max(x0, x1));
  const ya = Math.max(0, Math.min(y0, y1)), yb = Math.min(pickH - 1, Math.max(y0, y1));
  const out = paint.out;
  let oc = 0;
  if (visibleOnly) {
    updatePick();
    const g = paint.nextGen(), st = paint.stamp;
    for (let y = ya; y <= yb; y++) {
      let i = ((pickH - 1 - y) * pickW + xa) * 4;
      for (let x = xa; x <= xb; x++, i += 4) {
        const t = (pickBuf[i] | (pickBuf[i + 1] << 8) | (pickBuf[i + 2] << 16)) - 1;
        if (t >= 0 && st[t] !== g) { st[t] = g; out[oc++] = t; }
      }
    }
  } else {
    const e = viewProj(), cen = paint.cen, W = pickW, H = pickH;
    for (let t = 0; t < paint.n; t++) {
      const x = cen[3 * t], y = cen[3 * t + 1], z = cen[3 * t + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) * 0.5 * W;
      const sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 * H;
      if (sx >= xa && sx <= xb && sy >= ya && sy <= yb) out[oc++] = t;
    }
  }
  paint.outCount = oc;
  return oc;
}

// ---------------------------------------------------------------- Rückgängig
const undoStack = [], redoStack = [];
const UNDO_BYTES = 700e6;
function capture(geo) {
  return geo ? { geo: true, pos: paint.pos.slice(), col: paint.col.slice() } : { geo: false, col: paint.col.slice() };
}
const entryBytes = (s) => s.col.byteLength + (s.pos ? s.pos.byteLength : 0);
function snapshot(geo = false) {
  if (!paint) return;
  gradDiscard();
  undoStack.push(capture(geo));
  redoStack.length = 0;
  markDirty();
  let total = undoStack.reduce((s, e) => s + entryBytes(e), 0);
  while ((undoStack.length > 60 || total > UNDO_BYTES) && undoStack.length > 1) total -= entryBytes(undoStack.shift());
  updateUndoButtons();
}
function dropSnapshot() { undoStack.pop(); updateUndoButtons(); }
function restore(s) {
  if (s.geo) { paint.setGeometry(s.pos, s.col); rebuildScene(); }
  else { paint.col.set(s.col); markColors(); updateCounts(); }
}
function undo() {
  gradDiscard();
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(capture(s.geo));
  restore(s);
  updateUndoButtons();
}
function redo() {
  gradDiscard();
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(capture(s.geo));
  restore(s);
  updateUndoButtons();
}
function updateUndoButtons() {
  $('btnUndo').disabled = !undoStack.length;
  $('btnRedo').disabled = !redoStack.length;
}

// Ergebnis eines Malvorgangs übernehmen (oder leeren Undo-Schritt verwerfen)
function commit(changed) {
  if (changed > 0) { markColors(); updateCounts(); }
  else dropSnapshot();
}

// ---------------------------------------------------------------- Werkzeuge
let drag = null, spaceDown = false, hover = null, hoverDirty = false;
let lastHoverKey = '';

function mpos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.floor(e.clientX - r.left), y: Math.floor(e.clientY - r.top) };
}
const activeSlot = (e) => (e && (e.ctrlKey || e.metaKey) ? 0 : state.slot);

function setTool(t) {
  if (state.tool === 'grad' && t !== 'grad' && grad) { gradDiscard(); toast('Verlaufs-Vorschau verworfen (nicht übernommen).'); }
  if (shapeDraw) { shapeDraw = null; shapeInfo(); }
  if (t !== 'place' && placing) { rememberPlacing(); placing = null; placeMesh.visible = false; }
  shapeLine.visible = false;
  state.tool = t;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  document.querySelectorAll('#toolOpts > div[data-for]').forEach((d) => d.classList.toggle('show', d.dataset.for === t));
  $('toolTitle').textContent = 'Werkzeug: ' + TOOL_NAMES[t];
  $('hint').textContent = HINTS[t] + (t === 'view' ? '' : NAV_HINT);
  updateMouseButtons();
  ring.visible = false;
  clearHi();
  lastHoverKey = '';
  hoverDirty = true;
  canvas.style.cursor = t === 'view' ? 'grab' : t === 'pick' ? 'copy' : 'crosshair';
  if (t === 'shape') setShapeKind(state.shape);
  if (t === 'grad') gradPreview(); else updateGradMarks();
  if (split) split.setActive(t === 'split');
  requestRender();
}

function updateMouseButtons() {
  if (state.tool === 'view' || spaceDown) controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  else controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
}

function paintAt(x, y, slot) {
  const t = pickTri(x, y);
  if (t < 0) return 0;
  if (state.tool === 'tri') {
    if (paint.col[t] === slot) return 0;
    paint.col[t] = slot;
    return 1;
  }
  const hp = hitPoint(t, x, y);
  paint.sphereRegion(t, hp.x, hp.y, hp.z, state.brushR);
  return paint.setColor(paint.out, paint.outCount, slot);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (e.button !== 0 || !paint || spaceDown || state.tool === 'view') return;
  const { x, y } = mpos(e);
  const t = pickTri(x, y);
  if (e.altKey) { if (t >= 0) selectSlot(paint.col[t]); return; }
  const slot = activeSlot(e);
  switch (state.tool) {
    case 'shape':
      shapeDown(e, x, y, t);
      break;
    case 'place':
      if (t >= 0 && placing) placeImage(frameAt(t, hitPoint(t, x, y), $('plcDir').value, +$('plcRot').value || 0));
      break;
    case 'brush':
    case 'tri': {
      snapshot();
      drag = { tool: state.tool, lx: x, ly: y, changed: 0, slot };
      drag.changed += paintAt(x, y, slot);
      if (drag.changed) { markColors(); }
      canvas.setPointerCapture(e.pointerId);
      break;
    }
    case 'fill': {
      if (t < 0) return;
      snapshot();
      paint.fillRegion(t, state.fillAngle, state.fillRel, state.fillSame);
      commit(paint.setColor(paint.out, paint.outCount, slot));
      clearHi();
      break;
    }
    case 'rect': {
      drag = { tool: 'rect', x0: x, y0: y, x1: x, y1: y, slot };
      updateRectDiv();
      $('rect').hidden = false;
      canvas.setPointerCapture(e.pointerId);
      break;
    }
    case 'height': {
      if (t < 0) return;
      snapshot();
      const hp = hitPoint(t, x, y);
      paint.heightRegion(hp.z, state.heightBelow === e.shiftKey);
      commit(paint.setColor(paint.out, paint.outCount, slot));
      break;
    }
    case 'pick':
      if (t >= 0) selectSlot(paint.col[t]);
      break;
    case 'grad':
      gradClick(t, x, y);
      break;
    case 'flat':
      if (t >= 0) layFlat(t);
      break;
    case 'split':
      split.click(t, x, y, e);
      break;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const { x, y } = mpos(e);
  hover = { x, y, shift: e.shiftKey };
  hoverDirty = true;
  if (shapeDraw) { shapeMove(x, y); return; }
  if (!drag) return;
  if (drag.tool === 'brush' || drag.tool === 'tri') {
    const dx = x - drag.lx, dy = y - drag.ly;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
    let ch = 0;
    for (let i = 1; i <= steps; i++) ch += paintAt(Math.round(drag.lx + (dx * i) / steps), Math.round(drag.ly + (dy * i) / steps), drag.slot);
    drag.lx = x; drag.ly = y;
    if (ch) { drag.changed += ch; markColors(); }
  } else if (drag.tool === 'rect') {
    drag.x1 = x; drag.y1 = y;
    updateRectDiv();
  }
});

canvas.addEventListener('pointerleave', () => {
  hover = null;
  if (!drag) { ring.visible = false; if (state.tool !== 'split') clearHi(); lastHoverKey = ''; requestRender(); }
});

window.addEventListener('pointerup', (e) => {
  if (shapeDraw && e.button === 0) { shapeUp(); try { canvas.releasePointerCapture(e.pointerId); } catch { /* egal */ } return; }
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.tool === 'brush' || d.tool === 'tri') {
    if (d.changed) updateCounts(); else dropSnapshot();
  } else if (d.tool === 'rect') {
    $('rect').hidden = true;
    clearHi();
    if (Math.abs(d.x1 - d.x0) < 2 && Math.abs(d.y1 - d.y0) < 2) return;
    snapshot();
    rectSelect(d.x0, d.y0, d.x1, d.y1, state.rectVis);
    commit(paint.setColor(paint.out, paint.outCount, d.slot));
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* egal */ }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function updateRectDiv() {
  const r = $('rect');
  r.style.left = Math.min(drag.x0, drag.x1) + 'px';
  r.style.top = Math.min(drag.y0, drag.y1) + 'px';
  r.style.width = Math.abs(drag.x1 - drag.x0) + 'px';
  r.style.height = Math.abs(drag.y1 - drag.y0) + 'px';
}

// Vorschau beim Überfahren (läuft einmal pro Frame)
function processHover() {
  if (!hoverDirty || !paint) return;
  hoverDirty = false;
  const tool = state.tool;
  if (!hover || spaceDown) {
    ring.visible = false;
    if (!drag && tool !== 'split') clearHi();
    if (tool === 'place') placeMesh.visible = false;
    if (tool === 'shape' && !shapeDraw) shapeLine.visible = false;
    requestRender();
    return;
  }
  if (drag && drag.tool === 'rect') {
    rectSelect(drag.x0, drag.y0, drag.x1, drag.y1, state.rectVis);
    hiFromOut();
    return;
  }
  const t = pickTri(hover.x, hover.y);
  if (tool === 'brush') {
    if (t < 0) { ring.visible = false; requestRender(); return; }
    const hp = hitPoint(t, hover.x, hover.y);
    const n = new THREE.Vector3(paint.fn[3 * t], paint.fn[3 * t + 1], paint.fn[3 * t + 2]);
    if (n.dot(camera.position.clone().sub(hp)) < 0) n.negate();
    ring.position.copy(hp).addScaledVector(n, state.brushR * 0.02);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    ring.scale.setScalar(state.brushR);
    ring.visible = true;
    requestRender();
  } else if (tool === 'tri') {
    if (drag) return;
    if (t < 0) { clearHi(); return; }
    paint.out[0] = t; paint.outCount = 1;
    hiFromOut();
  } else if (tool === 'fill') {
    if (t < 0) { clearHi(); lastHoverKey = ''; return; }
    const key = `${state.fillAngle}|${state.fillRel}|${state.fillSame}`;
    if (key === lastHoverKey && hiActive && paint.inLastFill(t)) return;
    lastHoverKey = key;
    paint.fillRegion(t, state.fillAngle, state.fillRel, state.fillSame);
    hiFromOut();
  } else if (tool === 'height') {
    if (t < 0) { clearHi(); return; }
    const hp = hitPoint(t, hover.x, hover.y);
    paint.heightRegion(hp.z, state.heightBelow === hover.shift);
    hiFromOut();
  } else if (tool === 'shape') {
    if (shapeDraw) return;
    const sized = state.shape === 'circle' || state.shape === 'rect';
    if (t < 0 || !sized || !$('shapeFixed').checked) { shapeLine.visible = false; requestRender(); return; }
    const F = frameAt(t, hitPoint(t, hover.x, hover.y), $('shapeDir').value, state.shape === 'rect' ? +$('shapeRot').value || 0 : 0);
    showOutline(F, fixedShapePts());
  } else if (tool === 'place') {
    if (!placing) return;
    placing.F = t < 0 ? null : frameAt(t, hitPoint(t, hover.x, hover.y), $('plcDir').value, +$('plcRot').value || 0);
    updatePlacePreview();
  } else if (tool === 'split') {
    split.hover(t, hover.x, hover.y);
  } else if (tool === 'flat') {
    if (t < 0) { clearHi(); lastHoverKey = ''; return; }
    if (hiActive && paint.inLastFill(t)) return;
    paint.fillRegion(t, 2, true, false);
    hiFromOut();
  }
}

// ---------------------------------------------------------------- Modell-Operationen
function applyMatrix4(m, drop = true) {
  const e = m.elements;
  paint.transform([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], [e[12], e[13], e[14]]);
  if (drop) paint.dropToBed();
  geometryChanged();
}

function layFlat(t) {
  snapshot(true);
  const n = new THREE.Vector3(paint.fn[3 * t], paint.fn[3 * t + 1], paint.fn[3 * t + 2]);
  const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1));
  applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  clearHi();
  fitView();
  toast('Modell hingelegt.');
}

document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => {
  if (!paint) return;
  const [ax, deg] = b.dataset.rot.split(',');
  const a = (+deg * Math.PI) / 180;
  snapshot(true);
  const m = ax === 'x' ? new THREE.Matrix4().makeRotationX(a) : ax === 'y' ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationZ(a);
  applyMatrix4(m);
  fitView();
}));

$('btnMirror').addEventListener('click', () => {
  if (!paint) return;
  snapshot(true);
  applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  rebuildScene();
});

$('btnScale').addEventListener('click', () => {
  if (!paint) return;
  const f = +$('scalePct').value / 100;
  if (!(f > 0) || f === 1) return;
  snapshot(true);
  applyMatrix4(new THREE.Matrix4().makeScale(f, f, f));
  $('scalePct').value = 100;
  updateBrushRange(true);
  fitView();
});

$('btnSubdiv').addEventListener('click', () => withBusy('Unterteile …', () => {
  if (!paint) return;
  const L = +$('subdivMm').value;
  if (!(L > 0)) return;
  const before = paint.n;
  snapshot(true);
  const r = paint.subdivide(L, 4_000_000);
  if (!r.changed) { dropSnapshot(); toast(r.limited ? 'Abgebrochen: zu viele Dreiecke (max. 4 Mio.). Größeren Wert wählen.' : 'Keine Kante ist länger – nichts zu tun.'); return; }
  rebuildScene();
  toast(`Unterteilt: ${fmtInt(before)} → ${fmtInt(paint.n)} Dreiecke` + (r.limited ? ' (Grenze von 4 Mio. erreicht)' : ''));
}));

$('btnFit').addEventListener('click', fitView);
$('showWire').addEventListener('change', (e) => { uniforms.wire.value = e.target.checked ? 1 : 0; requestRender(); });

// ---------------------------------------------------------------- Palette
function renderPalette() {
  const el = $('palette');
  el.innerHTML = '';
  state.palette.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'slot' + (i === state.slot ? ' active' : '');
    row.innerHTML = `<span class="num">${i + 1}</span><input type="color" value="${p.color}" title="Farbe ändern"><input type="text" title="Name"><span class="pct"></span><button class="del" title="Filament entfernen">✕</button>`;
    const [colorIn, nameIn] = row.querySelectorAll('input');
    nameIn.value = p.name;
    row.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') selectSlot(i); });
    colorIn.addEventListener('input', () => { p.color = colorIn.value; updatePaletteUniform(); updateGradBar(); updateGradMarks(); });
    colorIn.addEventListener('click', () => selectSlot(i));
    nameIn.addEventListener('change', () => { p.name = nameIn.value; renderSelects(); });
    row.querySelector('.del').addEventListener('click', () => removeSlot(i));
    el.appendChild(row);
  });
  $('btnAddSlot').disabled = state.palette.length >= MAX_SLOTS;
  renderSelects();
  updateCounts();
  updatePaletteUniform();
}

function renderSelects() {
  const sel = $('replFrom'), prev = sel.value;
  sel.innerHTML = state.palette.map((p, i) => `<option value="${i}">${i + 1}: ${escapeHtml(p.name)}</option>`).join('');
  if (prev && +prev < state.palette.length) sel.value = prev;
  renderGradSelects();
  if (split) split.renderCapSlots();
}

function selectSlot(i) {
  if (i >= state.palette.length) return;
  state.slot = i;
  document.querySelectorAll('#palette .slot').forEach((r, k) => r.classList.toggle('active', k === i));
  updatePaletteUniform();
  lastHoverKey = '';
  hoverDirty = true;
}

function addSlot() {
  if (state.palette.length >= MAX_SLOTS) return;
  const used = new Set(state.palette.map((p) => p.color));
  const d = DEFAULT_COLORS.find(([, c]) => !used.has(c)) || ['Filament', '#888888'];
  state.palette.push({ name: d[0], color: d[1] });
  renderPalette();
  selectSlot(state.palette.length - 1);
}

function removeSlot(i) {
  if (state.palette.length <= 1) return;
  if (paint) {
    const used = paint.counts()[i];
    if (used && !confirm(`Filament ${i + 1} wird verwendet. Diese Flächen bekommen Filament 1. Fortfahren?`)) return;
    snapshot();
    paint.removeSlot(i);
    markColors();
  }
  state.palette.splice(i, 1);
  if (state.slot >= state.palette.length) state.slot = state.palette.length - 1;
  renderPalette();
  selectSlot(state.slot);
}

function updateCounts() {
  const rows = document.querySelectorAll('#palette .slot .pct');
  if (!paint) { rows.forEach((r) => (r.textContent = '')); return; }
  const c = paint.counts();
  rows.forEach((r, i) => {
    const pct = (c[i] / paint.n) * 100;
    r.textContent = c[i] ? (pct < 0.1 ? '<0,1 %' : pct.toFixed(pct < 10 ? 1 : 0).replace('.', ',') + ' %') : '–';
  });
}

$('btnAddSlot').addEventListener('click', addSlot);
$('btnFillAll').addEventListener('click', () => {
  if (!paint) return;
  snapshot();
  const before = paint.col.slice();
  paint.fillAll(state.slot);
  let ch = 0;
  for (let t = 0; t < paint.n; t++) if (before[t] !== paint.col[t]) { ch = 1; break; }
  commit(ch);
});
$('btnReplace').addEventListener('click', () => {
  if (!paint) return;
  const from = +$('replFrom').value;
  if (from === state.slot) return;
  snapshot();
  commit(paint.replaceColor(from, state.slot));
});

// ---------------------------------------------------------------- Optionen
function updateBrushRange(reset) {
  if (!paint) return;
  const b = paint.bbox;
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 10;
  const slider = $('brushR');
  slider.max = Math.max(5, Math.round(diag / 3));
  slider.min = Math.max(0.05, +(diag / 1000).toFixed(2));
  slider.step = diag > 50 ? 0.1 : 0.05;
  if (reset) setBrushR(Math.max(+slider.min, +(diag / 40).toFixed(1)));
  if (reset) $('subdivMm').value = Math.max(0.1, +(diag / 150).toFixed(1));
}
function setBrushR(r) {
  const s = $('brushR');
  r = Math.min(+s.max, Math.max(+s.min, r));
  state.brushR = r;
  s.value = r;
  $('brushROut').textContent = r.toFixed(r < 10 ? 1 : 0).replace('.', ',') + ' mm';
  hoverDirty = true;
}
$('brushR').addEventListener('input', (e) => setBrushR(+e.target.value));
$('fillAngle').addEventListener('input', (e) => { state.fillAngle = +e.target.value; $('fillAngleOut').textContent = state.fillAngle + '°'; hoverDirty = true; });
$('fillSame').addEventListener('change', (e) => { state.fillSame = e.target.checked; hoverDirty = true; });
$('fillRel').addEventListener('change', (e) => { state.fillRel = e.target.checked; hoverDirty = true; });
$('rectVis').addEventListener('change', (e) => { state.rectVis = e.target.checked; });
$('heightBelow').addEventListener('change', (e) => { state.heightBelow = e.target.checked; hoverDirty = true; });

document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// ---------------------------------------------------------------- Info / Hilfen
const fmtInt = (n) => n.toLocaleString('de-DE');
const fmtMm = (v) => v.toFixed(1).replace('.', ',');
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function updateInfo() {
  $('mapEditRow').hidden = !state.mapProject;
  if (!paint) { $('modelInfo').textContent = 'Kein Modell geladen.'; $('stats').textContent = ''; return; }
  const b = paint.bbox;
  const dims = `${fmtMm(b.max[0] - b.min[0])} × ${fmtMm(b.max[1] - b.min[1])} × ${fmtMm(b.max[2] - b.min[2])} mm`;
  $('modelInfo').innerHTML = `<b>${escapeHtml(state.modelName)}</b><br>${dims}<br>${fmtInt(paint.n)} Dreiecke` +
    (paint.openEdges ? `<br><span style="color:#fbbf24">Achtung: ${fmtInt(paint.openEdges)} offene Kanten (Netz nicht geschlossen)</span>` : '');
  $('stats').textContent = `${dims} · ${fmtInt(paint.n)} Dreiecke`;
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

async function withBusy(msg, fn) {
  const b = $('busy');
  b.textContent = msg;
  b.hidden = false;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
  try { await fn(); }
  catch (err) { console.error(err); alert('Fehler: ' + (err.message || err)); }
  finally { b.hidden = true; }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------------------------------------------------------------- Laden / Export
async function loadFiles(files, add) {
  const projects = files.filter((f) => /\.3dprojekt$/i.test(f.name));
  const tracks = files.filter((f) => map.isTrackFile(f));
  files = files.filter((f) => !projects.includes(f) && !tracks.includes(f));
  if (projects.length) { await openProjectFile(projects[0]); return; }
  if (tracks.length) { map.addFiles(tracks); if (!files.length) return; }
  if (!files.length) return;
  await withBusy('Lade Modell …', async () => {
    const parts = [];
    let paletteFrom3mf = null, maxSlot = 0;
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      const buf = await f.arrayBuffer();
      if (ext === '3mf') {
        const r = await IO.parse3MF(buf);
        parts.push({ pos: r.pos, col: r.col });
        if (r.palette) paletteFrom3mf = r.palette;
        maxSlot = Math.max(maxSlot, r.maxSlot);
      } else if (ext === 'obj') {
        parts.push({ pos: IO.parseOBJ(new TextDecoder().decode(buf)) });
      } else if (ext === 'stl') {
        parts.push({ pos: IO.parseSTL(buf) });
      } else {
        throw new Error(`Dateityp .${ext} wird nicht unterstützt (STL, OBJ, 3MF).`);
      }
    }
    if (!parts.length) return;
    const adding = add && paint;
    if (adding) {
      const s = state.loadShift;
      for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] += s[0]; p.pos[i + 1] += s[1]; p.pos[i + 2] += s[2]; }
      parts.unshift({ pos: paint.pos, col: paint.col });
      snapshot(true);
    }
    const pos = concatPos(parts.map((p) => p.pos));
    const col = new Uint8Array(pos.length / 9);
    let o = 0;
    for (const p of parts) { if (p.col) col.set(p.col, o); o += p.pos.length / 9; }
    const pm = new PaintMesh(pos, col);
    if (!adding) {
      const b0 = pm.bbox.min.slice(), b1 = pm.bbox.max.slice();
      pm.dropToBed();
      state.loadShift = [-(b0[0] + b1[0]) / 2, -(b0[1] + b1[1]) / 2, -b0[2]];
      undoStack.length = 0; redoStack.length = 0;
      state.modelName = files[0].name.replace(/\.[^.]+$/, '');
      state.mapProject = null;
      fileHandle = null;
      if (paletteFrom3mf && paletteFrom3mf.length) state.palette = paletteFrom3mf.slice(0, MAX_SLOTS);
    }
    while (state.palette.length <= Math.min(maxSlot, MAX_SLOTS - 1)) state.palette.push({ name: DEFAULT_COLORS[state.palette.length][0], color: DEFAULT_COLORS[state.palette.length][1] });
    if (state.slot >= state.palette.length) state.slot = 0;
    renderPalette();
    setMesh(pm, { fit: !adding });
    updateUndoButtons();
    markDirty();
    if (pm.n > 3_000_000) toast('Sehr großes Modell – Bedienung kann träge sein.');
  });
}

$('btnOpen').addEventListener('click', () => $('fileModel').click());
$('btnAdd').addEventListener('click', () => (paint ? $('fileAdd').click() : $('fileModel').click()));
$('fileModel').addEventListener('change', (e) => { if (e.target.files.length) loadFiles([...e.target.files], false); e.target.value = ''; });
$('fileAdd').addEventListener('change', (e) => { if (e.target.files.length) loadFiles([...e.target.files], true); e.target.value = ''; });

$('btnExport').addEventListener('click', () => {
  if (!paint) { toast('Erst ein Modell laden.'); return; }
  withBusy('Exportiere 3MF …', async () => {
    const parts = $('expParts').checked ? triComponents(paint.idx, paint.nv) : null;
    const blob = await IO.export3MF(paint, state.palette, { name: state.modelName, parts });
    download(blob, `${state.modelName}_farbig.3mf`);
    const c = paint.counts();
    const used = state.palette.map((p, i) => (c[i] ? `${i + 1}=${p.name}` : null)).filter(Boolean);
    toast(`3MF gespeichert${parts && parts.count > 1 ? ` (${parts.count} Teile als einzelne Objekte)` : ''}. Filamente im Slicer: ${used.join(', ')}`, 6000);
  });
});

// Drag & Drop
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragover'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  const img = files.find((f) => f.type.startsWith('image/'));
  if (img) openImageDialog(img);
  else loadFiles(files, e.shiftKey && !!paint);
});

// Demo: kleines Haus (scharfe Kanten -> Eimer stoppt an jeder Fläche)
$('btnDemo').addEventListener('click', (ev) => { ev.preventDefault(); withBusy('Erzeuge Demo …', () => {
  const prof = [[-20, 0], [20, 0], [20, 25], [0, 40], [-20, 25]]; // Giebel im XZ-Profil
  const Y0 = -15, Y1 = 15, tris = [];
  const P = (k, y) => [prof[k][0], y, prof[k][1]];
  for (let k = 1; k + 1 < prof.length; k++) {
    tris.push(P(0, Y0), P(k, Y0), P(k + 1, Y0));
    tris.push(P(0, Y1), P(k + 1, Y1), P(k, Y1));
  }
  for (let k = 0; k < prof.length; k++) {
    const m = (k + 1) % prof.length;
    tris.push(P(k, Y0), P(k, Y1), P(m, Y1), P(k, Y0), P(m, Y1), P(m, Y0));
  }
  let pos = Float32Array.from(tris.flat());
  // Umlaufsinn prüfen (Volumen muss positiv sein)
  let vol = 0;
  for (let o = 0; o < pos.length; o += 9) vol += pos[o] * (pos[o + 4] * pos[o + 8] - pos[o + 5] * pos[o + 7]) - pos[o + 1] * (pos[o + 3] * pos[o + 8] - pos[o + 5] * pos[o + 6]) + pos[o + 2] * (pos[o + 3] * pos[o + 7] - pos[o + 4] * pos[o + 6]);
  if (vol < 0) for (let o = 0; o < pos.length; o += 9) for (let k = 0; k < 3; k++) { const t = pos[o + 3 + k]; pos[o + 3 + k] = pos[o + 6 + k]; pos[o + 6 + k] = t; }
  const demo = new PaintMesh(pos);
  demo.subdivide(1);
  demo.dropToBed();
  state.modelName = 'Demo-Haus';
  state.loadShift = [0, 0, 0];
  state.mapProject = null;
  undoStack.length = 0; redoStack.length = 0;
  setMesh(demo);
  updateUndoButtons();
}); });

// ---------------------------------------------------------------- Ebenen-Frames (für Formen und Bilder)
function modelDiag() {
  const b = paint.bbox;
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 10;
}

// Projektionsebene am Trefferpunkt: O = Punkt, N = Flächennormale (gemittelt) oder Blickrichtung,
// U/W = Achsen in der Ebene (U zeigt auf dem Bildschirm nach rechts), optional gedreht
function frameAt(t, hp, dir, rotDeg) {
  let N;
  if (dir === 'view') {
    N = camera.getWorldDirection(new THREE.Vector3()).negate();
  } else {
    const fn = paint.fn;
    const n0 = new THREE.Vector3(fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]);
    N = new THREE.Vector3();
    paint.sphereRegion(t, hp.x, hp.y, hp.z, Math.max(0.3, modelDiag() * 0.01));
    for (let i = 0; i < paint.outCount; i++) {
      const s = paint.out[i];
      const nx = fn[3 * s], ny = fn[3 * s + 1], nz = fn[3 * s + 2];
      if (nx * n0.x + ny * n0.y + nz * n0.z > 0.85) N.x += nx, N.y += ny, N.z += nz;
    }
    if (N.lengthSq() < 1e-12) N.copy(n0);
    N.normalize();
  }
  if (N.dot(camera.position.clone().sub(hp)) < 0) N.negate();
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  let U = right.clone().addScaledVector(N, -right.dot(N));
  if (U.lengthSq() < 1e-8) {
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    U = new THREE.Vector3().crossVectors(up, N);
  }
  U.normalize();
  let W = new THREE.Vector3().crossVectors(N, U);
  if (rotDeg) {
    const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const U2 = U.clone().multiplyScalar(c).addScaledVector(W, s);
    W = W.clone().multiplyScalar(c).addScaledVector(U, -s);
    U = U2;
  }
  return { O: hp.toArray(), U: U.toArray(), W: W.toArray(), N: N.toArray() };
}

function planeUV(x, y, F) {
  raycaster.setFromCamera(new THREE.Vector2((x / pickW) * 2 - 1, -(y / pickH) * 2 + 1), camera);
  const r = raycaster.ray, N = new THREE.Vector3(...F.N), O = new THREE.Vector3(...F.O);
  const den = r.direction.dot(N);
  if (Math.abs(den) < 1e-9) return null;
  const tt = O.clone().sub(r.origin).dot(N) / den;
  if (tt <= 0) return null;
  const d = r.origin.clone().addScaledVector(r.direction, tt).sub(O);
  return [d.dot(new THREE.Vector3(...F.U)), d.dot(new THREE.Vector3(...F.W))];
}

function uvToWorld(F, u, w, lift = 0) {
  return new THREE.Vector3(
    F.O[0] + u * F.U[0] + w * F.W[0] + lift * F.N[0],
    F.O[1] + u * F.U[1] + w * F.W[1] + lift * F.N[1],
    F.O[2] + u * F.U[2] + w * F.W[2] + lift * F.N[2]);
}

function toScreen(v) {
  const p = v.clone().project(camera);
  return [((p.x + 1) / 2) * pickW, ((1 - p.y) / 2) * pickH];
}

// ---------------------------------------------------------------- Exakte Formen
state.shape = 'circle';
let shapeDraw = null; // {F, kind, pts, cur, slot, lx, ly}
const shapeLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
shapeLine.renderOrder = 11;
shapeLine.frustumCulled = false;
shapeLine.visible = false;
scene.add(shapeLine);

function circlePts(r) {
  const n = Math.min(720, Math.max(64, Math.ceil((2 * Math.PI * r) / 0.1)));
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)]; });
}
const rectPts = (u0, w0, u1, w1) => [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];

function showOutline(F, pts) {
  const arr = new Float32Array(pts.length * 3);
  pts.forEach(([u, w], i) => uvToWorld(F, u, w).toArray(arr, 3 * i));
  shapeLine.geometry.dispose();
  shapeLine.geometry = new THREE.BufferGeometry();
  shapeLine.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  shapeLine.visible = pts.length > 1;
  requestRender();
}

function fixedShapePts() {
  const w = Math.max(0.05, +$('shapeW').value || 1), h = Math.max(0.05, +$('shapeH').value || 1);
  return state.shape === 'circle' ? circlePts(w / 2) : rectPts(-w / 2, -h / 2, w / 2, h / 2);
}

function currentShapePts() {
  const d = shapeDraw, [cu, cw] = d.cur;
  switch (d.kind) {
    case 'circle': return circlePts(Math.hypot(cu, cw));
    case 'rect': return rectPts(0, 0, cu, cw);
    case 'poly': return [...d.pts, d.cur];
    default: return d.pts;
  }
}

function shapeInfo() {
  if (!shapeDraw) { $('shapeNote').textContent = ''; return; }
  const [cu, cw] = shapeDraw.cur;
  const k = shapeDraw.kind;
  const txt = k === 'circle' ? `Ø ${fmtMm(2 * Math.hypot(cu, cw))} mm` : k === 'rect' ? `${fmtMm(Math.abs(cu))} × ${fmtMm(Math.abs(cw))} mm`
    : `${shapeDraw.pts.length} Punkte` + (k === 'poly' ? ' · Enter/Doppelklick/Klick auf Startpunkt schließt · Rücktaste entfernt Punkt' : '');
  $('shapeNote').textContent = txt;
  $('hint').textContent = txt;
}

function shapeDown(e, x, y, t) {
  const kind = state.shape;
  if (shapeDraw && kind === 'poly') {
    const uv = planeUV(x, y, shapeDraw.F);
    if (!uv) return;
    const [sx, sy] = toScreen(uvToWorld(shapeDraw.F, ...shapeDraw.pts[0]));
    if (shapeDraw.pts.length >= 3 && Math.hypot(sx - x, sy - y) < 10) { finishShape(); return; }
    shapeDraw.pts.push(uv);
    shapeDraw.cur = uv;
    showOutline(shapeDraw.F, currentShapePts());
    shapeInfo();
    return;
  }
  if (t < 0) return;
  const hp = hitPoint(t, x, y);
  const F = frameAt(t, hp, $('shapeDir').value, kind === 'rect' ? +$('shapeRot').value || 0 : 0);
  shapeDraw = { F, kind, pts: [[0, 0]], cur: [0, 0], slot: activeSlot(e), lx: x, ly: y };
  if ($('shapeFixed').checked && (kind === 'circle' || kind === 'rect')) {
    shapeDraw.pts = fixedShapePts();
    finishShape(true);
    return;
  }
  if (kind !== 'poly') canvas.setPointerCapture(e.pointerId);
  showOutline(F, currentShapePts());
  shapeInfo();
}

function shapeMove(x, y) {
  const d = shapeDraw;
  const uv = planeUV(x, y, d.F);
  if (!uv) return;
  if (d.kind === 'lasso') {
    if (Math.hypot(x - d.lx, y - d.ly) < 3) return;
    d.lx = x; d.ly = y;
    d.pts.push(uv);
  }
  d.cur = uv;
  showOutline(d.F, currentShapePts());
  shapeInfo();
}

function shapeUp() {
  const d = shapeDraw;
  if (!d || d.kind === 'poly') return;
  if (d.kind === 'circle' || d.kind === 'rect') d.pts = currentShapePts();
  finishShape();
}

function cancelShape() {
  shapeDraw = null;
  shapeLine.visible = false;
  shapeInfo();
  setTool(state.tool);
}

function finishShape(fixed = false) {
  const d = shapeDraw;
  shapeDraw = null;
  shapeLine.visible = false;
  let pts = d.pts;
  if (d.kind === 'poly' && pts.length > 3) {
    const a = pts[pts.length - 1], b = pts[pts.length - 2]; // doppelte Punkte (Doppelklick) entfernen
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
  }
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [u, w] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  const minSize = modelDiag() * 1e-4;
  if (pts.length < 3 || (u1 - u0 < minSize && w1 - w0 < minSize) || (!fixed && Math.max(u1 - u0, w1 - w0) < minSize * 5)) { shapeInfo(); requestRender(); return; }
  const h = +$('shapeHeight').value || 0, top = $('shapeTop').checked;
  applyCut(d.F, [u0, u1, w0, w1], (c) => c.cutPolygon(pts), (u, w) => (pointInPolygon(u, w, pts) ? { slot: d.slot, h } : null), top, 'Form');
}

// Gemeinsamer Ablauf: schneiden, klassifizieren, ggf. extrudieren, Netz übernehmen
function applyCut(F, rect, doCuts, classify, topOnly, what) {
  return withBusy(`${what} wird eingeschnitten …`, () => {
    const before = paint.n;
    snapshot(true);
    const c = new Cutter(paint, F, rect);
    doCuts(c);
    const ch = c.apply(classify, topOnly);
    if (!ch) { dropSnapshot(); toast('Keine passende Fläche getroffen.'); return false; }
    c.extrude();
    const r = c.result();
    paint.setGeometry(r.pos, r.col);
    rebuildScene();
    toast(`${what} aufgebracht · ${fmtInt(before)} → ${fmtInt(paint.n)} Dreiecke` + (paint.openEdges ? ` · ${fmtInt(paint.openEdges)} offene Kanten` : ''));
    shapeInfo();
    return true;
  });
}

document.querySelectorAll('#shapeKind button').forEach((b) => b.addEventListener('click', () => setShapeKind(b.dataset.shape)));
function setShapeKind(k) {
  state.shape = k;
  if (shapeDraw) cancelShape();
  document.querySelectorAll('#shapeKind button').forEach((b) => b.classList.toggle('active', b.dataset.shape === k));
  const sized = k === 'circle' || k === 'rect';
  $('shapeFixed').closest('label').hidden = !sized;
  $('shapeSizeRow').hidden = !sized || !$('shapeFixed').checked;
  $('shapeWLbl').textContent = k === 'circle' ? 'Ø' : 'B';
  $('shapeHLbl').hidden = k !== 'rect';
  $('shapeRot').closest('.row').hidden = k !== 'rect';
  hoverDirty = true;
  const how = { circle: 'Vom Mittelpunkt aus aufziehen', rect: 'Von einer Ecke aus aufziehen', poly: 'Punkte anklicken, Enter/Doppelklick schließt', lasso: 'Freihand umfahren' };
  if (state.tool === 'shape') $('hint').textContent = how[k] + ' · Ctrl = Filament 1 · Esc bricht ab' + NAV_HINT;
}
$('shapeFixed').addEventListener('change', () => setShapeKind(state.shape));
['shapeW', 'shapeH', 'shapeRot', 'shapeDir'].forEach((id) => $(id).addEventListener('input', () => { hoverDirty = true; }));
canvas.addEventListener('dblclick', () => { if (shapeDraw && shapeDraw.kind === 'poly' && shapeDraw.pts.length >= 3) finishShape(); });

// ---------------------------------------------------------------- Bild auf Modell platzieren
let placing = null; // {q, rows, cellMm, prevTool, F}
const placeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
placeMesh.renderOrder = 12;
placeMesh.frustumCulled = false;
{
  const g = new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
  l.renderOrder = 13;
  placeMesh.add(l);
}
placeMesh.visible = false;
scene.add(placeMesh);

function startPlacing(q, rows, cellMm, widthMm) {
  const px = IMG.renderLabels(q, (l) => {
    if (l === IMG.TRANSPARENT || rows[l].removed) return null;
    return hexToRgb(state.palette[rows[l].slot].color);
  });
  const cv = document.createElement('canvas');
  cv.width = q.w; cv.height = q.h;
  cv.getContext('2d').putImageData(new ImageData(px, q.w, q.h), 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  if (placeMesh.material.map) placeMesh.material.map.dispose();
  placeMesh.material.map = tex;
  placeMesh.material.needsUpdate = true;
  const prevTool = state.tool === 'place' ? 'brush' : state.tool;
  $('plcW').value = Math.round(widthMm * 10) / 10;
  setTool('place');
  placing = { q, rows, cellMm, prevTool, F: null };
  updatePlaceInfo();
  hoverDirty = true;
}

function updatePlaceInfo() {
  if (!placing) return;
  const q = placing.q, W = +$('plcW').value || 1, H = (W * q.h) / q.w;
  const gw = Math.max(1, Math.min(q.w, Math.round(W / placing.cellMm)));
  $('plcInfo').textContent = `${fmtMm(W)} × ${fmtMm(H)} mm · Konturraster ${gw} × ${Math.round((gw * q.h) / q.w)}`;
}

function updatePlacePreview() {
  const F = placing && placing.F;
  if (!F) { placeMesh.visible = false; requestRender(); return; }
  const W = +$('plcW').value || 1, H = (W * placing.q.h) / placing.q.w;
  const U = new THREE.Vector3(...F.U), Wv = new THREE.Vector3(...F.W), N = new THREE.Vector3(...F.N);
  placeMesh.matrixAutoUpdate = false;
  placeMesh.matrix.makeBasis(U.multiplyScalar(W), Wv.multiplyScalar(H), N).setPosition(new THREE.Vector3(...F.O).addScaledVector(N, 0.02));
  placeMesh.matrixWorldNeedsUpdate = true;
  placeMesh.visible = true;
  requestRender();
}

function cancelPlacing() {
  rememberPlacing();
  const prev = placing ? placing.prevTool : 'brush';
  placing = null;
  placeMesh.visible = false;
  setTool(prev);
}

function placeImage(F) {
  const { q, rows, cellMm } = placing;
  const Wmm = +$('plcW').value || 1, Hmm = (Wmm * q.h) / q.w;
  const gw = Math.max(1, Math.min(q.w, Math.round(Wmm / cellMm))), gh = Math.max(1, Math.round((gw * q.h) / q.w));
  // Farben mit gleichem Filament und gleicher Höhe sind eine Klasse (keine Schnitte dazwischen)
  const classes = [];
  const classOf = rows.map((r) => {
    if (r.removed) return -1;
    const key = r.slot + '|' + r.h;
    let i = classes.findIndex((c) => c.key === key);
    if (i < 0) { classes.push({ key, slot: r.slot, h: r.h }); i = classes.length - 1; }
    return i;
  });
  const G = new Int16Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const l = IMG.labelAt(q, (i + 0.5) / gw, (j + 0.5) / gh);
    G[j * gw + i] = l === IMG.TRANSPARENT ? -1 : classOf[l];
  }
  const segs = gridContours(G, gw, gh);
  const toU = (x) => (x / gw - 0.5) * Wmm, toW = (y) => (0.5 - y / gh) * Hmm;
  const top = $('plcTop').checked;
  applyCut(F, [-Wmm / 2, Wmm / 2, -Hmm / 2, Hmm / 2], (c) => {
    for (const [x0, y0, x1, y1] of segs) c.cutSegment(toU(x0), toW(y0), toU(x1), toW(y1));
  }, (u, w) => {
    const x = Math.floor((u / Wmm + 0.5) * gw), y = Math.floor((0.5 - w / Hmm) * gh);
    if (x < 0 || y < 0 || x >= gw || y >= gh) return null;
    const g = G[y * gw + x];
    return g < 0 ? null : classes[g];
  }, top, 'Bild').then(() => {
    // Platzieren bleibt aktiv: weitere Klicks setzen dasselbe Bild erneut, „Fertig“ oder Esc beendet
    if (!placing) return;
    placing.F = null;
    hoverDirty = true;
    toast('Bild gesetzt · weiter klicken setzt es nochmal · „Fertig“ oder Esc beendet', 5000);
  });
}

// Letztes Bild merken, damit es auch nach dem Laden eines anderen Modells wieder platziert werden kann
let lastPlacing = null;
function rememberPlacing() {
  if (!placing) return;
  lastPlacing = { q: placing.q, rows: placing.rows, cellMm: placing.cellMm, W: +$('plcW').value || 40, rot: +$('plcRot').value || 0 };
  $('btnPlaceAgain').hidden = false;
}
$('btnPlaceAgain').addEventListener('click', () => {
  if (!lastPlacing) return;
  if (!paint) { toast('Erst ein Modell öffnen.'); return; }
  startPlacing(lastPlacing.q, lastPlacing.rows, lastPlacing.cellMm, lastPlacing.W);
  $('plcRot').value = lastPlacing.rot;
});

$('plcCancel').addEventListener('click', cancelPlacing);
$('plcBack').addEventListener('click', () => { cancelPlacing(); if (imgState) $('imgDlg').hidden = false; });
['plcW', 'plcRot', 'plcDir'].forEach((id) => $(id).addEventListener('input', () => { updatePlaceInfo(); hoverDirty = true; }));

// ---------------------------------------------------------------- Farbverlauf
// Vorschau direkt am Modell: grad.base hält die Farben vor dem Verlauf.
let grad = null; // {base}
let gradPts = []; // Klickpunkte im Modus „2 Punkte“
let gradViewDir = { sx: null, sy: null };
const gradMarks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, depthTest: false, transparent: true, vertexColors: true }));
const gradLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 }));
gradMarks.renderOrder = gradLine.renderOrder = 12;
gradMarks.frustumCulled = gradLine.frustumCulled = false;
gradMarks.visible = gradLine.visible = false;
scene.add(gradMarks, gradLine);

for (const [id, map] of [['gradPattern', GRAD.PATTERNS], ['gradCurve', GRAD.CURVES]]) {
  $(id).innerHTML = Object.entries(map).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
}
const gradGrain = () => 0.1 * Math.pow(200, +$('gradGrain').value / 100);
const gradRange = () => document.querySelector('input[name=gradRange]:checked').value;

function renderGradSelects() {
  const opts = (sel) => state.palette.map((p, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i + 1}: ${escapeHtml(p.name)}</option>`).join('');
  const a = $('gradA'), b = $('gradB'), o = $('gradOnly');
  const va = a.value === '' ? 0 : Math.min(+a.value, state.palette.length - 1);
  const vb = b.value === '' ? Math.min(1, state.palette.length - 1) : Math.min(+b.value, state.palette.length - 1);
  const vo = o.value === '' ? -1 : +o.value < state.palette.length ? +o.value : -1;
  a.innerHTML = opts(va); b.innerHTML = opts(vb);
  o.innerHTML = '<option value="-1">ganzes Modell</option>' + state.palette.map((p, i) => `<option value="${i}"${i === vo ? ' selected' : ''}>Flächen in ${i + 1}: ${escapeHtml(p.name)}</option>`).join('');
  updateGradBar();
}

function updateGradBar() {
  const pa = state.palette[+$('gradA').value], pb = state.palette[+$('gradB').value];
  if (!pa || !pb) return;
  const curveName = $('gradCurve').value;
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    const p = GRAD.amountAt({ s0: 0, s1: 1, curve: curveName }, i / 10);
    const ca = hexToRgb(pa.color), cb = hexToRgb(pb.color);
    stops.push(rgbToHex(ca.map((x, k) => x + (cb[k] - x) * p)) + ` ${i * 10}%`);
  }
  $('gradBar').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Richtung und Übergangsbereich -> Optionen für applyGradient (oder null)
function gradOptions() {
  if (!paint) return null;
  const mode = $('gradDir').value;
  let dir, s0, s1;
  if (mode === 'pts') {
    if (gradPts.length < 2) return null;
    const [p, q2] = gradPts;
    dir = [q2.x - p.x, q2.y - p.y, q2.z - p.z];
    const l = Math.hypot(...dir);
    if (l < 1e-6) return null;
    dir = dir.map((x) => x / l);
    s0 = p.x * dir[0] + p.y * dir[1] + p.z * dir[2];
    s1 = s0 + l;
  } else {
    if (mode === 'sx' || mode === 'sy') {
      if (!gradViewDir[mode]) captureGradView();
      dir = gradViewDir[mode];
    } else {
      dir = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[mode[0]].map((x) => (mode[1] === '-' ? -x : x));
    }
    const [lo, hi] = GRAD.extent(paint, dir);
    if (gradRange() === 'all') { s0 = lo; s1 = hi; }
    else {
      const w = Math.max(0, +$('gradWidth').value || 0);
      const c = lo + ((hi - lo) * +$('gradPos').value) / 100;
      s0 = c - w / 2; s1 = c + w / 2;
    }
  }
  return {
    a: +$('gradA').value, b: +$('gradB').value, dir, s0, s1, grain: gradGrain(),
    pattern: $('gradPattern').value, curve: $('gradCurve').value, only: +$('gradOnly').value,
  };
}

function captureGradView() {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  gradViewDir = { sx: [e[0], e[1], e[2]], sy: [e[4], e[5], e[6]] };
}

function updateGradMarks() {
  const show = state.tool === 'grad' && $('gradDir').value === 'pts' && gradPts.length > 0;
  gradMarks.visible = show;
  gradLine.visible = show && gradPts.length === 2;
  if (show) {
    const pos = new Float32Array(gradPts.length * 3), colr = new Float32Array(gradPts.length * 3);
    gradPts.forEach((p, i) => {
      p.toArray(pos, 3 * i);
      const pal = state.palette[+$(i ? 'gradB' : 'gradA').value];
      const c = hexToRgb(pal ? pal.color : '#ffffff');
      colr.set([c[0] / 255, c[1] / 255, c[2] / 255], 3 * i);
    });
    gradMarks.geometry.dispose();
    gradMarks.geometry = new THREE.BufferGeometry();
    gradMarks.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gradMarks.geometry.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    if (gradPts.length === 2) {
      gradLine.geometry.dispose();
      gradLine.geometry = new THREE.BufferGeometry().setFromPoints(gradPts);
    }
  }
  requestRender();
}

function updateGradUI() {
  const mode = $('gradDir').value;
  $('gradRangeBox').hidden = mode === 'pts';
  $('gradView').hidden = !(mode === 'sx' || mode === 'sy');
  $('gradPosLbl').hidden = gradRange() !== 'width';
  $('gradPosOut').textContent = String(+$('gradPos').value).replace('.', ',') + ' %';
  const g = gradGrain();
  $('gradGrainOut').textContent = (g < 1 ? g.toFixed(2) : g.toFixed(1)).replace('.', ',') + ' mm';
  $('gradDirNote').textContent = mode === 'pts'
    ? (gradPts.length === 0 ? 'Klick auf das Modell: Start des Verlaufs (erste Farbe).' : gradPts.length === 1 ? 'Jetzt das Ende des Verlaufs anklicken (zweite Farbe).' : 'Übergang zwischen den beiden Punkten. Neuer Klick beginnt von vorn.')
    : mode === 'sx' || mode === 'sy' ? 'Richtung wird beim Wählen aus der Ansicht übernommen.' : '';
  updateGradBar();
  updateGradMarks();
}

function gradPreview() {
  updateGradUI();
  if (!paint || state.tool !== 'grad') return;
  const o = gradOptions();
  if (!grad) grad = { base: paint.col.slice() };
  paint.col.set(grad.base);
  let info = '';
  if (o) {
    GRAD.applyGradient(paint, { ...o, base: grad.base });
    // Wie fein ist das Netz im Übergang?
    const keep = GRAD.zoneFilter(o);
    let n = 0, longE = 0;
    const P = paint.pos;
    for (let t = 0; t < paint.n; t++) {
      const k = 9 * t;
      if (!keep(P[k], P[k + 1], P[k + 2], P[k + 6], P[k + 7], P[k + 8]) && !keep(P[k], P[k + 1], P[k + 2], P[k + 3], P[k + 4], P[k + 5])) continue;
      n++;
      const e = Math.max(Math.hypot(P[k] - P[k + 3], P[k + 1] - P[k + 4], P[k + 2] - P[k + 5]), Math.hypot(P[k + 3] - P[k + 6], P[k + 4] - P[k + 7], P[k + 5] - P[k + 8]), Math.hypot(P[k + 6] - P[k], P[k + 7] - P[k + 1], P[k + 8] - P[k + 2]));
      if (e > o.grain * 1.5) longE++;
    }
    info = `Übergang ${fmtMm(Math.abs(o.s1 - o.s0))} mm · ${fmtInt(n)} Dreiecke im Übergang`;
    if (longE > n * 0.2) info += ` – Netz zu grob für diese Körnung (${fmtInt(longE)} Dreiecke zu groß): „Übergang fein unterteilen“ verwenden.`;
  } else {
    info = $('gradDir').value === 'pts' ? 'Zwei Punkte auf dem Modell anklicken.' : '';
  }
  $('gradInfo').textContent = info;
  markColors();
  updateCounts();
}

function gradDiscard() {
  if (!grad) return;
  paint.col.set(grad.base);
  grad = null;
  markColors();
  updateCounts();
}

function gradApply() {
  if (!grad || !paint) return;
  let ch = 0;
  for (let t = 0; t < paint.n; t++) if (grad.base[t] !== paint.col[t]) { ch = 1; break; }
  if (ch) {
    undoStack.push({ geo: false, col: grad.base });
    redoStack.length = 0;
    updateUndoButtons();
    toast('Farbverlauf übernommen (Strg+Z macht ihn rückgängig).');
  }
  grad = null;
  updateGradUI();
}

$('gradSubdiv').addEventListener('click', () => withBusy('Unterteile den Übergang …', () => {
  const o = gradOptions();
  if (!paint || !o) return;
  const before = paint.n;
  snapshot(true); // verwirft die Vorschau
  const r = paint.subdivide(Math.max(0.05, o.grain * 0.7), 4_000_000, GRAD.zoneFilter(o));
  if (!r.changed) { dropSnapshot(); toast(r.limited ? 'Zu viele Dreiecke (max. 4 Mio.) – Körnung vergrößern oder Übergang schmaler machen.' : 'Das Netz ist im Übergang schon fein genug.'); }
  else {
    rebuildScene();
    toast(`Übergang unterteilt: ${fmtInt(before)} → ${fmtInt(paint.n)} Dreiecke` + (r.limited ? ' (Grenze von 4 Mio. erreicht)' : ''));
  }
  gradPreview();
}));
$('gradApply').addEventListener('click', gradApply);
$('gradReset').addEventListener('click', () => { gradDiscard(); gradPts = []; updateGradUI(); setTool('brush'); });
$('gradSwap').addEventListener('click', () => { const a = $('gradA').value; $('gradA').value = $('gradB').value; $('gradB').value = a; gradPreview(); });
$('gradView').addEventListener('click', () => { captureGradView(); gradPreview(); });
$('gradDir').addEventListener('change', () => { if ($('gradDir').value === 'sx' || $('gradDir').value === 'sy') captureGradView(); gradPreview(); });
['gradA', 'gradB', 'gradPattern', 'gradCurve', 'gradOnly'].forEach((id) => $(id).addEventListener('change', gradPreview));
document.querySelectorAll('input[name=gradRange]').forEach((r) => r.addEventListener('change', gradPreview));
['gradWidth', 'gradPos', 'gradGrain'].forEach((id) => $(id).addEventListener('input', gradPreview));

// Klick im Verlaufs-Werkzeug
function gradClick(t, x, y) {
  if (t < 0) return;
  const hp = hitPoint(t, x, y);
  if ($('gradDir').value === 'pts') {
    if (gradPts.length >= 2) gradPts = [];
    gradPts.push(hp.clone());
  } else {
    const o = gradOptions();
    if (!o) return;
    const [lo, hi] = GRAD.extent(paint, o.dir);
    const s = hp.x * o.dir[0] + hp.y * o.dir[1] + hp.z * o.dir[2];
    if (gradRange() === 'all') document.querySelector('input[name=gradRange][value=width]').checked = true;
    $('gradPos').value = hi > lo ? Math.round(((s - lo) / (hi - lo)) * 200) / 2 : 50;
  }
  gradPreview();
}
// ---------------------------------------------------------------- Bild-Import (Dialog)
let imgState = null;
$('btnImage').addEventListener('click', () => $('fileImage').click());
$('fileImage').addEventListener('change', (e) => { if (e.target.files[0]) openImageDialog(e.target.files[0]); e.target.value = ''; });

const colMode = () => document.querySelector('input[name=colMode]:checked').value;
const imgMode = () => document.querySelector('input[name=imgMode]:checked').value;

async function openImageDialog(file) {
  await withBusy('Analysiere Bild …', async () => {
    const src = await IMG.loadImage(file, 1000);
    imgState = { src, img: null, name: file.name.replace(/\.[^.]+$/, ''), q: null, rows: [], rot: 0 };
    $('imgName').textContent = '– ' + file.name;
    const projLbl = $('modeProjectLbl');
    projLbl.classList.toggle('disabled', !paint);
    projLbl.querySelector('input').disabled = !paint;
    if (!paint) document.querySelector('input[name=imgMode][value=plate]').checked = true;
    if (paint) {
      const b = paint.bbox;
      $('prW').value = Math.max(5, Math.round(Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) * 0.6));
    }
    renderFixedSlots();
    updateImgMode(false);
    reprocess();
    $('imgDlg').hidden = false;
  });
}

function renderFixedSlots() {
  const el = $('fixedSlots');
  const prev = new Set([...el.querySelectorAll('input:checked')].map((i) => +i.dataset.slot));
  const first = !el.children.length;
  el.innerHTML = state.palette.map((p, i) => `<label><input type="checkbox" data-slot="${i}"${first || prev.has(i) ? ' checked' : ''}><span class="sw" style="background:${p.color}"></span>${i + 1} ${escapeHtml(p.name)}</label>`).join('');
  el.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { if (colMode() === 'fixed') requantize(); }));
}

function reprocess() {
  if (!imgState) return;
  imgState.img = IMG.preprocess(imgState.src, {
    brightness: +$('imgBri').value, contrast: +$('imgCon').value, saturation: +$('imgSat').value,
    rotate: imgState.rot, mirror: $('imgMirror').checked,
  });
  const img = imgState.img, cv = $('imgOrig');
  cv.width = img.w; cv.height = img.h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  requantize();
  syncPlateSize('w');
}

function requantize() {
  if (!imgState || !imgState.img) return;
  const fixedMode = colMode() === 'fixed';
  let slots = [];
  if (fixedMode) {
    slots = [...$('fixedSlots').querySelectorAll('input:checked')].map((i) => +i.dataset.slot);
    if (!slots.length) slots = state.palette.map((_, i) => i);
  }
  const q = IMG.quantize(imgState.img, +$('imgK').value, {
    smooth: +$('imgSmooth').value, minPct: +$('imgMinPct').value,
    fixed: fixedMode ? slots.map((i) => hexToRgb(state.palette[i].color)) : null,
  });
  const old = imgState.rows;
  imgState.q = q;
  // Auf ein vorhandenes Modell: standardmäßig nur Filamente, die das Modell noch nicht nutzt
  let free = [...Array(MAX_SLOTS).keys()];
  if (imgMode() === 'project' && paint) {
    const c = paint.counts();
    free = free.filter((i) => !c[i]);
    if (!free.length) free = [MAX_SLOTS - 1];
  }
  imgState.rows = q.colors.map((c, i) => ({ slot: fixedMode ? slots[q.origin[i]] : free[Math.min(i, free.length - 1)], removed: false, h: old[i] ? old[i].h : 0 }));
  if ($('imgBg').checked) {
    const l = IMG.cornerLabel(q);
    if (l !== IMG.TRANSPARENT && imgState.rows[l]) imgState.rows[l].removed = true;
  }
  $('fixedSlots').classList.toggle('disabled', !fixedMode);
  $('imgKLbl').classList.toggle('disabled', fixedMode);
  $('imgK').disabled = fixedMode;
  $('imgAdoptLbl').hidden = fixedMode;
  renderClusterTable();
  drawQuant();
  updatePlateInfo();
}

function clusterPreviewColor(i) {
  const r = imgState.rows[i];
  if (!r || r.removed) return null;
  if (colMode() === 'auto' && $('imgAdopt').checked) {
    const first = imgState.rows.findIndex((x) => !x.removed && x.slot === r.slot);
    return imgState.q.colors[first];
  }
  const p = state.palette[r.slot];
  return p ? hexToRgb(p.color) : imgState.q.colors[i];
}

function drawQuant() {
  const q = imgState.q, cv = $('imgQuant');
  cv.width = q.w; cv.height = q.h;
  const px = IMG.renderLabels(q, (l) => (l === IMG.TRANSPARENT ? null : clusterPreviewColor(l)));
  cv.getContext('2d').putImageData(new ImageData(px, q.w, q.h), 0, 0);
}

function slotOptions(sel, plainNumbers) {
  let s = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const p = state.palette[i];
    const label = plainNumbers ? `Filament ${i + 1}` : `${i + 1}: ${p ? escapeHtml(p.name) : '(neu)'}`;
    s += `<option value="${i}"${i === sel ? ' selected' : ''}>${label}</option>`;
  }
  return s;
}

function renderClusterTable() {
  const q = imgState.q, tb = $('imgClusters');
  const total = q.w * q.h;
  const plain = colMode() === 'auto' && $('imgAdopt').checked;
  let h = `<tr><th></th><th>Anteil</th><th>Filament</th><th title="+ erhaben · − vertieft">Höhe mm</th><th>weglassen</th></tr>`;
  q.colors.forEach((c, i) => {
    const r = imgState.rows[i];
    h += `<tr data-i="${i}"><td><div class="sw" style="background:${rgbToHex(c)}" title="${rgbToHex(c)} – ${nameOfColor(c)}"></div></td>` +
      `<td>${((q.counts[i] / total) * 100).toFixed(1).replace('.', ',')} %</td>` +
      `<td><select class="cslot">${slotOptions(r.slot, plain)}</select></td>` +
      `<td><input type="number" class="crelief" value="${r.h}" step="0.2"></td>` +
      `<td><input type="checkbox" class="cremove"${r.removed ? ' checked' : ''}></td></tr>`;
  });
  if (q.transparent) h += `<tr><td><div class="sw checker"></div></td><td>${((q.transparent / total) * 100).toFixed(1).replace('.', ',')} %</td><td colspan="3" class="note">transparent – bleibt frei</td></tr>`;
  tb.innerHTML = h;
  tb.querySelectorAll('tr[data-i]').forEach((tr) => {
    const r = imgState.rows[+tr.dataset.i];
    tr.querySelector('.cslot').addEventListener('change', (e) => { r.slot = +e.target.value; drawQuant(); });
    tr.querySelector('.cremove').addEventListener('change', (e) => { r.removed = e.target.checked; drawQuant(); updatePlateInfo(); });
    tr.querySelector('.crelief').addEventListener('input', (e) => { r.h = +e.target.value || 0; });
  });
  for (const id of ['plBaseSlot', 'plBorderSlot']) {
    const bs = $(id), prev = bs.value;
    bs.innerHTML = (id === 'plBaseSlot' ? `<option value="-1">jeweiliger Bildfarbe</option>` : '') + slotOptions(-2, false);
    bs.value = prev !== '' && [...bs.options].some((o) => o.value === prev) ? prev : id === 'plBaseSlot' ? '-1' : '0';
  }
}

function nameOfColor(c) {
  let best = '', bd = Infinity;
  for (const [n, r] of COLOR_NAMES) {
    const d = 2 * (c[0] - r[0]) ** 2 + 4 * (c[1] - r[1]) ** 2 + 3 * (c[2] - r[2]) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function updateImgMode(rerender = true) {
  const plate = imgMode() === 'plate';
  $('optPlate').hidden = !plate;
  $('optProject').hidden = plate;
  $('imgApply').textContent = plate ? 'Platte erzeugen' : 'Platzieren …';
  if (rerender && imgState && imgState.q) updatePlateInfo();
}

function syncPlateSize(from) {
  if (!imgState || !imgState.img) return;
  const a = imgState.img.h / imgState.img.w;
  if (from === 'w') $('plH').value = Math.round(+$('plW').value * a * 10) / 10;
  else $('plW').value = Math.round((+$('plH').value / a) * 10) / 10;
  updatePlateInfo();
}

function updatePlateInfo() {
  if (!imgState || !imgState.q) return;
  const q = imgState.q, W = +$('plW').value, cell = +$('plCell').value, border = +$('plBorder').value || 0;
  const gw = Math.max(1, Math.round(W / cell)), gh = Math.max(1, Math.round((gw * q.h) / q.w));
  const est = (gw + 2 * border / cell) * (gh + 2 * border / cell) * 4.5;
  $('plInfo').textContent = `Gesamt ${fmtMm(W + 2 * border)} × ${fmtMm((gh * W) / gw + 2 * border)} mm · ${gw} × ${gh} Bildpunkte · ca. ${fmtInt(Math.round(est / 1000) * 1000)} Dreiecke` +
    (est > 3e6 ? ' – sehr viel, Pixelgröße erhöhen!' : '');
  const pw = +$('prW').value, pc = +$('prCell').value;
  const pgw = Math.max(1, Math.min(q.w, Math.round(pw / pc)));
  $('prInfo').textContent = `${fmtMm(pw)} × ${fmtMm((pw * q.h) / q.w)} mm · Konturraster ${pgw} × ${Math.round((pgw * q.h) / q.w)} (max. Bildauflösung ${q.w} px)`;
}

['imgK', 'imgSmooth', 'imgMinPct', 'imgBg'].forEach((id) => $(id).addEventListener('change', requantize));
document.querySelectorAll('input[name=colMode]').forEach((r) => r.addEventListener('change', requantize));
$('imgAdopt').addEventListener('change', () => { renderClusterTable(); drawQuant(); });
document.querySelectorAll('input[name=imgMode]').forEach((r) => r.addEventListener('change', () => { updateImgMode(); requantize(); }));
$('plW').addEventListener('input', () => syncPlateSize('w'));
$('plH').addEventListener('input', () => syncPlateSize('h'));
['plCell', 'plBorder', 'prW', 'prCell'].forEach((id) => $(id).addEventListener('input', updatePlateInfo));
for (const [id, out, fmt] of [['imgBri', 'imgBriO', (v) => v], ['imgCon', 'imgConO', (v) => v], ['imgSat', 'imgSatO', (v) => v + ' %']]) {
  $(id).addEventListener('input', () => { $(out).textContent = fmt($(id).value); });
  $(id).addEventListener('change', reprocess);
}
$('imgMirror').addEventListener('change', reprocess);
$('imgRotL').addEventListener('click', () => { imgState.rot = (imgState.rot + 3) % 4; reprocess(); });
$('imgRotR').addEventListener('click', () => { imgState.rot = (imgState.rot + 1) % 4; reprocess(); });
$('imgAdjReset').addEventListener('click', () => {
  $('imgBri').value = 0; $('imgCon').value = 0; $('imgSat').value = 100; $('imgMirror').checked = false;
  $('imgBriO').textContent = '0'; $('imgConO').textContent = '0'; $('imgSatO').textContent = '100 %';
  imgState.rot = 0;
  reprocess();
});
function closeImageDialog() { $('imgDlg').hidden = true; imgState = null; }
$('imgCancel').addEventListener('click', closeImageDialog);

$('imgApply').addEventListener('click', () => {
  const { q, rows } = imgState;
  const slotOf = rows.map((r) => r.slot), removed = rows.map((r) => r.removed);
  const active = rows.map((r, i) => i).filter((i) => !removed[i]);
  if (!active.length) { alert('Alle Farben sind weggelassen.'); return; }
  const mode = imgMode();
  const extra = mode === 'plate' ? [+$('plBaseSlot').value, +$('plBorder').value > 0 ? +$('plBorderSlot').value : 0] : [0];
  const maxSlot = Math.max(...active.map((i) => slotOf[i]), ...extra);
  while (state.palette.length <= maxSlot) {
    const d = DEFAULT_COLORS[state.palette.length];
    state.palette.push({ name: d[0], color: d[1] });
  }
  if (colMode() === 'auto' && $('imgAdopt').checked) {
    const done = new Set();
    for (const i of active) {
      if (done.has(slotOf[i])) continue;
      done.add(slotOf[i]);
      state.palette[slotOf[i]] = { name: nameOfColor(q.colors[i]), color: rgbToHex(q.colors[i]) };
    }
  }
  renderPalette();
  if (mode === 'plate') {
    withBusy('Erzeuge Platte …', () => {
      const res = IMG.buildPlate(q, {
        widthMm: +$('plW').value, cellMm: +$('plCell').value, base: +$('plBase').value,
        relief: rows.map((r) => r.h), removed, slotOf, baseSlot: +$('plBaseSlot').value,
        border: +$('plBorder').value, borderSlot: +$('plBorderSlot').value, borderRelief: +$('plBorderH').value,
      });
      if (!res.col.length) { alert('Kein Modell erzeugt (Dicke 0?). Dicke oder Höhe > 0 wählen.'); return; }
      if (paint) snapshot(true);
      const pm = new PaintMesh(res.pos, res.col);
      pm.dropToBed();
      state.modelName = imgState.name;
      state.loadShift = [0, 0, 0];
      setMesh(pm);
      updateUndoButtons();
      toast(`Platte erzeugt: ${fmtInt(pm.n)} Dreiecke.`);
      closeImageDialog();
    });
  } else {
    $('imgDlg').hidden = true;
    startPlacing(q, rows.map((r) => ({ ...r })), Math.max(0.02, +$('prCell').value), +$('prW').value);
  }
});

// ---------------------------------------------------------------- Logo / Schild
const logo = initLogo({
  state, MAX_SLOTS, DEFAULT_COLORS, hexToRgb, rgbToHex, nameOfColor, escapeHtml, fmtMm, fmtInt,
  renderPalette, withBusy, toast, snapshot,
  getPaint: () => paint,
  setModel(pm, name) {
    state.modelName = name;
    state.loadShift = [0, 0, 0];
    setMesh(pm);
    updateUndoButtons();
  },
});
$('btnLogo').addEventListener('click', () => { if (!logo.reopen()) $('fileLogo').click(); });
$('lgOther').addEventListener('click', () => $('fileLogo').click());
$('fileLogo').addEventListener('change', (e) => { if (e.target.files[0]) logo.open(e.target.files[0]); e.target.value = ''; });
$('imgToLogo').addEventListener('click', () => {
  if (!imgState) return;
  const { src, name } = imgState;
  closeImageDialog();
  logo.open(src, name);
});

// ---------------------------------------------------------------- Teilen
function highlightTris(list) {
  if (!paint) return;
  paint.hi.fill(0);
  for (const t of list) paint.hi[t] = 1;
  hiActive = list.length > 0;
  hiTex.needsUpdate = true;
  requestRender();
}
function viewAlong(c, n) {
  const dist = camera.position.distanceTo(controls.target);
  const d = new THREE.Vector3(...n).normalize();
  if (Math.abs(d.z) > 0.999) d.add(new THREE.Vector3(0, -0.03, 0)).normalize();
  controls.target.set(c[0], c[1], c[2]);
  camera.position.copy(controls.target).addScaledVector(d, dist);
  controls.update();
  pickDirty = true;
  requestRender();
}
split = initSplit({
  scene, camera, state, toast, withBusy, snapshot, dropSnapshot, requestRender, fmtMm, fmtInt, escapeHtml, download, viewAlong,
  getPaint: () => paint,
  hitPoint,
  highlight: highlightTris,
  modelName: () => state.modelName,
  partCount: () => (paint ? triComponents(paint.idx, paint.nv).count : 0),
  applyGeometry(pos, col, fit = false) {
    paint.setGeometry(pos, col);
    setMesh(paint, { fit });
  },
});


// ---------------------------------------------------------------- Druckvorschau
const printer = initPrintRender({ download });
$('btnPrint').addEventListener('click', () => {
  if (!paint) { toast('Erst ein Modell laden oder erzeugen.'); return; }
  printer.open({ pos: paint.pos, col: paint.col, palette: state.palette, name: state.modelName });
});

// ---------------------------------------------------------------- Karten-Studio
const map = initMap({
  toast, escapeHtml, printPreview: (o) => printer.open(o),
  setMapModel(pos, col, palette, name, project) {
    if (paint) snapshot(true);
    const pm = new PaintMesh(pos, col);
    pm.dropToBed();
    state.palette = palette.slice(0, MAX_SLOTS);
    if (state.slot >= state.palette.length) state.slot = 0;
    state.modelName = name;
    state.loadShift = [0, 0, 0];
    state.mapProject = project;
    renderPalette();
    setMesh(pm);
    updateUndoButtons();
    markDirty();
  },
});
$('btnMap').addEventListener('click', () => map.open());
$('btnMapEdit').addEventListener('click', () => map.open(state.mapProject));
$('cardActivity').addEventListener('click', () => { map.open(); $('fileTrack').click(); });
$('cardArea').addEventListener('click', () => { map.open(null, 'area'); setTimeout(() => document.getElementById('mpSearch').focus(), 300); });
$('cardOpen').addEventListener('click', () => $('fileModel').click());
$('cardLogo').addEventListener('click', () => $('btnLogo').click());
$('btnHelp').addEventListener('click', () => { $('helpDlg').hidden = false; });
$('helpClose').addEventListener('click', () => { $('helpDlg').hidden = true; });

// ---------------------------------------------------------------- Projekte
let fileHandle = null, dirty = false, autosaveTimer = 0;
function markDirty() {
  dirty = true;
  $('saveState').textContent = '● nicht gespeichert';
  $('saveState').className = 'muted dirty';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 4000);
}
function markClean(msg = 'gespeichert') {
  dirty = false;
  $('saveState').textContent = '✓ ' + msg;
  $('saveState').className = 'muted';
}
function projectBlob() {
  return PRJ.projectBlob({ name: state.modelName, palette: state.palette, pos: paint.pos, col: paint.col, mapProject: state.mapProject });
}
async function autosave() {
  if (!paint || !dirty) return;
  try {
    if (paint.n > 2_500_000) return; // sehr große Modelle nicht im Browser zwischenspeichern
    const blob = await projectBlob();
    await PRJ.kvSet('autosave', { name: state.modelName, savedAt: Date.now(), blob });
    if (dirty) { $('saveState').textContent = '● nicht gespeichert (zwischengespeichert)'; }
  } catch (e) { console.warn('Autosave', e); }
}
async function saveProject(as = false) {
  if (!paint) { toast('Noch kein Modell – nichts zu speichern.'); return; }
  try {
    if (PRJ.canSaveDirect()) {
      if (!fileHandle || as) fileHandle = await PRJ.pickSaveHandle(state.modelName);
      await withBusy('Speichere Projekt …', async () => { await PRJ.saveTo(fileHandle, await projectBlob()); });
      await PRJ.addRecent({ name: fileHandle.name, savedAt: Date.now(), handle: fileHandle });
      markClean('gespeichert: ' + fileHandle.name);
      toast('Projekt gespeichert: ' + fileHandle.name + ' · Strg+S speichert ab jetzt direkt in diese Datei.');
    } else {
      await withBusy('Speichere Projekt …', async () => download(await projectBlob(), state.modelName.replace(/[\\/:*?"<>|]+/g, '_') + PRJ.EXT));
      markClean('heruntergeladen');
    }
    PRJ.kvSet('autosave', null);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    console.error(e); alert('Speichern fehlgeschlagen: ' + (e.message || e));
  }
}
async function openProjectBuf(buf, handle = null) {
  const p = await PRJ.readProject(buf);
  if (paint) snapshot(true);
  const pm = new PaintMesh(p.pos, p.col);
  state.palette = (p.palette || []).slice(0, MAX_SLOTS);
  if (!state.palette.length) state.palette = DEFAULT_COLORS.slice(0, 4).map(([name, color]) => ({ name, color }));
  if (state.slot >= state.palette.length) state.slot = 0;
  state.modelName = p.name || 'Projekt';
  state.mapProject = p.mapProject || null;
  state.loadShift = [0, 0, 0];
  undoStack.length = 0; redoStack.length = 0;
  renderPalette();
  setMesh(pm);
  updateUndoButtons();
  fileHandle = handle;
  markClean(handle ? 'geöffnet: ' + handle.name : 'geöffnet');
  toast(`Projekt „${state.modelName}“ geöffnet` + (state.mapProject ? ' – „Karte bearbeiten“ öffnet alle Karten-Einstellungen.' : '.'));
}
async function openProjectFile(file, handle = null) {
  await withBusy('Öffne Projekt …', async () => openProjectBuf(await file.arrayBuffer(), handle));
}
$('btnSave').addEventListener('click', () => saveProject(false));
$('btnSaveAs').addEventListener('click', () => saveProject(true));
window.addEventListener('beforeunload', (e) => { if (dirty && paint) { autosave(); e.preventDefault(); e.returnValue = ''; } });

async function renderRecent() {
  const list = await PRJ.recentList();
  const auto = await PRJ.kvGet('autosave');
  const el = $('recentList');
  el.innerHTML = '';
  const fmt = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  if (auto && auto.blob) {
    const b = document.createElement('button');
    b.className = 'accent';
    b.textContent = `↺ Wiederherstellen: ${auto.name} (${fmt(auto.savedAt)})`;
    b.title = 'Automatisch zwischengespeicherter, nicht gespeicherter Stand';
    b.addEventListener('click', () => withBusy('Stelle wieder her …', async () => { await openProjectBuf(await auto.blob.arrayBuffer()); markDirty(); }));
    el.appendChild(b);
  }
  for (const r of list) {
    if (!r.handle) continue;
    const b = document.createElement('button');
    b.textContent = `${r.name} · ${fmt(r.savedAt)}`;
    b.addEventListener('click', async () => {
      try {
        if ((await r.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await r.handle.requestPermission({ mode: 'readwrite' });
        await openProjectFile(await r.handle.getFile(), r.handle);
      } catch (e) { toast('Datei nicht mehr verfügbar: ' + (e.message || e)); }
    });
    el.appendChild(b);
  }
  $('recent').hidden = !el.children.length;
}
renderRecent();

// ---------------------------------------------------------------- Tastatur
window.addEventListener('keydown', (e) => {
  const ae = document.activeElement, tag = ae && ae.tagName;
  const typing = (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'color'].includes(ae.type)) || tag === 'SELECT' || tag === 'TEXTAREA';
  if (printer.isOpen()) { if (e.key === 'Escape') printer.close(); return; }
  if (logo.isOpen() || map.isOpen()) return; // eigene Dialoge mit eigener Tastenbehandlung
  if (e.key === 'F1') { e.preventDefault(); $('helpDlg').hidden = false; return; }
  if (!$('helpDlg').hidden) { if (e.key === 'Escape') $('helpDlg').hidden = true; return; }
  if (e.key === 'Escape') {
    if (!$('imgDlg').hidden) closeImageDialog();
    else if (shapeDraw) cancelShape();
    else if (placing) cancelPlacing();
    else if (state.tool === 'split') split.escape();
    return;
  }
  if (!$('imgDlg').hidden || typing) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); $('fileModel').click(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); $('btnExport').click(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateMouseButtons(); hoverDirty = true; canvas.style.cursor = 'grab'; } return; }
  if (e.key === 'Shift') { hoverDirty = true; if (hover) hover.shift = true; return; }
  if (shapeDraw && shapeDraw.kind === 'poly') {
    if (e.key === 'Enter') { e.preventDefault(); if (shapeDraw.pts.length >= 3) finishShape(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); if (shapeDraw.pts.length > 1) shapeDraw.pts.pop(); else { cancelShape(); return; } showOutline(shapeDraw.F, currentShapePts()); shapeInfo(); return; }
  }
  if (placing) {
    const w = $('plcW'), r = $('plcRot');
    if (e.key === '[' || e.key === ']') { w.value = Math.max(1, Math.round(+w.value * (e.key === ']' ? 1.1 : 1 / 1.1) * 10) / 10); updatePlaceInfo(); hoverDirty = true; return; }
    if (e.key === ',' || e.key === '.') { r.value = (+r.value + (e.key === '.' ? 15 : -15)) % 360; hoverDirty = true; return; }
  }
  const tools = { v: 'view', b: 'brush', t: 'tri', f: 'fill', r: 'rect', k: 'shape', h: 'height', i: 'pick', l: 'flat', g: 'grad', s: 'split' };
  if (tools[k]) { setTool(tools[k]); return; }
  if (/^[1-9]$/.test(e.key)) { selectSlot(+e.key - 1); return; }
  if (e.key === '[') setBrushR(state.brushR / 1.2);
  else if (e.key === ']') setBrushR(state.brushR * 1.2);
  else if (k === 'w') { const c = $('showWire'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
  else if (e.key === 'Home') fitView();
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && spaceDown) { spaceDown = false; updateMouseButtons(); hoverDirty = true; setTool(state.tool); }
  if (e.key === 'Shift') { hoverDirty = true; if (hover) hover.shift = false; }
});

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);

// ---------------------------------------------------------------- Start
canvas.tabIndex = 0;
$('fillAngleOut').textContent = state.fillAngle + '°';
setBrushR(state.brushR);
renderPalette();
selectSlot(state.slot);
setTool('brush');
updateUndoButtons();
resize();

function loop() {
  requestAnimationFrame(loop);
  processHover();
  if (needRender) {
    needRender = false;
    renderer.render(scene, camera);
  }
}
loop();

// Für Tests/Debugging
window.app = { state, get paint() { return paint; }, get split() { return split; }, setMesh, PaintMesh, loadFiles, IO, IMG, logo, map, printer, setTool, undo, fitView, saveProject, projectBlob, openProjectBuf, camera, controls, requestRender, snap() { renderer.render(scene, camera); return canvas.toDataURL(); } };
