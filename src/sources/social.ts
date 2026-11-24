/**
 * Social pulse — Bluesky Jetstream (public WebSocket, no auth, JSON) and
 * Mastodon public hashtag timelines. Every item is organic and attributed;
 * promoted items enter through the feed registry, never here.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { AreaMeta, PulseItem } from "./types";

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** One-shot recent pull from Mastodon hashtag timelines (instances are config; CORS varies). */
export async function mastodonRecent(meta: AreaMeta, limit = 10, signal?: AbortSignal): Promise<PulseItem[]> {
  const tags = meta.feeds?.hashtags ?? [meta.name];
  const key = `mastodon:${meta.id}:${tags.join(",")}`;
  return cached(key, 10 * 60_000, async () => {
    const results = await Promise.allSettled(
      endpoints.social.mastodon.flatMap((instance) =>
        tags.slice(0, 2).map(async (tag) => {
          const res = await fetch(
            `${instance}/api/v1/timelines/tag/${encodeURIComponent(tag.replace(/^#/, ""))}?limit=${limit}`,
            { headers: { Accept: "application/json" }, signal }
          );
          if (!res.ok) throw new Error(`mastodon ${res.status}`);
          const json = (await res.json()) as {
            id: string;
            url?: string;
            created_at?: string;
            content?: string;
          }[];
          const host = new URL(instance).host;
          return json.map<PulseItem>((s) => ({
            id: `mastodon/${host}/${s.id}`,
            source: "mastodon",
            kind: "organic",
            title: truncate(stripHtml(s.content ?? "")),
            url: s.url,
            at: s.created_at,
          }));
        })
      )
    );
    return dedupe(results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
  });
}

/**
 * Live Bluesky stream filtered by the area's hashtags. Returns a closer.
 * Jetstream is a public WebSocket — no CORS constraints, no auth.
 */
export function blueskyLive(meta: AreaMeta, onItem: (item: PulseItem) => void): () => void {
  const tags = (meta.feeds?.hashtags ?? [meta.name]).map((t) => t.replace(/^#/, "").toLowerCase());
  const params = new URLSearchParams({ wantedCollections: "app.bsky.feed.post" });
  let ws: WebSocket | null = null;
  let retryTimer: number | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${endpoints.social.jetstream}?${params}`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            commit?: { record?: { text?: string; created_at?: string; tags?: string[] }; rev?: string };
          };
          const record = msg.commit?.record;
          const text = record?.text;
          if (!text) return;
          const lowered = text.toLowerCase();
          const hit = record?.tags?.some((t) => tags.includes(t.replace(/^#/, "").toLowerCase())) ||
            tags.some((t) => lowered.includes(t));
          if (!hit) return;
          onItem({
            id: `bluesky/${msg.commit!.rev ?? crypto.randomUUID()}`,
            source: "bluesky",
            kind: "organic",
            title: truncate(text),
            at: record?.created_at,
          });
        } catch {
          /* malformed frame — ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) retryTimer = window.setTimeout(connect, 15_000);
      };
    } catch {
      /* Jetstream unreachable — the rail still works from the one-shot sources */
    }
  };
  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    ws?.close();
  };
}

function dedupe(items: PulseItem[]): PulseItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
