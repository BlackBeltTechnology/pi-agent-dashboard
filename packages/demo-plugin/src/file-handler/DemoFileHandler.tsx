/**
 * Demo `editor-pane-file-handler` edit component (fixture — e2e only).
 * Plain textarea over the snapshot bytes (UTF-8). Exposes a per-mount instance
 * id + a module-level mount counter so e2e can assert keep-alive (no remount).
 * See change: add-editor-pane-file-handlers (task 6.1; test-plan F1–F3, F11, F12, X9).
 */
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { useEffect, useRef, useState } from "react";

let mountCount = 0;

export function DemoFileHandler(props: FileHandlerProps) {
  const { snapshot, save, setDirty, path } = props;
  const instanceId = useRef<string>("");
  if (!instanceId.current) instanceId.current = Math.random().toString(36).slice(2, 10);
  const [mounts, setMounts] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per mount — a re-render must never re-snapshot over edits.
  useEffect(() => {
    mountCount += 1;
    setMounts(mountCount);
    let alive = true;
    snapshot()
      .then((snap) => {
        if (!alive) return;
        setText(new TextDecoder().decode(snap.bytes));
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (alive) setStatus(`load failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  const doSave = async (target: "overwrite" | "copy") => {
    const bytes = new TextEncoder().encode(text ?? "");
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    setStatus("saving…");
    const r = await save(buf, { target });
    if (r.ok) {
      if (target === "overwrite") setDirty(false);
      setStatus(`saved: ${r.path}`);
    } else {
      setStatus(`${r.reason}: ${r.message}`);
    }
  };

  return (
    <div
      data-testid="demo-file-handler"
      data-instance-id={instanceId.current}
      data-mount-count={mounts}
      data-path={path}
      style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", height: "100%" }}
    >
      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Demo editor (fixture — dev/test only)</div>
      {text === null ? (
        <div data-testid="demo-file-handler-loading">loading…</div>
      ) : (
        <textarea
          data-testid="demo-file-handler-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          style={{ flex: 1, minHeight: "120px", fontFamily: "monospace", fontSize: "12px" }}
        />
      )}
      <div style={{ display: "flex", gap: "6px" }}>
        <button type="button" data-testid="demo-file-handler-save" disabled={text === null} onClick={() => void doSave("overwrite")}>
          Save
        </button>
        <button type="button" data-testid="demo-file-handler-save-copy" disabled={text === null} onClick={() => void doSave("copy")}>
          Save as copy
        </button>
      </div>
      <div data-testid="demo-file-handler-status" style={{ fontSize: "11px" }}>
        {status}
      </div>
    </div>
  );
}
