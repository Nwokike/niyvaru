import type { AreaPack, PackIndex } from "./types";

const DB_NAME = "niyvaru";
const STORE = "packs";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPackIndex(): Promise<PackIndex> {
  const res = await fetch("/packs/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`pack index failed: ${res.status}`);
  return (await res.json()) as PackIndex;
}

/**
 * Load an area pack on demand, cache it in IndexedDB, and refresh it if the
 * published version is newer. This is the "download the neighbourhood when the
 * traveller picks a place" behaviour — the files are static, so it works on
 * GitHub Pages and needs no server.
 */
export async function loadPack(areaId: string, index: PackIndex): Promise<AreaPack> {
  const meta = index.areas.find((a) => a.id === areaId);
  if (!meta) throw new Error(`unknown area: ${areaId}`);
  const cacheKey = `pack:${areaId}`;
  const cached = await idbGet<AreaPack & { version: string }>(cacheKey);
  if (cached && cached.version === index.version) return cached;

  const res = await fetch(`/packs/${meta.file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`pack fetch failed: ${res.status}`);
  const pack = (await res.json()) as AreaPack;
  await idbSet(cacheKey, pack);
  return pack;
}

export async function cachedPack(areaId: string): Promise<AreaPack | undefined> {
  return idbGet<AreaPack>(`pack:${areaId}`);
}
