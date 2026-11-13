// Import/Export: STL, OBJ, 3MF (mit Mehrfarb-Bemalung im Format von
// Anycubic Slicer Next / OrcaSlicer / Bambu Studio / PrusaSlicer) sowie ZIP.

// ---------------- STL ----------------
export function parseSTL(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const pos = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return pos;
    }
  }
  const text = new TextDecoder().decode(buf);
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length < 9) throw new Error('Keine Dreiecke in der STL-Datei gefunden.');
  return Float32Array.from(vals.slice(0, vals.length - (vals.length % 9)));
}

export function writeSTL(pos) {
  const n = pos.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) dv.setFloat32(o + k * 4, pos[t * 9 + k], true);
  }
  dv.setUint32(80, n, true);
  return buf;
}

// ---------------- OBJ ----------------
export function parseOBJ(text) {
  const v = [], out = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const ids = p.slice(1).map((s) => {
        let i = parseInt(s.split('/')[0], 10);
        return i < 0 ? v.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < ids.length; k++) {
        for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(v[3 * i], v[3 * i + 1], v[3 * i + 2]);
      }
    }
  }
  if (!out.length) throw new Error('Keine Flächen in der OBJ-Datei gefunden.');
  return Float32Array.from(out);
}

// ---------------- Bemalungs-Kodierung (TriangleSelector) ----------------
// state 0 = unbemalt, 1 = Filament 1, 2 = Filament 2, ...
export function encodePaint(state) {
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  const nib = [0xC];
  let n = state - 3;
  for (; n >= 15; n -= 15) nib.push(15);
  nib.push(n);
  return nib.reverse().map((x) => x.toString(16).toUpperCase()).join('');
}

// Liefert den häufigsten Zustand der (evtl. unterteilten) Dreiecksbemalung
export function decodePaint(str) {
  if (!str) return 0;
  const bits = [];
  for (let i = str.length - 1; i >= 0; i--) {
    const v = parseInt(str[i], 16);
    if (isNaN(v)) continue;
    bits.push(v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1);
  }
  let p = 0;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= (bits[p++] || 0) << i; return v; };
  const tally = new Map();
  const walk = (depth) => {
    if (p >= bits.length || depth > 30) return;
    const sides = read(2);
    if (sides > 0) {
      read(2);
      for (let c = 0; c <= sides; c++) walk(depth + 1);
    } else {
      let s = read(2);
      if (s === 3) { for (;;) { const v = read(4); s += v; if (v !== 15 || p >= bits.length) break; } }
      tally.set(s, (tally.get(s) || 0) + Math.pow(0.25, depth));
    }
  };
  walk(0);
  let best = 0, bw = -1;
  for (const [s, w] of tally) if (w > bw) { bw = w; best = s; }
  return best;
}

// ---------------- CRC32 / ZIP ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(chunks) {
  let c = 0xffffffff;
  for (const d of chunks) for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function streamBytes(chunks, transform) {
  const stream = new Blob(chunks).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// files: [{name, data: Uint8Array | Uint8Array[]}] -> Blob (ZIP, Deflate)
export async function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const chunks = Array.isArray(f.data) ? f.data : [f.data];
    const size = chunks.reduce((s, c) => s + c.length, 0);
    const crc = crc32(chunks);
    let data = await streamBytes(chunks, new CompressionStream('deflate-raw'));
    let method = 8;
    if (data.length >= size) { data = null; method = 0; }
    const csize = data ? data.length : size;
    const name = enc.encode(f.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, csize, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, ...(data ? [data] : chunks));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, csize, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + csize;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export async function readZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Keine gültige ZIP/3MF-Datei.');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    const dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(dstart, dstart + csize);
    files[name] = { method, raw };
  }
  return {
    names: Object.keys(files),
    async get(name) {
      const f = files[name];
      if (!f) return null;
      if (f.method === 0) return f.raw;
      return streamBytes([f.raw], new DecompressionStream('deflate-raw'));
    },
  };
}

// ---------------- 3MF Export ----------------
const fmt = (x) => {
  const s = (Math.round(x * 1e5) / 1e5).toString();
  return s === '-0' ? '0' : s;
};

