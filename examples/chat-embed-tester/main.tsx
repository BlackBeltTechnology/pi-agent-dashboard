/**
 * Isolated consumer of `@blackbelt-technology/pi-dashboard-web/chat-embed`.
 *
 * Proves the embed contract end-to-end: connects to a running dashboard
 * (localhost:8000, via the Vite dev proxy), lists its sessions, subscribes to
 * one, folds the live WS stream through `useSessionState`, and mounts the real
 * `<ChatView>` at full fidelity inside the required providers + a bounded-height
 * scroll container.
 *
 * This app imports ONLY the barrel surface + the provider re-exports — exactly
 * what docs/embedding-chat-view.md tells a sibling package to do.
 */
import { createUiPrimitiveRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserToServerMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  ApiContext,
  ChatView,
  DisplayPrefsProvider,
  MobileProvider,
  SessionAssetsProvider,
  ThemeProvider,
  type ToolContext,
  UiPrimitiveProvider,
  useSessionState,
} from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Router } from "wouter";
import "./app.css";

const WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const API_BASE = ""; // same-origin; Vite proxies /api → dashboard.

// Empty primitive registry: ChatView's own rendering (text, thinking, tool
// cards, terminals) never calls useUiPrimitive — only plugin slots do, and this
// app wires no plugin SlotRegistry, so none fire. Kept for the required
// provider contract. Plugin-slot cards degrade to nothing (error-isolated).
const REGISTRY = createUiPrimitiveRegistry();

// undefined global → useDisplayPrefs falls back to defaults (show everything).
const DISPLAY_PREFS = { global: undefined, getSessionOverride: () => undefined };

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, color: "#f88", fontFamily: "monospace" }}>
          ChatView threw: {this.state.err.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function Tester() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const { state, apply, reset } = useSessionState(selected);

  const wsRef = useRef<WebSocket | null>(null);
  // `apply` identity changes with `selected`; the socket handler is bound once,
  // so route through a ref to always call the latest reducer.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("offline");
    ws.onmessage = (ev) => {
      let msg: ServerToBrowserMessage;
      try {
        msg = JSON.parse(ev.data) as ServerToBrowserMessage;
      } catch {
        return;
      }
      // Track the session catalogue for the picker.
      if (msg.type === "sessions_snapshot") setSessions(msg.sessions);
      else if (msg.type === "session_added") setSessions((p) => upsert(p, msg.session));
      else if (msg.type === "session_removed")
        setSessions((p) => p.filter((s) => s.id !== msg.sessionId));
      else if (msg.type === "session_updated")
        setSessions((p) =>
          p.map((s) => (s.id === msg.sessionId ? { ...s, ...msg.updates } : s)),
        );
      // Fold everything else into SessionState (filters by `selected` internally).
      applyRef.current(msg);
    };
    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, []);

  const send = (msg: BrowserToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  function selectSession(id: string) {
    reset();
    setSelected(id);
    // lastSeq:0 → full replay of the session's history, then live events.
    send({ type: "subscribe", sessionId: id, lastSeq: 0 });
  }

  // Live sessions first (most-recently-active on top).
  const liveSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== "ended")
        .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)),
    [sessions],
  );

  // Auto-grab the most-recently-active live session once, on first sight.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!autoPicked.current && !selected && liveSessions.length > 0) {
      autoPicked.current = true;
      selectSession(liveSessions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSessions, selected]);

  const selectedSession = sessions.find((s) => s.id === selected);
  const toolContext: ToolContext = useMemo(
    () => ({ cwd: selectedSession?.cwd, editors: [], sessionId: selected, session: state }),
    [selectedSession?.cwd, selected, state],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-subtle, #333)",
          flex: "0 0 auto",
        }}
      >
        <strong>chat-embed tester</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>· WS {status}</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          · {liveSessions.length} live / {sessions.length} total
        </span>
        <select
          value={selected ?? ""}
          onChange={(e) => e.target.value && selectSession(e.target.value)}
          style={{
            marginLeft: "auto",
            maxWidth: 520,
            background: "var(--bg-tertiary)",
            color: "inherit",
            border: "1px solid var(--border-subtle, #333)",
            borderRadius: 6,
            padding: "4px 8px",
          }}
        >
          <option value="" disabled>
            {liveSessions.length ? "Pick a live session…" : "waiting for sessions…"}
          </option>
          {liveSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {(s.name || s.cwd || s.id).slice(-60)} — {s.status}
            </option>
          ))}
        </select>
      </header>

      {/* Bounded-height scroll parent — REQUIRED by the virtualized transcript. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        {selected ? (
          <ChatErrorBoundary key={selected}>
            <ChatView
              sessionId={selected}
              state={state}
              toolContext={toolContext}
              onAbort={() => send({ type: "abort", sessionId: selected })}
              onRespondToUi={(requestId, result, cancelled) =>
                send({
                  type: "prompt_response",
                  sessionId: selected,
                  promptId: requestId,
                  answer:
                    typeof result === "string"
                      ? result
                      : result == null
                        ? undefined
                        : JSON.stringify(result),
                  cancelled,
                  source: "embed-tester",
                })
              }
            />
          </ChatErrorBoundary>
        ) : (
          <div style={{ margin: "auto", opacity: 0.6 }}>
            Select a session above to view its live chat.
          </div>
        )}
      </div>
    </div>
  );
}

function upsert(list: DashboardSession[], s: DashboardSession): DashboardSession[] {
  const i = list.findIndex((x) => x.id === s.id);
  if (i === -1) return [...list, s];
  const next = list.slice();
  next[i] = s;
  return next;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ApiContext.Provider value={API_BASE}>
    <UiPrimitiveProvider value={REGISTRY}>
      <ThemeProvider>
        <MobileProvider>
          <SessionAssetsProvider assets={undefined}>
            <DisplayPrefsProvider value={DISPLAY_PREFS}>
              <Router>
                <Tester />
              </Router>
            </DisplayPrefsProvider>
          </SessionAssetsProvider>
        </MobileProvider>
      </ThemeProvider>
    </UiPrimitiveProvider>
  </ApiContext.Provider>,
);
