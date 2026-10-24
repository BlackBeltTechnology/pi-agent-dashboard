/**
 * Client side of the live-control routing (design D1, D2): every open editor instance answers the server's
 * session-scoped `control-probe` with a `control-claim` (a status for each path match), and acts on a
 * `control-run` only when it holds the named `instanceId`. The run is re-checked on arrival (still open,
 * visible, same session) and dropped once its `ttlMs`, counted from receipt, has passed.
 *
 * The hook is mounted by `CraftFrame`; it never touches the frame itself — `FrameSession.control` does.
 * Plugin message hooks need a plugin context: outside one (older tests, a bare mount) the instance simply
 * never claims, which is the safe default.
 *
 * See change: add-craft-live-control (D1, D2, tasks 4.3).
 */
import { usePluginMessage, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ClaimStatus,
  CONTROL_CLAIM,
  CONTROL_GONE,
  CONTROL_PROBE,
  CONTROL_RESULT,
  CONTROL_RUN,
  type ControlPathForms,
  jsonBytes,
  tabMatches,
} from "../shared/control-protocol.js";
import type { ControlReply } from "./control-host.js";
import type { CraftWebApp } from "./craft-apps-table.js";
import type { FrameSession } from "./frame-session.js";

/** Rows the agent log keeps (oldest dropped). */
export const AGENT_LOG_MAX = 50;
const PREVIEW_CHARS = 120;

export interface AgentLogRow {
  at: number;
  method: string;
  outcome: string;
  bytes: number;
  preview: string;
}

/** Append one row, keeping the newest {@link AGENT_LOG_MAX}. */
export function appendLog(log: readonly AgentLogRow[], row: AgentLogRow): AgentLogRow[] {
  const next = [...log, row];
  return next.length > AGENT_LOG_MAX ? next.slice(next.length - AGENT_LOG_MAX) : next;
}

/** One log row from a finished request (method, outcome code, reply size, ≤ 120-char preview). */
export function logRow(method: string, reply: ControlReply, at: number): AgentLogRow {
  if (!reply.ok) return { at, method, outcome: reply.code, bytes: new TextEncoder().encode(reply.error).length, preview: reply.error.slice(0, PREVIEW_CHARS) };
  const text = JSON.stringify(reply.result) ?? "";
  return { at, method, outcome: "ok", bytes: jsonBytes(reply.result) ?? 0, preview: text.slice(0, PREVIEW_CHARS) };
}

/** True once a run received at `receivedAt` has been held longer than its `ttlMs` (no cross-device clocks). */
export const runExpired = (receivedAt: number, ttlMs: number, now: number): boolean => now - receivedAt > ttlMs;

export interface ProbeMsg extends ControlPathForms {
  type: string;
  sessionId: string;
  reqId: string;
}

export interface RunMsg {
  type: string;
  sessionId: string;
  reqId: string;
  instanceId: string;
  method: string;
  params?: unknown;
  ttlMs: number;
}

/** What the registry needs from its instance. */
export interface ControlInstance {
  instanceId: string;
  app: CraftWebApp;
  fh: () => FileHandlerProps;
  session: () => FrameSession | null;
  /** Is the page visible (`document.visibilityState`)? Injected for tests. */
  pageVisible: () => boolean;
  /** Ms since this instance was last focused / activated (0 while the frame owns focus). */
  msSinceFocus: () => number;
}

type Send = (message: unknown) => void | Promise<void>;

/** The claim an instance answers a probe with, or `null` when its path does not match. */
export function buildClaim(i: ControlInstance, p: ProbeMsg): { reqId: string; instanceId: string; status: ClaimStatus; msSinceFocus: number } | null {
  const fh = i.fh();
  if (!tabMatches(p, fh.cwd, fh.path)) return null;
  const session = i.session();
  const status: ClaimStatus = fh.session?.id !== p.sessionId ? "wrong-session" : session ? session.control.claimStatus(fh.isActive, i.pageVisible()) : "not-ready";
  return { reqId: p.reqId, instanceId: i.instanceId, status, msSinceFocus: Math.round(i.msSinceFocus()) };
}

/**
 * Handle a run: only the holder of `instanceId` acts; it re-checks the instance, then runs the request on
 * its `ControlHost`. Returns the result message to send, or `null` when this instance is not the target
 * (or the run expired and is dropped without an answer).
 */
