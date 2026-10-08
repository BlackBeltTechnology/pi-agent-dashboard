/**
 * Browser pane tab — the `editor-pane-tab` body for `browser:<instanceId>:<tabId>`
 * (change: add-browser-editor-pane-tab; successor of the `content-view`
 * LiveViewTile).
 *
 *  - subscribes to its relay tab's frames while mounted AND viewable, and
 *    unsubscribes on unmount / `detached` / the tab leaving the status list;
 *    leaving `detached` re-subscribes once without a remount;
 *  - renders the latest `browser_relay_frame` fitted (or 1:1), keeps the last
 *    frame visible while idle, and hides it when DevTools / no debugger session
 *    makes the tab non-viewable;
 *  - forwards Pointer Events (a tap is a click), wheel and keys as allowlisted
 *    `browser_relay_input`, with positions NORMALIZED to `[0,1]` of the frame;
 *  - offers a text-entry bridge so a phone's soft keyboard can type into the page;
 *  - asks the relay to size the remote viewport to the pane (≤ 2 req/s, 16 px
 *    dead-band) unless the agent owns emulation;
 *  - shows Done while a `browser-takeover` prompt for this instance is pending
 *    in the owning session, answering that same prompt.
 */
import {
  usePluginMessage,
  usePluginSend,
  useSessionInteractiveRequests,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserRelayFrameMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { findRelayTab, useRelayStatus, useRelayStatusFeed } from "./relay-store.js";
import { parseBrowserTabPath } from "./tab-path.js";

export interface BrowserPaneTabProps {
  path: string;
  session: DashboardSession;
  isActive: boolean;
  onClose: () => void;
}

/** Resize requests: at most one per window, only past the dead-band. */
const RESIZE_THROTTLE_MS = 500;
const RESIZE_DEAD_BAND_PX = 16;

/** A position normalized to `[0,1]` of the rendered box; `null` for a degenerate box. */
function normalize(rect: { left: number; top: number; width: number; height: number }, x: number, y: number) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}

const BTN =
  "text-xs px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50";