// mesh: PaintMesh, palette: [{name,color}]
// parts: optional {id: Teil je Dreieck, count} – dann wird jedes Teil ein eigenes Objekt (im Slicer einzeln anordnen)
export async function export3MF(mesh, palette, { offset = [128, 128, 0], name = 'Modell', parts = null } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  const w = (s) => { buf.push(s); bufLen += s.length; if (bufLen > 1 << 20) { chunks.push(enc.encode(buf.join(''))); buf = []; bufLen = 0; } };
  const xmlName = name.replace(/[<>&"]/g, '_');
  w('<?xml version="1.0" encoding="UTF-8"?>\n');
  w('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">\n');
  w(' <metadata name="Application">STL-Farbeditor</metadata>\n');
  w(` <metadata name="Title">${xmlName}</metadata>\n`);
  w(' <resources>\n');
  const v = mesh.verts, idx = mesh.idx, col = mesh.col;
  const codes = [];
  for (let s = 0; s < 32; s++) codes.push(encodePaint(s + 1));
  const groups = [];
  if (parts && parts.count > 1) {
    const lists = Array.from({ length: parts.count }, () => []);
    for (let t = 0; t < mesh.n; t++) lists[parts.id[t]].push(t);
    lists.forEach((l) => groups.push(l));
  } else {
    groups.push(null);
  }
  const map = new Int32Array(mesh.nv).fill(-1);
  groups.forEach((tris, gi) => {
    const oname = groups.length > 1 ? `${xmlName} – Teil ${gi + 1}` : xmlName;
    w(`  <object id="${gi + 1}" name="${oname}" type="model">\n   <mesh>\n    <vertices>\n`);
    const nt = tris ? tris.length : mesh.n;
    let nv = 0;
    const used = [];
    for (let k = 0; k < nt; k++) {
      const t = tris ? tris[k] : k;
      for (let j = 0; j < 3; j++) {
        const i = idx[3 * t + j];
        if (map[i] < 0) { map[i] = nv++; used.push(i); w(`     <vertex x="${fmt(v[3 * i])}" y="${fmt(v[3 * i + 1])}" z="${fmt(v[3 * i + 2])}"/>\n`); }
      }
    }
    w('    </vertices>\n    <triangles>\n');
    for (let k = 0; k < nt; k++) {
      const t = tris ? tris[k] : k;
      const a = map[idx[3 * t]], b = map[idx[3 * t + 1]], c = map[idx[3 * t + 2]];
      if (a === b || b === c || a === c) continue; // degenerierte Dreiecke weglassen
      const code = codes[col[t]];
      w(`     <triangle v1="${a}" v2="${b}" v3="${c}" paint_color="${code}" slic3rpe:mmu_segmentation="${code}"/>\n`);
    }
    w('    </triangles>\n   </mesh>\n  </object>\n');
    for (const i of used) map[i] = -1;
  });
  w(' </resources>\n <build>\n');
  groups.forEach((_, gi) => w(`  <item objectid="${gi + 1}" transform="1 0 0 0 1 0 0 0 1 ${offset.join(' ')}" printable="1"/>\n`));
  w(' </build>\n</model>\n');
  chunks.push(enc.encode(buf.join('')));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="json" ContentType="application/json"/>
</Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
  const meta = JSON.stringify({ app: 'STL-Farbeditor', palette }, null, 1);
  return makeZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: chunks },
    { name: 'Metadata/stl_farbeditor.json', data: enc.encode(meta) },
  ]);
}

// ---------------- 3MF Import ----------------
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseTransform(s) {
  if (!s) return IDENT;
  const a = s.trim().split(/\s+/).map(Number);
  return a.length === 12 ? a : IDENT;
}
// p' = p * M  (3MF-Konvention: Zeilenvektor)
function mulT(A, B) { // erst A, dann B
  const r = new Array(12);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j] + (i === 3 ? B[9 + j] : 0);
    }
  }
  return r;
}

export async function parse3MF(buf) {
  const zip = await readZip(buf);
  const dec = new TextDecoder();
  const models = {};
  for (const n of zip.names) {
    if (n.toLowerCase().endsWith('.model')) {
      const xml = dec.decode(await zip.get(n));
      models['/' + n.replace(/^\//, '')] = new DOMParser().parseFromString(xml, 'application/xml');
    }
  }
  let rootPath = '/3D/3dmodel.model';
  if (!models[rootPath]) rootPath = Object.keys(models)[0];
  if (!rootPath) throw new Error('3MF enthält kein Modell.');
  let palette = null;
  if (zip.names.includes('Metadata/stl_farbeditor.json')) {
    try { palette = JSON.parse(dec.decode(await zip.get('Metadata/stl_farbeditor.json'))).palette; } catch { /* ignorieren */ }
  }
  const objects = {};
  for (const [path, doc] of Object.entries(models)) {
    for (const o of doc.getElementsByTagNameNS('*', 'object')) objects[path + '#' + o.getAttribute('id')] = o;
  }
  const pos = [], col = [];
  let maxState = 0;
  const emit = (path, id, T, depth) => {
    const o = objects[path + '#' + id];
    if (!o || depth > 16) return;
    const mesh = o.getElementsByTagNameNS('*', 'mesh')[0];
    if (mesh) {
      const vs = mesh.getElementsByTagNameNS('*', 'vertex');
      const V = new Float64Array(vs.length * 3);
      for (let i = 0; i < vs.length; i++) {
        const x = +vs[i].getAttribute('x'), y = +vs[i].getAttribute('y'), z = +vs[i].getAttribute('z');
        V[3 * i] = x * T[0] + y * T[3] + z * T[6] + T[9];
        V[3 * i + 1] = x * T[1] + y * T[4] + z * T[7] + T[10];
        V[3 * i + 2] = x * T[2] + y * T[5] + z * T[8] + T[11];
      }
      for (const tr of mesh.getElementsByTagNameNS('*', 'triangle')) {
        for (const a of ['v1', 'v2', 'v3']) { const i = +tr.getAttribute(a); pos.push(V[3 * i], V[3 * i + 1], V[3 * i + 2]); }
        const s = decodePaint(tr.getAttribute('paint_color') || tr.getAttribute('slic3rpe:mmu_segmentation'));
        if (s > maxState) maxState = s;
        col.push(s > 0 ? s - 1 : 0);
      }
    }
    for (const c of o.getElementsByTagNameNS('*', 'component')) {
      let p = path;
      for (const at of c.attributes) if (at.localName === 'path') p = '/' + at.value.replace(/^\//, '');
      emit(p, c.getAttribute('objectid'), mulT(parseTransform(c.getAttribute('transform')), T), depth + 1);
    }
  };
  const root = models[rootPath];
  const items = root.getElementsByTagNameNS('*', 'item');
  if (items.length) for (const it of items) emit(rootPath, it.getAttribute('objectid'), parseTransform(it.getAttribute('transform')), 0);
  else for (const k of Object.keys(objects)) if (k.startsWith(rootPath + '#')) emit(rootPath, k.split('#')[1], IDENT, 0);
  if (!pos.length) throw new Error('Keine Dreiecke in der 3MF-Datei gefunden.');
  return { pos: Float32Array.from(pos), col: Uint8Array.from(col), maxSlot: Math.max(0, maxState - 1), palette };
}
