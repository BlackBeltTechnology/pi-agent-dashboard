import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiRefresh, mdiCodeBraces, mdiStop } from "@mdi/js";
import { EditorInstallGuide } from "./EditorInstallGuide.js";
import { useThemeContext } from "./ThemeProvider.js";

interface EditorInfo {
  id: string;
  status: string;
  proxyPath: string;
}

interface Props {
  cwd: string;
  onClose?: () => void;
}

export function EditorView({ cwd, onClose }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "not_found">("loading");
  const [editorInfo, setEditorInfo] = useState<EditorInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Dedup guard: prevents a single tab from firing two concurrent
  // /api/editor/start calls (React StrictMode double-mount, rapid remount,
  // or a heartbeat re-start overlapping the initial start). The server also
  // dedups per-cwd, but suppressing the redundant request here avoids the
  // wasted round-trip and a flash back to the loading state.
  const startInFlightRef = useRef(false);
  const { resolved: themeMode } = useThemeContext();
  const themeModeRef = useRef(themeMode);
  themeModeRef.current = themeMode;

  const startEditor = useCallback(async () => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`${getApiBase()}/api/editor/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, theme: themeModeRef.current }),
      });
      const data = await res.json();

      if (!data.success) {
        if (data.error === "binary_not_found") {
          setState("not_found");
        } else {
          setErrorMsg(data.error || "Failed to start editor");
          setState("error");
        }
        return;
      }

      setEditorInfo(data.data);
      setState("ready");
    } catch (err: any) {
      setErrorMsg(err.message || "Network error");
      setState("error");
    } finally {
      startInFlightRef.current = false;
    }
  }, [cwd]);

  // Start on mount
  useEffect(() => {
    startEditor();
  }, [startEditor]);

  // Heartbeat while mounted and ready
  useEffect(() => {
    if (state !== "ready" || !editorInfo) return;

    const sendHeartbeat = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/editor/${editorInfo.id}/heartbeat`, { method: "POST" });
        const data = await res.json();
        if (!data.success) {
          // Instance gone (server restarted or evicted) — re-start
          startEditor();
        }
      } catch {
        // Network error — ignore, will retry
      }
    };

    // Send immediately, then every 30s
    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, 30_000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [state, editorInfo]);

  // Cleanup heartbeat on unmount
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  // Sync theme when dashboard theme changes while editor is running.
  // Writes settings.json then reloads the iframe — VS Code re-reads settings
  // on load and restores open files/cursor from user-data-dir.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevThemeRef = useRef(themeMode);
  useEffect(() => {
    if (state !== "ready" || !editorInfo) return;
    // Skip the initial mount (theme hasn't changed yet)
    if (prevThemeRef.current === themeMode) return;
    prevThemeRef.current = themeMode;

    fetch(`${getApiBase()}/api/editor/${editorInfo.id}/theme`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeMode }),
    }).then(() => {
      // Reload iframe so VS Code picks up the new settings
      if (iframeRef.current) {
        iframeRef.current.src = iframeRef.current.src;
      }
    }).catch(() => {});
  }, [themeMode, state, editorInfo]);

  const stopEditor = useCallback(async () => {
    if (!editorInfo) return;
    await fetch(`${getApiBase()}/api/editor/${editorInfo.id}/stop`, { method: "POST" }).catch(() => {});
    setEditorInfo(null);
    setState("loading");
    onClose?.();
  }, [editorInfo, onClose]);

  if (state === "not_found") {
    return <EditorInstallGuide onRetry={startEditor} />;
  }

  if (state === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-3">
        <Icon path={mdiLoading} size={1.5} spin className="text-blue-400" />
        <p className="text-sm">Starting code-server...</p>
        <p className="text-xs text-[var(--text-tertiary)]">This usually takes 2-5 seconds</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-4">
        <Icon path={mdiCodeBraces} size={2} className="opacity-30" />
        <p className="text-sm text-red-400">{errorMsg}</p>
        <button
          onClick={startEditor}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm"
        >
          <span className="inline-flex items-center gap-1">
            <Icon path={mdiRefresh} size={0.6} /> Retry
          </span>
        </button>
      </div>
    );
  }

  // Ready — show iframe
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1 flex-shrink-0">
        <div className="text-xs text-[var(--text-muted)] truncate">{cwd}</div>
        <button
          onClick={stopEditor}
          className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors p-1 rounded hover:bg-[var(--bg-surface)]"
          title="Stop code-server"
        >
          <Icon path={mdiStop} size={0.7} />
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={`${getApiBase()}${editorInfo!.proxyPath}`}
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0 }}
        allow="clipboard-read; clipboard-write"
        title={`VS Code — ${cwd}`}
      />
    </div>
  );
}
