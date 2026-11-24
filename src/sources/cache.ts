/**
 * IndexedDB cache shared by every source adapter. The runtime area assembler
 * is the system of record; this cache is what makes re-visits instant and the
 * app survive offline. Entries carry their own expiry.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "niyvaru";
const DB_VERSION = 3;
const PACKS = "packs";
const KV = "kv";
const MEM_FILES = "mem_files";
const MEM_ARCHIVE = "mem_archive";
const MEM_CHAT = "mem_chat";

interface KvRecord {
  key: string;
  value: unknown;
  expiresAt: number;
}

interface MemFileRecord {
  path: string;
  content: string;
  updatedAt: number;
}
interface MemArchiveRecord {
  id: string;
  path: string;
  content: string;
  archivedAt: number;
}
interface MemChatRecord {
  seq?: number;
  role: string;
  content: string;
  at: number;
}

interface NiyvaruDB extends DBSchema {
  packs: { key: string; value: unknown };
  kv: { key: string; value: KvRecord };
  mem_files: { key: string; value: MemFileRecord };
  mem_archive: { key: string; value: MemArchiveRecord; indexes: { archivedAt: number } };
  mem_chat: { key: number; value: MemChatRecord };
}

let dbPromise: Promise<IDBPDatabase<NiyvaruDB>> | null = null;

/** Single origin database: area packs + caches + the agent's memory. */
export function db(): Promise<IDBPDatabase<NiyvaruDB>> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database, _old, _new, _tx) {
        if (!database.objectStoreNames.contains(PACKS)) database.createObjectStore(PACKS);
        if (!database.objectStoreNames.contains(KV)) database.createObjectStore(KV);
        if (!database.objectStoreNames.contains(MEM_FILES)) database.createObjectStore(MEM_FILES);
        if (!database.objectStoreNames.contains(MEM_ARCHIVE)) {
          const store = database.createObjectStore(MEM_ARCHIVE, { keyPath: "id" });
          store.createIndex("archivedAt", "archivedAt");
        }
        if (!database.objectStoreNames.contains(MEM_CHAT)) {
          database.createObjectStore(MEM_CHAT, { keyPath: "seq", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export { MEM_FILES, MEM_ARCHIVE, MEM_CHAT };

/** Ask for persistent storage once — exempts us from pressure eviction. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* not granted — memory export and PWA install remain the safety net */
  }
  return false;
}

export async function savePack(packId: string, pack: unknown): Promise<void> {
  const d = await db();
  await d.put(PACKS, pack, packId);
}

export async function loadPack(packId: string): Promise<unknown | undefined> {
  const d = await db();
  return (await d.get(PACKS, packId)) as unknown | undefined;
}

export async function deletePack(packId: string): Promise<void> {
  const d = await db();
  await d.delete(PACKS, packId);
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const d = await db();
  const hit = await d.get(KV, key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await producer();
  await d.put(KV, { key, value, expiresAt: Date.now() + ttlMs } satisfies KvRecord, key);
  return value;
}

/**
 * Cache only results worth keeping. A transient outage must not be remembered
 * as authoritative for hours, or every later visit repeats the slow path.
 */
export async function cachedWhen<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
  keep: (value: T) => boolean
): Promise<T> {
  const d = await db();
  const hit = await d.get(KV, key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await producer();
  if (keep(value)) {
    await d.put(KV, { key, value, expiresAt: Date.now() + ttlMs } satisfies KvRecord, key);
  }
  return value;
}

/** Fire-and-forget refresh: return the cache, then update it in the background. */
export async function cachedWithRefresh<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const d = await db();
  const hit = await d.get(KV, key);
  if (hit && hit.expiresAt > Date.now()) {
    void producer()
      .then((fresh) => d.put(KV, { key, value: fresh, expiresAt: Date.now() + ttlMs } satisfies KvRecord, key))
      .catch(() => {});
    return hit.value as T;
  }
  return cached(key, ttlMs, producer);
}

export async function clearEverything(): Promise<void> {
  const d = await db();
  await d.clear(PACKS);
  await d.clear(KV);
  await d.clear(MEM_FILES);
  await d.clear(MEM_ARCHIVE);
  await d.clear(MEM_CHAT);
}
