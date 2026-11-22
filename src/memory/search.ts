/**
 * Memory retrieval — keyword relevance over the memory files and the
 * append-only archive. At this data scale (tens of KB) a fresh index per
 * query is simpler than index lifecycle management and costs microseconds.
 */
import { create, insert, search } from "@orama/orama";
import { listFiles, searchArchive } from "./store";

export interface MemoryHit {
  ref: string;
  title: string;
  snippet: string;
}

/**
 * Arabic-safe normalization: the built-in Arabic splitter's accepted range
 * excludes tashkeel (U+064B–U+0652) and hamza/alef-madda variants, so vocalized
 * text would shatter into fragments. Strip marks and unify alefs up front.
 */
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652]/g, "") // tashkeel
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // آ أ إ → ا
    .replace(/[\u0649]/g, "\u064A"); // ى → ي
}

export async function searchMemory(term: string, limit = 6): Promise<MemoryHit[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const db = create({ schema: { title: "string", body: "string", ref: "string" } });
  const [files, archive] = await Promise.all([listFiles(), searchArchive()]);
  const docs = [
    ...files.map((f) => ({
      title: f.path,
      body: normalizeArabic(f.content),
      ref: f.path,
    })),
    ...archive.slice(0, 200).map((e) => ({
      title: `${e.path} (archived ${new Date(e.archivedAt).toISOString().slice(0, 10)})`,
      body: normalizeArabic(e.content),
      ref: e.id,
    })),
  ];
  for (const doc of docs) await insert(db, doc);
  const result = await search(db, { term: normalizeArabic(trimmed), limit });
  return result.hits.map((hit) => ({
    ref: String((hit.document as { ref: string }).ref),
    title: String((hit.document as { title: string }).title),
    snippet: String((hit.document as { body: string }).body).slice(0, 400),
  }));
}
