/**
 * Memory policy — data, not behaviour. The agent operates under these rules;
 * changing them never touches agent or tool code.
 */

export interface MemoryPolicy {
  /** Core blocks are always in the model's context; caps keep the budget honest. */
  coreBlocks: {
    /** Block label → character cap (roughly chars/4 = tokens). */
    caps: Record<string, number>;
  };
  /** Memory files the agent may maintain (paths under /memories). */
  files: {
    seeded: { path: string; description: string; initial: string }[];
    /** Per-file character cap; the tool refuses writes beyond it and says so. */
    charCaps: Record<string, number>;
  };
  /** What "delete" means. Nothing the agent does is destructive: */
  deleteMode: "archive";
  /** Archive retention: entries older than this are summarised, not silently dropped. */
  archive: {
    summariseAfterEntries: number;
    keepEntries: number;
  };
  /** Chat turns kept verbatim in the model's per-step context (enforced by
   *  the agent runtime's prepareStep). The UI may show more history than this. */
  chatWindowTurns: number;
  /** Token budget for the whole memory slice injected per turn. */
  contextBudgetTokens: number;
}

export const memoryPolicy: MemoryPolicy = {
  coreBlocks: {
    caps: {
      traveller: 1200,
      trip: 1600,
    },
  },
  files: {
    seeded: [
      {
        path: "/memories/traveller.md",
        description: "Who the traveller is: party, ages, mobility, budget, language, needs.",
        initial: "# Traveller\n\n(nothing recorded yet)\n",
      },
      {
        path: "/memories/trip.md",
        description: "The working case file: dates, area, candidates considered/rejected and why, decisions.",
        initial: "# Trip\n\n(nothing recorded yet)\n",
      },
      {
        path: "/memories/journal.md",
        description: "Dated log of what happened across sessions. Append, never rewrite history.",
        initial: "# Journal\n",
      },
      {
        path: "/memories/places.md",
        description: "Notes about specific places the traveller cared about, keyed by place id.",
        initial: "# Places\n",
      },
    ],
    charCaps: {
      "/memories/traveller.md": 4000,
      "/memories/trip.md": 6000,
      "/memories/journal.md": 20000,
      "/memories/places.md": 12000,
    },
  },
  deleteMode: "archive",
  archive: {
    summariseAfterEntries: 120,
    keepEntries: 60,
  },
  chatWindowTurns: 8,
  contextBudgetTokens: 2600,
};