export function BrowserPaneTab({ path, session, isActive, onClose }: BrowserPaneTabProps): React.ReactElement {
  const t = useT();
  const send = usePluginSend();
  useRelayStatusFeed();
  const status = useRelayStatus();

  const ref = parseBrowserTabPath(path);
  const found = ref ? findRelayTab(status, ref.instanceId, ref.tabId) : undefined;
  const tab = found?.tab;
  const instanceId = ref?.instanceId ?? "";
  const tabId = ref?.tabId ?? -1;

  const [jpeg, setJpeg] = useState<string | null>(null);
  const [inputOn, setInputOn] = useState(true);
  const [fit, setFit] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);

  usePluginMessage<BrowserRelayFrameMessage>("browser_relay_frame", (msg) => {
    if (msg.instanceId === instanceId && msg.tabId === tabId) setJpeg(msg.jpegBase64);
  });

  const detached = tab?.state === "detached";
  const viewable = !!tab && !detached;
  const canInput = inputOn && viewable;
  const agentEmulation = tab?.agentEmulation === true;

  // Subscribe while active + viewable; cleanup = unsubscribe (unmount, detach,
  // tab gone). Leaving `detached` flips `viewable` → exactly one new subscribe.
  useEffect(() => {
    if (!viewable || !isActive) return;
    void send({ type: "browser_relay_subscribe", instanceId, tabId });
    return () => {
      void send({ type: "browser_relay_unsubscribe", instanceId, tabId });
    };
  }, [send, instanceId, tabId, viewable, isActive]);

  const sendInput = useCallback(
    (payload: Record<string, unknown>) => {
      void send({ type: "browser_relay_input", instanceId, tabId, ...payload });
    },
    [send, instanceId, tabId],
  );

  // ── viewport follows the pane ────────────────────────────────────────────
  const resizeEnabled = canInput && !agentEmulation;
  const lastSent = useRef<{ w: number; h: number } | null>(null);
  const latest = useRef<{ w: number; h: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!resizeEnabled || !el || typeof ResizeObserver === "undefined") return;
    lastSent.current = null; // (re)entering resize mode re-asserts the size once
    const flush = () => {
      timer.current = null;
      const size = latest.current;
      if (!size) return;
      const prev = lastSent.current;
      if (prev && Math.abs(size.w - prev.w) < RESIZE_DEAD_BAND_PX && Math.abs(size.h - prev.h) < RESIZE_DEAD_BAND_PX) return;
      lastSent.current = size;
      sendInput({ kind: "resize", width: size.w, height: size.h });
    };
    const schedule = () => {
      if (timer.current === null) timer.current = setTimeout(flush, RESIZE_THROTTLE_MS);
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r || r.width <= 0 || r.height <= 0) return;
      latest.current = { w: Math.round(r.width), h: Math.round(r.height) };
      schedule();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [resizeEnabled, sendInput]);

  // ── pointer / wheel / key ────────────────────────────────────────────────
  const point = (clientX: number, clientY: number) => {
    const el = imgRef.current ?? boxRef.current;
    return el ? normalize(el.getBoundingClientRect(), clientX, clientY) : null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!canInput) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = point(e.clientX, e.clientY);
    if (p) sendInput({ kind: "mouse", x: p.x, y: p.y, action: "click", button: "left", clickCount: 1 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!canInput || e.pointerType !== "mouse") return;
    const p = point(e.clientX, e.clientY);
    if (p) sendInput({ kind: "mouse", x: p.x, y: p.y, action: "move" });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!canInput) return;
    const p = point(e.clientX, e.clientY);
    if (p) sendInput({ kind: "scroll", x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY });
  };
  const onKey = (keyType: "keyDown" | "keyUp") => (e: React.KeyboardEvent) => {
    if (!canInput) return;
    sendInput({ kind: "key", keyType, key: e.key, code: e.code });
  };

  // ── text-entry bridge (soft keyboards) ───────────────────────────────────
  const [bridgeValue, setBridgeValue] = useState("");
  const onBridgeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (canInput) for (const ch of Array.from(value)) sendInput({ kind: "key", keyType: "char", key: ch, text: ch });
    setBridgeValue(""); // never retained
  };
  const onBridgeKeyDown = (e: React.KeyboardEvent) => {
    if (!canInput) return;
    if (e.key === "Enter") sendInput({ kind: "key", keyType: "keyDown", key: "Enter", code: "Enter", text: "\r" });
    else if (e.key === "Backspace") sendInput({ kind: "key", keyType: "keyDown", key: "Backspace", code: "Backspace" });
    else if (e.key === "Tab") sendInput({ kind: "key", keyType: "keyDown", key: "Tab", code: "Tab" });
    else return;
    e.preventDefault();
  };

  // ── takeover Done ────────────────────────────────────────────────────────
  const requests = useSessionInteractiveRequests(session.id);
  const takeover = requests.find((r) => {
    const meta = r.params._pluginMeta;
    return r.status === "pending" && meta?.kind === "browser-takeover" && meta.instanceId === instanceId;
  });
  const [doneSent, setDoneSent] = useState<string | null>(null);
  const onDone = () => {
    if (!takeover || doneSent === takeover.requestId) return;
    setDoneSent(takeover.requestId);
    void send({
      type: "prompt_response",
      sessionId: session.id,
      promptId: takeover.requestId,
      answer: "true",
      source: "dashboard-browser-takeover",
    });
  };

  // ── render ───────────────────────────────────────────────────────────────
  if (!ref || (status !== null && !tab)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]" data-testid="browser-pane-gone">
        <span>{t("paneTabGone", undefined, "This browser tab is no longer available")}</span>
        <button type="button" className={BTN} onClick={onClose}>
          {t("close", undefined, "Close")}
        </button>
      </div>
    );
  }

  const idle = tab?.state === "no-frames";
  const bringToFront = () => sendInput({ kind: "bringToFront" });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-pane-tab" data-instance={instanceId} data-tab={tabId}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1">
        <input
          readOnly
          aria-label={t("paneUrl", undefined, "Page address")}
          data-testid="browser-pane-url"
          value={tab?.url ?? ""}
          className="min-w-0 flex-1 rounded border border-[var(--border-secondary)] bg-transparent px-2 py-1 text-xs text-[var(--text-secondary)]"
        />
        <button type="button" data-testid="browser-pane-input-toggle" aria-pressed={inputOn} className={BTN} onClick={() => setInputOn((v) => !v)}>
          {inputOn ? t("inputOn", undefined, "Input: on") : t("inputOff", undefined, "Input: off")}
        </button>
        <button type="button" data-testid="browser-pane-fit-toggle" aria-pressed={fit} className={BTN} onClick={() => setFit((v) => !v)}>
          {fit ? t("fit", undefined, "Fit") : t("oneToOne", undefined, "1:1")}
        </button>
        <button type="button" data-testid="browser-pane-bring-to-front" className={BTN} disabled={!tab || detached} onClick={bringToFront}>
          {t("bringToFront", undefined, "Bring to front")}
        </button>
        {takeover && (
          <button
            type="button"
            data-testid="browser-pane-done"
            className="text-xs px-2 py-1 rounded bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium disabled:opacity-50"
            disabled={doneSent === takeover.requestId}
            onClick={onDone}
          >
            {t("done", undefined, "Done ✓")}
          </button>
        )}
      </div>

      {idle && (
        <div data-testid="browser-pane-idle" className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]">
          <span>{t("noFramesOverlay", undefined, "No repaints — tab may be idle or in the background")}</span>
          <button type="button" className={BTN} onClick={bringToFront}>
            {t("bringToFront", undefined, "Bring to front")}
          </button>
        </div>
      )}

      <div ref={areaRef} data-testid="browser-pane-frame-area" className={`relative min-h-0 flex-1 bg-black/5 ${fit ? "overflow-hidden" : "overflow-auto"}`}>
        <div
          ref={boxRef}
          tabIndex={0}
          data-testid="browser-pane-frame-box"
          className={`select-none outline-none ${fit ? "flex h-full w-full items-center justify-center" : "inline-block"}`}
          style={{ userSelect: "none", touchAction: "none" }}
          onPointerDown={(e) => {
            if (canInput) boxRef.current?.focus();
            if (e.pointerType === "mouse") e.preventDefault(); // no text selection / drag start
          }}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onWheel={onWheel}
          onKeyDown={onKey("keyDown")}
          onKeyUp={onKey("keyUp")}
          onDragStart={(e) => e.preventDefault()}
        >
          {jpeg && viewable && (
            <img
              ref={imgRef}
              data-testid="browser-pane-frame"
              alt={t("frameAlt", undefined, "Live browser frame")}
              src={`data:image/jpeg;base64,${jpeg}`}
              className={`block select-none ${fit ? "max-h-full max-w-full object-contain" : ""}`}
              draggable={false}
            />
          )}
          {!jpeg && viewable && tab?.state !== "client-screencast-active" && (
            <div data-testid="browser-pane-waiting" className="p-3 text-[11px] text-[var(--text-tertiary)]">
              {t("waitingFrame", undefined, "Waiting for frames…")}
            </div>
          )}
          {viewable && tab?.state === "client-screencast-active" && !jpeg && (
            <div data-testid="browser-pane-agent-screencast" className="p-3 text-[11px] text-[var(--text-tertiary)]">
              {t("clientScreencast", undefined, "The agent is capturing this tab — no live view")}
            </div>
          )}
        </div>
        {detached && tab?.reason === "no-session" && (
          <div data-testid="browser-pane-nosession" className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 p-3 text-center text-[11px] text-[var(--text-secondary)]">
            {t("noSessionOverlay", undefined, "Tab not viewable yet — the agent has not attached to it (extension pages cannot be viewed)")}
          </div>
        )}
        {detached && tab?.reason !== "no-session" && (
          <div data-testid="browser-pane-devtools" className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 p-3 text-center text-[11px] text-[var(--text-secondary)]">
            {t("devtoolsOverlay", undefined, "DevTools open on this tab — close it to resume")}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border-primary)] p-1">
        <input
          type="text"
          data-testid="browser-pane-text-bridge"
          aria-label={t("textBridge", undefined, "Type into the page")}
          placeholder={t("textBridge", undefined, "Type into the page")}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={!canInput}
          value={bridgeValue}
          onChange={onBridgeChange}
          onKeyDown={onBridgeKeyDown}
          className="w-full rounded border border-[var(--border-secondary)] bg-transparent px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}
