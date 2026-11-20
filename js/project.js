// Projekte speichern und öffnen (.3dprojekt = ZIP mit Modell, Farben und Karten-Einstellungen).
// In Chrome/Edge wird direkt in die gewählte Datei geschrieben (File System Access API):
// Strg+S speichert danach ohne Rückfrage in dieselbe Datei. Sonst wird heruntergeladen.
// Zusätzlich: automatische Zwischenspeicherung im Browser (IndexedDB) und „Zuletzt bearbeitet“.

import { makeZip, readZip } from './io.js';

export const EXT = '.3dprojekt';
const enc = new TextEncoder(), dec = new TextDecoder();

export async function projectBlob({ name, palette, pos, col, mapProject, extra }) {
  const meta = { app: '3D-Druck-Tool', format: 1, name, palette, savedAt: new Date().toISOString(), tris: col.length, mapProject: mapProject || null, extra: extra || null };
  return makeZip([
    { name: 'projekt.json', data: enc.encode(JSON.stringify(meta)) },
    { name: 'modell/pos.f32', data: new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength) },
    { name: 'modell/col.u8', data: new Uint8Array(col.buffer, col.byteOffset, col.byteLength) },
  ]);
}

export async function readProject(buf) {
  const z = await readZip(buf);
  const meta = JSON.parse(dec.decode(await z.get('projekt.json')));
  if (meta.app !== '3D-Druck-Tool') throw new Error('Keine Projektdatei des 3D-Druck-Tools.');
  const pb = await z.get('modell/pos.f32'), cb = await z.get('modell/col.u8');
  const pos = new Float32Array(pb.slice().buffer);
  const col = new Uint8Array(cb.slice());
  return { ...meta, pos, col };
}

// ---------------------------------------------------------------- IndexedDB
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('3d-druck-tool', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
export async function kvGet(k) {
  const d = await db();
  if (!d) return undefined;
  return new Promise((res) => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } });
}
export async function kvSet(k, v) {
  const d = await db();
  if (!d) return;
  return new Promise((res) => { try { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); } catch { res(); } });
}

// ---------------------------------------------------------------- Speichern
export const canSaveDirect = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export async function saveTo(handle, blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}
export async function pickSaveHandle(name) {
  return window.showSaveFilePicker({ suggestedName: name.replace(/[\\/:*?"<>|]+/g, '_') + EXT, types: [{ description: '3D-Druck-Tool-Projekt', accept: { 'application/x-3dprojekt': [EXT] } }] });
}

export async function addRecent(entry) {
  const list = (await kvGet('recent')) || [];
  const out = [entry, ...list.filter((e) => e.name !== entry.name)].slice(0, 6);
  await kvSet('recent', out);
}
export async function recentList() { return (await kvGet('recent')) || []; }
