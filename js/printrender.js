// Druckvorschau: zeigt das Modell so, wie es gedruckt aussehen könnte – Kunststoff-Material,
// Schichtlinien (an Wänden deutlich, auf Oberseiten diagonale Bahnen), weiche Schatten und
// eine Umgebung: auf dem Druckbett, auf dem Tisch oder an der Wand hängend.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, base, amp, n = 9000, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}
const TEX = {
  bed: () => canvasTex(512, 512, (g, w, h) => { noise(g, w, h, '#2b2a28', 0.35, 30000, 2); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(214,170,90,${Math.random() * 0.35})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, 3),
  table: () => canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#8a5a35'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const v = Math.sin(y * 0.045 + Math.sin(y * 0.011) * 3) * 0.5 + Math.sin(y * 0.31) * 0.15;
      g.fillStyle = v > 0 ? `rgba(255,220,170,${v * 0.13})` : `rgba(40,20,5,${-v * 0.22})`;
      g.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(30,15,5,0.25)'; g.fillRect(0, Math.random() * h, w, 1); }
    noise(g, 0, 0, 'transparent', 0, 0);
  }, 2),
  wall: () => canvasTex(512, 512, (g, w, h) => noise(g, w, h, '#e9e5de', 0.08, 26000, 2), 4),
};

const VERT_HEAD = 'varying vec3 vLocalP;\nvarying vec3 vLocalN;\n';
const FRAG_HEAD = 'varying vec3 vLocalP;\nvarying vec3 vLocalN;\nuniform float uLayer;\nuniform float uLines;\nuniform float uLineW;\n';
const FRAG_LINES = `
  {
    vec3 nn = normalize(vLocalN);
    float side = 1.0 - abs(nn.z);
    float zl = vLocalP.z / uLayer;
    float aa = clamp(1.0 - fwidth(zl) * 1.2, 0.0, 1.0);
    float ridge = 0.5 + 0.5 * cos(6.2831853 * zl);
    diffuseColor.rgb *= 1.0 - uLines * aa * (0.05 + 0.16 * side) * smoothstep(0.55, 1.0, ridge);
    float tl = (vLocalP.x + vLocalP.y) / (uLineW * 1.4142);
    float aa2 = clamp(1.0 - fwidth(tl) * 1.2, 0.0, 1.0);
    float top = smoothstep(0.9, 0.99, abs(nn.z));
    diffuseColor.rgb *= 1.0 - uLines * aa2 * top * 0.07 * (0.5 + 0.5 * cos(6.2831853 * tl));
  }
`;

