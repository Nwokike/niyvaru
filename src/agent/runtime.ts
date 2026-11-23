/**
 * Agent runtime — a ToolLoopAgent running entirely in the browser over the
 * Kiri Gateway, rebuilt per area session and per memory revision so the
 * system prompt always carries the current memory slice and area facts.
 */
import {
  ToolLoopAgent,
  isStepCount,
  hasToolCall,
  type StopCondition,
  type StepResult,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";
import { gatewayModel } from "./gateway";
import { buildSystemPrompt } from "./prompt";
import { createAgentTools, normalizeToolArgs, type AgentContext } from "./tools";
import type { AreaPack } from "../sources/types";
import type { Locale } from "../config/i18n";
import { seedIfEmpty } from "../memory/store";

export type NiyvaruTools = ReturnType<typeof createAgentTools>;
export type NiyvaruAgent = ToolLoopAgent<never, NiyvaruTools>;

/**
 * Tool-call repair for weak open models: fix fence-wrapped or trailing-comma
 * JSON, and rescue hallucinated tool names by fuzzy-matching the real roster.
 */
function repairToolCallForWeakModels<TOOLS extends ToolSet>(): ToolCallRepairFunction<TOOLS> {
  return async ({ toolCall, tools, error }) => {
    if (error.name === "InvalidToolInputError" || error.name === "invalid-tool-input") {
      let input = (error as { toolInput?: string }).toolInput ?? "";
      input = input.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      input = input.replace(/,\s*([}\]])/g, "$1");
      if (input) {
        try {
          JSON.parse(input);
          return { ...toolCall, input };
        } catch {
          return null;
        }
      }
      return null;
    }
    // NoSuchToolError: match the hallucinated name to the closest real tool
    const wanted = String((toolCall as { toolName?: string }).toolName ?? "").toLowerCase();
    const candidates = Object.keys(tools ?? {});
    const hit = candidates.find((name) => name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase()));
    if (hit) return { ...toolCall, toolName: hit, input: (error as { toolInput?: string }).toolInput ?? "" };
    return null;
  };
}

/**
 * Backstop for weak models that re-issue the same read with cosmetic rewrites:
 * stop once the identical (tool name + normalized input) signature repeats in
 * `repeats` consecutive steps. Pure predicate — it never prunes messages and
 * never changes the 12-step ceiling.
 */
function stopAfterRepeatedToolCalls<TOOLS extends ToolSet>(repeats = 3): StopCondition<TOOLS> {
  return ({ steps }) => {
    if (steps.length < repeats) return false;
    const signature = (step: StepResult<TOOLS>): string =>
      step.toolCalls
        .map((call) => `${call.toolName}:${JSON.stringify(normalizeToolArgs(call.input))}`)
        .sort()
        .join("|");
    const recent = steps.slice(-repeats);
    const first = signature(recent[0]);
    return first.length > 0 && recent.every((step) => signature(step) === first);
  };
}

export async function createNiyvaruAgent(
  ctx: AgentContext,
  pack: AreaPack | null
): Promise<NiyvaruAgent> {
  await seedIfEmpty();
  const tools = createAgentTools(ctx);
  // Stable tool order improves provider-side prompt caching on the gateway.
  const toolOrder = Object.keys(tools).sort() as (keyof NiyvaruTools)[];
  return new ToolLoopAgent({
    model: gatewayModel(),
    // Per-step instructions: the memory slice and area facts are re-assembled
    // before every step, so memory the agent writes mid-turn is visible
    // immediately and the context stays trimmed for the 8K window.
    instructions: await buildSystemPrompt(pack, ctx.locale()),
    prepareStep: async () => ({
      instructions: await buildSystemPrompt(ctx.getPack(), ctx.locale()),
    }),
    tools,
    toolOrder,
    toolCallConcurrency: 1,
    // Tools share one map and one memory store — sequential by design.
    stopWhen: [isStepCount(12), hasToolCall("start_walk"), stopAfterRepeatedToolCalls<NiyvaruTools>(3)],
    repairToolCall: repairToolCallForWeakModels<NiyvaruTools>(),
    timeout: { firstChunkMs: 30_000, chunkMs: 20_000, toolMs: 25_000, stepMs: 180_000 },
    temperature: 0.4,
    maxRetries: 1,
  });
}
