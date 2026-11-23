import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DirectChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { NiyvaruAgent } from "../agent/runtime";
import type { Dictionary } from "../config/i18n";

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
  onTurnComplete,
}: {
  d: Dictionary;
  agent: NiyvaruAgent;
  greeting: string;
  suggestions: string[];
  chatLabel: string;
  prefill?: string;
  onTurnComplete: (userText: string, assistantText: string) => void;
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
    onFinish: ({ messages: finished }) => {
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

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill);
    inputRef.current?.focus();
  }, [prefill]);

  const busy = status === "submitted" || status === "streaming";
  const send = (): void => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="chat" aria-label={chatLabel}>
      <div className="chat-log">
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
                      {part.text}
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
          <button className="btn btn-ghost" onClick={stop} aria-label="stop">
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
