/**
 * Core memory blocks — the small, always-in-context slice the agent reads
 * and edits itself. Assembly respects the policy token budget; oversized
 * blocks are trimmed, never silently dropped.
 */
import { memoryPolicy } from "../config/memory-policy";
import { listFiles, readFile } from "./store";

function trimToCap(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap - 24)}\n\n[trimmed to policy cap — keep blocks concise]`;
}

export interface CoreBlock {
  label: string;
  description: string;
  content: string;
  chars: number;
}

export async function coreBlocks(): Promise<CoreBlock[]> {
  const traveller = await readFile("/memories/traveller.md");
  const trip = await readFile("/memories/trip.md");
  const blocks: CoreBlock[] = [
    {
      label: "traveller",
      description: "Who the traveller is. Edit when you learn durable facts (party, ages, mobility, budget, language, needs).",
      content: trimToCap(
        traveller?.content ?? memoryPolicy.files.seeded[0].initial,
        memoryPolicy.coreBlocks.caps.traveller
      ),
      chars: traveller?.content.length ?? 0,
    },
    {
      label: "trip",
      description: "The working case file for the current area and dates. Keep current: candidates considered, rejected + why, decisions.",
      content: trimToCap(trip?.content ?? memoryPolicy.files.seeded[1].initial, memoryPolicy.coreBlocks.caps.trip),
      chars: trip?.content.length ?? 0,
    },
  ];
  return blocks;
}

function formatBlocks(blocks: CoreBlock[]): string {
  return blocks
    .map(
      (b) =>
        `<memory_block label="${b.label}">\n${b.content.trim()}\n</memory_block> (cap ${memoryPolicy.coreBlocks.caps[b.label]} chars — edit with the memory tool)`
    )
    .join("\n\n");
}

async function directoryListing(): Promise<string> {
  const files = await listFiles();
  return files.map((f) => `${f.content.length} chars  ${f.path}`).join("\n");
}

export interface MemoryContext {
  text: string;
  approxTokens: number;
}

/**
 * The memory slice injected into every system prompt: core blocks + the
 * memory directory + a retrieval hint. Budget-checked against the policy.
 */
export async function assembleMemoryContext(): Promise<MemoryContext> {
  const blocks = formatBlocks(await coreBlocks());
  const listing = await directoryListing();
  const budgetChars = memoryPolicy.contextBudgetTokens * 4;
  let text = `<memory>\n${blocks}\n\n<memory_directory>\n${listing}\n(retrieve older detail with the memory tool: view / search the archive)\n</memory_directory>\n</memory>`;
  if (text.length > budgetChars) {
    text = trimToCap(text, budgetChars);
  }
  return { text, approxTokens: Math.ceil(text.length / 4) };
}
