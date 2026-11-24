import { useCallback, useEffect, useRef, useState } from "react";
import { clearMemory, exportMemory, importMemory, listFiles, type MemoryFile } from "../memory/store";
import { requestPersistence } from "../sources/cache";
import type { Dictionary } from "../config/i18n";

/**
 * Memory/Ops — privacy made visible. The traveller sees exactly what the
 * agent remembers, can edit it explicitly, export it, import it, or erase it.
 * Everything lives on this device.
 */
export function MemoryPanel({ d }: { d: Dictionary }) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const importRef = useRef<HTMLInputElement | null>(null);
  const editRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const refresh = useCallback((): void => {
    void listFiles().then(setFiles);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  useEffect(() => {
    refresh();
    const onInstallPrompt = (e: Event): void => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, [refresh]);

  const exportAll = (): void => {
    void exportMemory().then((dump) => {
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `niyvaru-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const importAll = async (file: File): Promise<void> => {
    try {
      await importMemory(JSON.parse(await file.text()));
      setFeedback(d.memory.importSuccess);
      refresh();
    } catch {
      setFeedback(d.memory.importError);
    }
  };

  const saveFile = async (path: string): Promise<void> => {
    await import("../memory/store").then((m) => m.writeFile(path, editing[path] ?? ""));
    setFeedback(d.memory.saved);
    setEditing((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    editRefs.current[path]?.focus();
    refresh();
  };

  return (
    <>
      <div className="panel-card">
        <h3 className="section-title">{d.memory.title}</h3>
        <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>{d.memory.lede}</p>
        <div className="memory-actions">
          <button className="btn btn-ghost" onClick={exportAll}>{d.memory.export}</button>
          <button className="btn btn-ghost" onClick={() => importRef.current?.click()}>{d.memory.import}</button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (window.confirm(d.memory.confirmClear)) void clearMemory().then(refresh);
            }}
          >
            {d.memory.clear}
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importAll(file);
            e.target.value = "";
          }}
        />
        <p className="muted" style={{ marginTop: "0.5rem" }} role="status">
          {persisted ? d.memory.persistent : persisted === false ? d.memory.bestEffort : ""}
          {persisted === false && installEvent ? ` — ${d.memory.install}` : ""}
          {feedback ? ` · ${feedback}` : ""}
        </p>
        {installEvent ? (
          <button
            className="btn btn-bronze"
            style={{ marginTop: "0.5rem" }}
            onClick={() => {
              (installEvent as Event & { prompt?: () => void }).prompt?.();
              setInstallEvent(null);
            }}
          >
            {d.memory.install}
          </button>
        ) : null}
      </div>

      {files.map((file) => (
        <div key={file.path} className="memory-file">
          <div className="memory-file-head">
            <span>{file.path}</span>
            <span>
              {file.content.length} chars · {d.memory.edited.replace("{when}", new Date(file.updatedAt).toLocaleString())}
            </span>
          </div>
          <pre
            contentEditable
            suppressContentEditableWarning
            aria-label={`${d.memory.edit} ${file.path}`}
            onInput={(e) => setEditing((current) => ({ ...current, [file.path]: e.currentTarget.textContent ?? "" }))}
          >
            {file.content}
          </pre>
          <div className="memory-file-actions">
            <button
              ref={(el) => { editRefs.current[file.path] = el; }}
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const isEditing = editing[file.path] !== undefined;
                if (isEditing) void saveFile(file.path);
                else {
                  setEditing((current) => ({ ...current, [file.path]: file.content }));
                  setFeedback("");
                }
              }}
            >
              {editing[file.path] !== undefined ? d.memory.save : d.memory.edit}
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={refresh}>{d.common.retry}</button>
    </>
  );
}
