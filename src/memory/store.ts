/**
 * Memory store — the agent's own filesystem in the browser.
 * Markdown files with YAML-ish frontmatter, an append-only archive (the agent
 * can never truly destroy anything), and the chat window. All durability
 * rules (caps, retention, delete→archive) come from the policy module.
 */
import { db, MEM_FILES, MEM_ARCHIVE, MEM_CHAT } from "../sources/cache";
import { memoryPolicy } from "../config/memory-policy";

export interface MemoryFile {
  path: string;
  content: string;
  updatedAt: number;
}

export interface ArchiveEntry {
  id: string;
  path: string;
  content: string;
  archivedAt: number;
}

export interface ChatRecord {
  seq?: number;
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
}

const MEMORY_ROOT = "/memories/";

function assertInRoot(path: string): string {
  const normalized = path.startsWith(MEMORY_ROOT) ? path : `${MEMORY_ROOT}${path.replace(/^\//, "")}`;
  if (!normalized.startsWith(MEMORY_ROOT)) throw new Error("memory paths live under /memories");
  return normalized;
}

function charCap(path: string): number {
  return memoryPolicy.files.charCaps[path] ?? 12000;
}

export async function seedIfEmpty(): Promise<void> {
  const d = await db();
  const existing = await d.count(MEM_FILES);
  if (existing > 0) return;
  const now = Date.now();
  for (const file of memoryPolicy.files.seeded) {
    const record = { path: file.path, content: file.initial, updatedAt: now } satisfies MemoryFile;
    await d.put(MEM_FILES, record, record.path);
  }
}

export async function listFiles(): Promise<MemoryFile[]> {
  const d = await db();
  const all = (await d.getAll(MEM_FILES)) as MemoryFile[];
  return all.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readFile(path: string): Promise<MemoryFile | undefined> {
  const d = await db();
  return (await d.get(MEM_FILES, assertInRoot(path))) as MemoryFile | undefined;
}

/** Write (create or overwrite). The previous content is preserved in the archive — never lost. */
export async function writeFile(path: string, content: string): Promise<{ ok: boolean; note?: string }> {
  const full = assertInRoot(path);
  const cap = charCap(full);
  if (content.length > cap) {
    return { ok: false, note: `refused: ${full} is capped at ${cap} characters (write was ${content.length})` };
  }
  const d = await db();
  const previous = (await d.get(MEM_FILES, full)) as MemoryFile | undefined;
  if (previous && previous.content !== content) {
    await archiveEntry(full, previous.content);
  }
  const record = { path: full, content, updatedAt: Date.now() } satisfies MemoryFile;
  await d.put(MEM_FILES, record, record.path);
  return { ok: true };
}

/** Policy-controlled delete: nothing is destroyed — the file moves to the archive. */
export async function deleteFile(path: string): Promise<{ ok: true; mode: typeof memoryPolicy.deleteMode }> {
  const full = assertInRoot(path);
  const d = await db();
  const existing = (await d.get(MEM_FILES, full)) as MemoryFile | undefined;
  if (existing) await archiveEntry(full, existing.content);
  await d.delete(MEM_FILES, full);
  return { ok: true, mode: memoryPolicy.deleteMode };
}

export async function renameFile(oldPath: string, newPath: string): Promise<{ ok: true }> {
  const from = assertInRoot(oldPath);
  const to = assertInRoot(newPath);
  const d = await db();
  const existing = (await d.get(MEM_FILES, from)) as MemoryFile | undefined;
  if (!existing) throw new Error(`${from} does not exist`);
  const clash = await d.get(MEM_FILES, to);
  if (clash) throw new Error(`${to} already exists`);
  await d.delete(MEM_FILES, from);
  const record = { ...existing, path: to, updatedAt: Date.now() } satisfies MemoryFile;
  await d.put(MEM_FILES, record, record.path);
  return { ok: true };
}

async function archiveEntry(path: string, content: string): Promise<void> {
  const d = await db();
  await d.put(MEM_ARCHIVE, {
    id: `${path}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`,
    path,
    content,
    archivedAt: Date.now(),
  } satisfies ArchiveEntry);
}

/** Agent-authored archival note (Letta's archival_memory_insert equivalent). */
export async function insertArchiveNote(path: string, content: string): Promise<void> {
  await archiveEntry(assertInRoot(path), content);
}

export async function searchArchive(): Promise<ArchiveEntry[]> {
  const d = await db();
  const all = (await d.getAll(MEM_ARCHIVE)) as ArchiveEntry[];
  return all.sort((a, b) => b.archivedAt - a.archivedAt);
}

export async function addChatMessage(role: ChatRecord["role"], content: string): Promise<void> {
  const d = await db();
  await d.add(MEM_CHAT, { role, content, at: Date.now() } satisfies ChatRecord);
  // trim beyond the policy window
  const count = await d.count(MEM_CHAT);
  const excess = count - memoryPolicy.chatWindowTurns * 2;
  if (excess > 0) {
    const all = (await d.getAll(MEM_CHAT)) as ChatRecord[];
    const ordered = all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (const record of ordered.slice(0, excess)) {
      await d.delete(MEM_CHAT, record.seq!);
    }
  }
}

export async function recentChat(turns = memoryPolicy.chatWindowTurns): Promise<ChatRecord[]> {
  const d = await db();
  const all = (await d.getAll(MEM_CHAT)) as ChatRecord[];
  const ordered = all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return ordered.slice(-turns * 2);
}

export async function exportMemory(): Promise<unknown> {
  const [files, archive, chat] = await Promise.all([listFiles(), searchArchive(), recentChat(100)]);
  return { exportedAt: new Date().toISOString(), policy: memoryPolicy, files, archive, chat };
}

export async function importMemory(dump: {
  files?: MemoryFile[];
  archive?: ArchiveEntry[];
}): Promise<void> {
  const d = await db();
  for (const file of dump.files ?? []) {
    const path = assertInRoot(file.path);
    const record = { path, content: file.content, updatedAt: file.updatedAt ?? Date.now() } satisfies MemoryFile;
    await d.put(MEM_FILES, record, record.path);
  }
  for (const entry of dump.archive ?? []) {
    await d.put(MEM_ARCHIVE, entry);
  }
}

export async function clearMemory(): Promise<void> {
  const d = await db();
  await d.clear(MEM_FILES);
  await d.clear(MEM_ARCHIVE);
  await d.clear(MEM_CHAT);
  await seedIfEmpty();
}