export function initPrintRender(app) {
  const dlg = document.createElement('div');
  dlg.id = 'prDlg';
  dlg.className = 'modal';
  dlg.hidden = true;
  dlg.innerHTML = `<div class="dlg print">
    <h2>🖨 Druckvorschau <span id="prName" class="muted"></span><span class="grow"></span>
      <span class="seg seg3" id="prScene"><button data-s="wall">an der Wand</button><button data-s="table">auf dem Tisch</button><button data-s="bed">auf dem Druckbett</button></span></h2>
    <div class="prstage"><canvas id="prCanvas"></canvas><div id="prBusy" hidden>Berechne …</div></div>
    <div class="dlgfoot">
      <label class="inline">Schichthöhe <select id="prLayer"><option value="0.12">0,12 mm (fein)</option><option value="0.16">0,16 mm</option><option value="0.2" selected>0,20 mm (Standard)</option><option value="0.28">0,28 mm (schnell)</option></select></label>
      <label class="check" style="margin:0"><input type="checkbox" id="prLines" checked> Schichtlinien</label>
      <label class="check" style="margin:0" id="prDecoL"><input type="checkbox" id="prDeco" checked> Foto &amp; Medaille zeigen</label>
      <label class="inline" title="Richtung des Lichts">Licht <input type="range" id="prSun" min="0" max="360" value="135" style="width:110px"></label>
      <span id="prInfo" class="note"></span><span class="grow"></span>
      <button id="prSave">Bild speichern</button><button id="prClose" class="primary">Schließen</button>
    </div></div>`;
  document.body.appendChild(dlg);

  let R = null, cur = null, scene = 'wall';
  const uniforms = { uLayer: { value: 0.2 }, uLines: { value: 1 }, uLineW: { value: 0.42 } };

  function init() {
    if (R) return R;
    const canvas = $('prCanvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    sc.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.42;
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 10000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 4;
    sc.add(sun, sun.target);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 0.35));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }));
    ground.receiveShadow = true;
    sc.add(ground);
    const group = new THREE.Group();
    sc.add(group);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, envMapIntensity: 0.9 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalP = position;\nvLocalN = normal;');
      sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_LINES);
    };
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const deco = new THREE.Group();
    group.add(deco);
    const render = () => renderer.render(sc, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    };
    new ResizeObserver(resize).observe(canvas);
    R = { renderer, sc, camera, controls, sun, ground, group, mesh, deco, mat, render, resize, tex: {} };
    return R;
  }

  function setModel(pos, col, palette, nTris = col.length) {
    if (nTris < col.length) { pos = pos.subarray(0, nTris * 9); col = col.subarray(0, nTris); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const colors = new Float32Array(pos.length);
    const lin = palette.map((p) => { const c = new THREE.Color(p.color); return [c.r, c.g, c.b]; });
    for (let t = 0; t < col.length; t++) { const c = lin[col[t]] || [0.5, 0.5, 0.5]; for (let k = 0; k < 3; k++) colors.set(c, 9 * t + 3 * k); }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    R.mesh.geometry.dispose();
    R.mesh.geometry = g;
    const bb = g.boundingBox;
    R.mesh.position.set(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
    R.deco.position.copy(R.mesh.position);
    R.size = bb.getSize(new THREE.Vector3());
  }

  // Deko: Foto im Bilderrahmen und eine Medaille am Band – damit man das fertige Stück sieht
  function photoTex(w, h) {
    return canvasTex(Math.round(w * 4), Math.round(h * 4), (g, W, H) => {
      const sky = g.createLinearGradient(0, 0, 0, H * 0.6);
      sky.addColorStop(0, '#f6b26b'); sky.addColorStop(1, '#fde7c4');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff4d6'; g.beginPath(); g.arc(W * 0.68, H * 0.32, W * 0.08, 0, 7); g.fill();
      const mtn = (y, amp, col, seed) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 4) g.lineTo(x, y + Math.sin(x * 0.013 + seed) * amp + Math.sin(x * 0.041 + seed * 2) * amp * 0.4); g.lineTo(W, H); g.fill(); };
      mtn(H * 0.48, H * 0.06, '#8a7aa8', 1); mtn(H * 0.58, H * 0.05, '#5b6f8f', 3); mtn(H * 0.7, H * 0.03, '#2f5d50', 5);
      g.fillStyle = '#3f6fa3'; g.fillRect(0, H * 0.8, W, H * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, W, H);
    });
  }
  function setDeco(list, on) {
    const D = R.deco;
    while (D.children.length) { const c = D.children.pop(); c.geometry && c.geometry.dispose(); }
    $('prDecoL').hidden = !list.length;
    if (!on) return;
    for (const d of list) {
      if (d.type === 'photo') {
        const [x0, y0, x1, y1] = d.rect, w = x1 - x0 - 0.6, h = y1 - y0 - 0.6;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: photoTex(w, h), roughness: 0.35 }));
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, d.z + 0.15);
        m.receiveShadow = true;
        D.add(m);
      } else if (d.type === 'medal') {
        const gold = new THREE.MeshStandardMaterial({ color: 0xd8ac45, metalness: 1, roughness: 0.28 });
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, 3, 96), gold);
        disc.rotation.x = Math.PI / 2;
        disc.position.set(d.cx, d.cy, d.z + 2.6);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.82, 0.7, 12, 96), gold);
        rim.position.set(d.cx, d.cy, d.z + 4.1);
        const star = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.35, d.r * 0.35, 1.2, 5), gold);
        star.rotation.x = Math.PI / 2; star.position.set(d.cx, d.cy, d.z + 4.4);
        // Band: über den Haken, hinunter zur Medaille
        const bw = Math.min(26, (d.hook[2] - d.hook[0]) - 3);
        const rib = canvasTex(64, 16, (g, W, H) => { const c = ['#c0392b', '#f2f2f2', '#1d4ed8', '#f2f2f2', '#c0392b']; c.forEach((k, i) => { g.fillStyle = k; g.fillRect((i * W) / 5, 0, W / 5 + 1, H); }); });
        rib.repeat.set(1, 1);
        const A = [d.cx, d.hook[3] + 0.5, d.top + 0.4], B = [d.cx, d.cy + d.r * 0.92, d.z + 3.2];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([A[0] - bw / 2, A[1], A[2], A[0] + bw / 2, A[1], A[2], B[0] + bw / 2, B[1], B[2], B[0] - bw / 2, B[1], B[2]], 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        geo.setIndex([0, 2, 1, 0, 3, 2]);
        geo.computeVertexNormals();
        const ribbon = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: rib, roughness: 0.6, side: THREE.DoubleSide }));
        for (const o of [disc, rim, star, ribbon]) { o.castShadow = true; o.receiveShadow = true; D.add(o); }
      }
    }
  }

  function setScene(s, refit = true) {
    scene = s;
    if (cur) {
      setModel(cur.pos, cur.col, cur.palette, s === 'wall' && cur.mainTris ? cur.mainTris : cur.col.length);
      setDeco(cur.decor || [], $('prDeco').checked && s !== 'bed');
    }
    document.querySelectorAll('#prScene button').forEach((b) => b.classList.toggle('active', b.dataset.s === s));
    const { group, ground, size, camera, controls } = R;
    const span = Math.max(size.x, size.y), H = size.z;
    const tex = R.tex[s] || (R.tex[s] = TEX[s]());
    ground.material.map = tex;
    ground.material.roughness = s === 'bed' ? 0.55 : s === 'table' ? 0.6 : 0.95;
    ground.material.needsUpdate = true;
    R.sc.background = new THREE.Color(s === 'bed' ? 0x2a2d33 : s === 'table' ? 0x3a2a1e : 0xe9e5de);
    if (s === 'wall') {
      // Modell hängt an der Wand: Relief zeigt zum Betrachter, Norden nach oben
      group.rotation.set(0, 0, 0);
      group.position.set(0, 0, 0);
      ground.rotation.set(0, 0, 0);
      ground.position.set(0, 0, -0.05);
      ground.scale.set(span * 6, span * 6, 1);
      controls.target.set(0, 0, H * 0.3);
      if (refit) camera.position.set(-span * 0.35, span * 0.25, span * 2.2);
    } else {
      group.rotation.set(-Math.PI / 2, 0, 0);
      group.position.set(0, 0, 0);
      ground.rotation.set(-Math.PI / 2, 0, 0);
      ground.position.set(0, -0.05, 0);
      ground.scale.set(s === 'bed' ? Math.max(260, span * 1.3) : span * 6, s === 'bed' ? Math.max(260, span * 1.3) : span * 6, 1);
      controls.target.set(0, H * 0.3, 0);
      if (refit) camera.position.set(-span * 0.25, span * 1.25, span * 1.45);
    }
    camera.near = span / 100; camera.far = span * 40; camera.updateProjectionMatrix();
    controls.update();
    placeSun();
  }
  function placeSun() {
    const { sun, size } = R;
    const span = Math.max(size.x, size.y) * 1.2;
    const a = (+$('prSun').value * Math.PI) / 180;
    if (scene === 'wall') sun.position.set(Math.cos(a) * span * 1.1, Math.sin(a) * span * 0.9 + span * 0.45, span * 0.6); // Streiflicht -> plastische Schatten
    else sun.position.set(Math.cos(a) * span, span * 1.4, -Math.sin(a) * span);
    sun.target.position.set(0, 0, 0);
    const c = sun.shadow.camera;
    c.left = c.bottom = -span; c.right = c.top = span; c.near = 1; c.far = span * 6;
    c.updateProjectionMatrix();
    R.render();
  }

  function stats(pos, col, palette) {
    let vol = 0, area = 0;
    const per = new Float64Array(palette.length + 1);
    for (let o = 0; o < pos.length; o += 9) {
      const ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3] - ax, by = pos[o + 4] - ay, bz = pos[o + 5] - az, cx = pos[o + 6] - ax, cy = pos[o + 7] - ay, cz = pos[o + 8] - az;
      vol += (ax * (pos[o + 4] * pos[o + 8] - pos[o + 5] * pos[o + 7]) - ay * (pos[o + 3] * pos[o + 8] - pos[o + 5] * pos[o + 6]) + az * (pos[o + 3] * pos[o + 7] - pos[o + 4] * pos[o + 6])) / 6;
      const a = Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) / 2;
      area += a;
      per[Math.min(col[o / 9], palette.length)] += a;
    }
    // grob: Hülle ~0,9 mm dick, Rest 15 % Füllung, PLA 1,24 g/cm³
    const shell = Math.min(vol, area * 0.9), g = ((shell + (vol - shell) * 0.15) / 1000) * 1.24;
    return { vol, g, per, area };
  }

  async function open({ pos, col, palette, name = '', decor = [], mainTris = 0 }) {
    dlg.hidden = false;
    init();
    $('prName').textContent = name ? '– ' + name : '';
    $('prBusy').hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    cur = { pos, col, palette, name, decor, mainTris };
    setModel(pos, col, palette);
    R.resize();
    setScene(scene);
    const st = stats(pos, col, palette);
    const top = [...st.per].map((a, i) => [a, i]).filter(([a, i]) => a > 0 && palette[i]).sort((p, q) => q[0] - p[0]).slice(0, 4).map(([a, i]) => `${palette[i].name} ${Math.round((a / st.area) * 100)} %`);
    $('prInfo').textContent = `${R.size.x.toFixed(0)} × ${R.size.y.toFixed(0)} × ${R.size.z.toFixed(1)} mm · ca. ${Math.round(st.g)} g Filament (ohne Spülturm) · Fläche: ${top.join(', ')}`;
    $('prBusy').hidden = true;
  }
  const close = () => { dlg.hidden = true; };
  $('prClose').addEventListener('click', close);
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.querySelectorAll('#prScene button').forEach((b) => b.addEventListener('click', () => setScene(b.dataset.s)));
  $('prLayer').addEventListener('change', () => { uniforms.uLayer.value = +$('prLayer').value; R.render(); });
  $('prLines').addEventListener('change', () => { uniforms.uLines.value = $('prLines').checked ? 1 : 0; R.render(); });
  $('prSun').addEventListener('input', placeSun);
  $('prDeco').addEventListener('change', () => { setDeco(cur.decor || [], $('prDeco').checked && scene !== 'bed'); R.render(); });
  $('prSave').addEventListener('click', () => {
    const { renderer } = R;
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(Math.max(2, pr));
    R.resize();
    renderer.domElement.toBlob((b) => {
      app.download(b, (cur.name || 'Modell').replace(/[\\/:*?"<>|]+/g, '_') + '_Druckvorschau.png');
      renderer.setPixelRatio(pr);
      R.resize();
    }, 'image/png');
  });
  return { open, isOpen: () => !dlg.hidden, close, _setScene: (s) => setScene(s) };
}