export async function handleRun(
  i: ControlInstance,
  msg: RunMsg,
  receivedAt: number,
  now: number = Date.now(),
): Promise<{ reply: ControlReply; method: string } | null> {
  if (msg.instanceId !== i.instanceId) return null;
  if (runExpired(receivedAt, msg.ttlMs, now)) return null;
  const fail = (code: Extract<ControlReply, { ok: false }>["code"], error: string): { reply: ControlReply; method: string } => ({
    reply: { ok: false, code, error, instance: i.instanceId },
    method: msg.method,
  });
  const session = i.session();
  const fh = i.fh();
  if (!session || fh.session?.id !== msg.sessionId) return fail("not-open", "The editor instance is no longer open in this session.");
  // `host.state` never reaches the frame: exempt from the visibility check (design D5).
  if (msg.method !== "host.state") {
    const status = session.control.claimStatus(fh.isActive, i.pageVisible());
    if (status === "not-visible") return fail("not-visible", "The tab is not the active, visible one. Ask the user to bring it to the front.");
    if (status === "not-ready") return fail("not-ready", "The document is not open in the editor yet.");
  }
  return { reply: await session.control.run(msg.method, msg.params), method: msg.method };
}

/** `usePluginSend` throws outside a plugin context; a bare mount just never answers. Hook order is unaffected. */
function useOptionalSend(): Send | null {
  try {
    return usePluginSend();
  } catch {
    return null;
  }
}

export interface ControlUi {
  /** Method of the request running right now (`null` = idle). */
  active: string | null;
  log: readonly AgentLogRow[];
}

/** Message of the server-bound result of a finished request. */
function resultMessage(msg: RunMsg, reply: ControlReply): Record<string, unknown> {
  const base = { type: CONTROL_RESULT, reqId: msg.reqId, instanceId: msg.instanceId };
  if (reply.ok) return { ...base, ok: true, result: reply.result, ...(reply.saveRequested ? { saveRequested: true, saveSeq: reply.saveSeq } : {}) };
  return { ...base, ok: false, code: reply.code, error: reply.error };
}

/**
 * Register one editor instance for live control. Returns the state the UI shows (`craft-agent-active`,
 * `craft-agent-log`). `session` and `fh` are read through refs, so the long-lived subscription never goes stale.
 */
export function useControlInstance(input: {
  instanceId: string;
  app: CraftWebApp;
  fh: FileHandlerProps;
  session: () => FrameSession | null;
  frame: () => HTMLElement | null;
}): ControlUi {
  const send = useOptionalSend();
  const sendRef = useRef(send);
  sendRef.current = send;
  const inputRef = useRef(input);
  inputRef.current = input;
  const [ui, setUi] = useState<ControlUi>({ active: null, log: [] });
  const lastFocus = useRef(Date.now());

  // Focus age: activation, window focus while active, and the frame taking keyboard focus.
  const isActive = input.fh.isActive;
  useEffect(() => {
    if (isActive) lastFocus.current = Date.now();
  }, [isActive]);
  useEffect(() => {
    const bump = () => {
      if (inputRef.current.fh.isActive) lastFocus.current = Date.now();
    };
    const onBlur = () => {
      // Focus moving into the sandboxed iframe blurs the window: that is the user using this instance.
      if (document.activeElement && document.activeElement === inputRef.current.frame()) bump();
    };
    window.addEventListener("focus", bump);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const instance = useCallback(
    (): ControlInstance => ({
      instanceId: inputRef.current.instanceId,
      app: inputRef.current.app,
      fh: () => inputRef.current.fh,
      session: inputRef.current.session,
      pageVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
      msSinceFocus: () => (document.activeElement && document.activeElement === inputRef.current.frame() ? 0 : Date.now() - lastFocus.current),
    }),
    [],
  );

  usePluginMessage<ProbeMsg>(CONTROL_PROBE, (msg) => {
    const claim = buildClaim(instance(), msg);
    if (claim && sendRef.current) void sendRef.current({ type: CONTROL_CLAIM, ...claim });
  });

  usePluginMessage<RunMsg>(CONTROL_RUN, (msg) => {
    const receivedAt = Date.now();
    if (msg.instanceId !== inputRef.current.instanceId) return;
    if (msg.method !== "host.state") setUi((u) => ({ ...u, active: msg.method }));
    void handleRun(instance(), msg, receivedAt).then(
      (out) => {
        setUi((u) => ({ active: null, log: out ? appendLog(u.log, logRow(out.method, out.reply, Date.now())) : u.log }));
        if (out && sendRef.current) void sendRef.current(resultMessage(msg, out.reply));
      },
      () => setUi((u) => ({ ...u, active: null })),
    );
  });

  // Unmount (tab closed / evicted): pinned follow-ups answer `not-open` at once instead of timing out.
  const instanceId = input.instanceId;
  useEffect(
    () => () => {
      void sendRef.current?.({ type: CONTROL_GONE, instanceId });
    },
    [instanceId],
  );

  return ui;
}
