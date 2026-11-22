/**
 * The memory tool — the agent manages its own memory directory.
 * Command set follows the public Anthropic memory-tool specification
 * (view / create / str_replace / insert / rename / delete) with one policy
 * difference: "delete" archives — the agent can never truly destroy anything.
 * Behavioural rules live in memoryPolicy, not here.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  deleteFile,
  listFiles,
  readFile,
  renameFile,
  searchArchive,
  writeFile,
  insertArchiveNote,
} from "./store";

const MEMORY_DESCRIPTION = `Use this tool to maintain durable traveller memory in files under /memories.

When to write:
- Learn something durable about the traveller (party, ages, mobility needs, budget, language, preferences) → update /memories/traveller.md.
- Dates, the area being explored, candidate places considered or rejected (with reasons), decisions → keep /memories/trip.md current as the working case file.
- Anything worth a dated record of what happened → append a line to /memories/journal.md (append, do not rewrite).
- Notes about specific places (by place id) → /memories/places.md.

Commands:
- view {path}: file contents (with line numbers), or a directory listing when path is the root.
- create {path, file_text}: create or overwrite a file.
- str_replace {path, old_str, new_str}: replace exact text (old_str must appear exactly once).
- insert {path, insert_line, insert_text}: insert text after a line (0 = top). Great for journal appends.
- rename {old_path, new_path}: move/rename a file.
- delete {path}: the file moves to the archive — nothing is ever destroyed.
- archival note: use create on /memories/journal.md with insert, or write an archived note via delete-free flows.

Keep files concise: each file has a character cap and oversized writes are refused.`;

const inputSchema = z.object({
  command: z.enum(["view", "create", "str_replace", "insert", "rename", "delete", "search"]),
  path: z.string().describe("A path under /memories, or the root '/memories' to list."),
  file_text: z.string().optional().describe("Full file content for create."),
  old_str: z.string().optional().describe("Exact text to replace in str_replace."),
  new_str: z.string().optional().describe("Replacement text (omitting it deletes old_str)."),
  insert_line: z.number().int().optional().describe("Line after which to insert (0 = top)."),
  insert_text: z.string().optional().describe("Text to insert."),
  new_path: z.string().optional().describe("Destination for rename."),
  query: z.string().optional().describe("Search term for command=search."),
});

type MemoryInput = z.infer<typeof inputSchema>;

function withLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3, " ")}  ${line}`)
    .join("\n");
}

async function run(input: MemoryInput): Promise<string> {
  const { command, path } = input;
  try {
    switch (command) {
      case "view": {
        if (!path || path === "/memories" || path === "/memories/") {
          const files = await listFiles();
          const listing = files.map((f) => `${f.content.length} chars  ${f.path}`).join("\n");
          return `Files in /memories:\n${listing}\n\nArchived versions: ${(await searchArchive()).length}`;
        }
        const file = await readFile(path);
        if (!file) return `Error: the path ${path} does not exist.`;
        return withLineNumbers(file.content);
      }
      case "create": {
        if (!path || input.file_text == null) return "Error: create needs path and file_text.";
        const result = await writeFile(path, input.file_text);
        return result.ok
          ? `File written successfully at: ${path}`
          : `Error: ${result.note}`;
      }
      case "str_replace": {
        if (!path || input.old_str == null) return "Error: str_replace needs path and old_str.";
        const file = await readFile(path);
        if (!file) return `Error: the path ${path} does not exist.`;
        const occurrences = file.content.split(input.old_str).length - 1;
        if (occurrences === 0) {
          return `No replacement was performed, old_str did not appear verbatim in ${path}.`;
        }
        if (occurrences > 1) {
          return `No replacement was performed. old_str appears ${occurrences} times in ${path} — make it unique.`;
        }
        const next = file.content.replace(input.old_str, input.new_str ?? "");
        const result = await writeFile(path, next);
        return result.ok
          ? `The memory file has been edited.\n${withLineNumbers(next.split("\n").slice(0, 40).join("\n"))}`
          : `Error: ${result.note}`;
      }
      case "insert": {
        if (!path || input.insert_text == null || input.insert_line == null) {
          return "Error: insert needs path, insert_line and insert_text.";
        }
        const file = await readFile(path);
        const lines = file ? file.content.split("\n") : [];
        if (file && (input.insert_line < 0 || input.insert_line > lines.length)) {
          return `Error: invalid insert_line. The file has ${lines.length} lines.`;
        }
        const existing = file?.content ?? "";
        const merged = file
          ? [...lines.slice(0, input.insert_line), input.insert_text, ...lines.slice(input.insert_line)].join("\n")
          : input.insert_text;
        const result = await writeFile(path, merged || existing);
        return result.ok ? `The file ${path} has been edited.` : `Error: ${result.note}`;
      }
      case "rename": {
        if (!path || !input.new_path) return "Error: rename needs path and new_path.";
        await renameFile(path, input.new_path);
        return `Successfully renamed ${path} → ${input.new_path}`;
      }
      case "delete": {
        if (!path) return "Error: delete needs a path.";
        const result = await deleteFile(path);
        return `Removed ${path} (policy: ${result.mode}) — the content is preserved in the archive, never destroyed.`;
      }
      case "search": {
        const hits = (await searchArchive()).filter((e) =>
          input.query ? e.content.toLowerCase().includes(input.query.toLowerCase()) : true
        );
        if (!hits.length) return "No archived entries matched.";
        return hits
          .slice(0, 10)
          .map((h) => `${new Date(h.archivedAt).toISOString().slice(0, 10)}  ${h.path}\n${h.content.slice(0, 300)}`)
          .join("\n---\n");
      }
      default:
        return `Error: unknown command "${command}".`;
    }
  } catch (e) {
    return `Error: ${String((e as Error)?.message ?? e)}`;
  }
}

export const memoryTool = tool({
  description: MEMORY_DESCRIPTION,
  inputSchema,
  execute: run as (input: MemoryInput) => Promise<string>,
});

/** Archival note helper for the agent's journal-style inserts (non-tool path). */
export const noteToArchive = insertArchiveNote;
