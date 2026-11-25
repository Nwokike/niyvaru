import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { DirectChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { NiyvaruAgent } from "../agent/runtime";
import type { Dictionary } from "../config/i18n";

/**
 * Model text arrives with whatever formatting the provider chose. Two things
 * leak through raw if we render it verbatim: literal `\n` sequences from weak
 * models, and markdown emphasis. Normalise both, then render a small safe
 * subset (bold / italic / code). Everything else stays plain text.
 */
function renderText(raw: string): ReactNode {
  const text = raw
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\(["'\\])/g, "$1");
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * The conversation — the agent drives the map through typed tools; tool
 * activity renders as brand chips so the traveller always sees what the
 * concierge is doing, not a black box.
 */
export function ChatPanel({
  d,
  agent,
  greeting,
  suggestions,
  chatLabel,
  prefill,
  prefillNonce,
  onTurnComplete,
  active,
}: {
  d: Dictionary;
  agent: NiyvaruAgent;
  greeting: string;
  suggestions: string[];
  chatLabel: string;
  prefill?: string;
  prefillNonce?: number;
  onTurnComplete: (userText: string, assistantText: string) => void;
  /** False while another surface covers this one; the log stays mounted. */
  active: boolean;
}) {
  const transport = useMemo(
    () =>
      new DirectChatTransport({
        agent,
        // Never a black box: real failure text reaches the chat, not "An error occurred."
        onError: (event) => String((event as Error)?.message ?? event),
      }),
    [agent]
  );
  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    experimental_queue: true,
    onFinish: ({ messages: finished, isAbort, isError, isDisconnect }) => {
      // A failed/aborted turn is not a conversation turn: storing half an
      // answer as memory would teach the concierge its own glitches.
      if (isAbort || isError || isDisconnect) return;
      const lastUser = [...finished].reverse().find((m) => m.role === "user");
      const lastAssistant = [...finished].reverse().find((m) => m.role === "assistant");
      const textOf = (m: (typeof finished)[number] | undefined): string =>
        m?.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(" ") ?? "";
      onTurnComplete(textOf(lastUser), textOf(lastAssistant));
    },
  });
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Scrolling a hidden log measures zero height and would leave the
    // conversation scrolled nowhere when the agent surface reopens.
    if (!active) return;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, status, active]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill);
    inputRef.current?.focus();
  }, [prefill, prefillNonce]);

  const busy = status === "submitted" || status === "streaming";
  const send = (): void => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="chat" aria-label={chatLabel}>
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label={chatLabel}>
        {messages.length === 0 ? (
          <div className="hint">
            <p className="muted" style={{ margin: 0 }}>{greeting}</p>
            <div className="chat-suggestions" style={{ marginTop: "0.625rem" }}>
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => sendMessage({ text: s })}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className="msg" data-role={message.role === "user" ? "user" : "assistant"}>
            {message.role !== "user" ? <span className="avatar">ن</span> : null}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.3rem",
                alignItems: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "100%",
              }}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text" && part.text.trim()) {
                  return (
                    <div key={i} className="bubble">
                      {renderText(part.text)}
                    </div>
                  );
                }
                if (
                  (part.type === "tool-photos_for_place" || part.type === "tool-place_details") &&
                  (part as { state?: string }).state === "output-available"
                ) {
                  const output = (part as { output?: { photos?: { thumb?: string; attribution?: string; license?: string }[] } }).output;
                  const photos = (output?.photos ?? []).filter((p) => p.thumb);
                  if (!photos.length) return null;
                  return (
                    <div key={i} className="chat-photos">
                      {photos.map((p, j) => (
                        <figure key={`${p.thumb}-${j}`}>
                          <img
                            src={p.thumb}
                            alt=""
                            loading="lazy"
                            onError={(e) => (e.currentTarget.parentElement?.style.setProperty("display", "none"))}
                          />
                          <figcaption>{p.attribution}{p.license && p.license !== "unknown" ? ` · ${p.license}` : ""}</figcaption>
                        </figure>
                      ))}
                    </div>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  const state = (part as { state?: string }).state ?? "";
                  const name = part.type.replace("tool-", "").replace(/_/g, " ");
                  return (
                    <span key={i} className="tool-chip">
                      {state === "output-available" ? "✓" : "…"} {name}
                    </span>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="msg" data-role="assistant">
            <span className="avatar">ن</span>
            <div className="bubble typing">{d.explore.thinking}</div>
          </div>
        ) : null}
        {error ? <p className="muted">⚠ {String((error as Error).message ?? error)}</p> : null}
      </div>
      <div className="chat-input">
        <input
          ref={inputRef}
          className="field"
          value={input}
          placeholder={d.explore.askPlaceholder}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          aria-label={d.explore.askPlaceholder}
        />
        {busy ? (
          <button className="btn btn-ghost" onClick={stop} aria-label={d.a11y.stop}>
            ■
          </button>
        ) : (
          <button className="btn btn-bronze" onClick={send} disabled={!input.trim()}>
            {d.explore.send}
          </button>
        )}
      </div>
    </div>
  );
}
