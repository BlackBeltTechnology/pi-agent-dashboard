/**
 * Per-subagent stop + queued/stopped row status for the `Agent` tool-renderer
 * claim (producer ≥ 0.6.0).
 *
 * - `agentRowStatus` / `agentStop` / `agentStopLabel` are the claim's `rowStatus`,
 *   `stop` and `stopLabel` exports (sync, non-React: the shell's `ToolCallStep`
 *   calls them). They live in the eager client entry, not the lazy renderer chunk.
 * - `requestSubagentStop` POSTs `/api/plugins/subagents/stop` and records the
 *   pending state in a tiny module store the card reads (`useSubagentStopState`),
 *   so the row and the card share ONE "stopping…" state per subagent.
 * - Feedback: `pending` until a terminal frame (the card clears it), `error` with
 *   the server's reason on a non-2xx, `unconfirmed` after 10 s without a terminal
 *   frame. Never falls back to a session abort once a POST was issued.
 *
 * Labels are English fallbacks localized from this plugin's own catalog by the
 * document language (these fns run outside React, so `useT` is unavailable).
 *
 * See change: subagent-queue-visibility (design D2, D3).
 */
import { useSyncExternalStore } from "react";
import { catalog } from "../i18n.js";

/** How long a stop may stay unconfirmed before the control re-enables. */
export const STOP_CONFIRM_TIMEOUT_MS = 10_000;

export type SubagentStopState =
  | { phase: "pending" }
  | { phase: "error"; reason: string }
  | { phase: "unconfirmed" };

type Details = Record<string, unknown> | undefined;

const states = new Map<string, SubagentStopState>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const keyOf = (sessionId: string, agentId: string): string => `${sessionId}\u0000${agentId}`;

function emit(): void {
  for (const l of listeners) l();
}

function setState(key: string, next: SubagentStopState | undefined): void {
  const t = timers.get(key);
  if (t !== undefined && next?.phase !== "pending") {
    clearTimeout(t);
    timers.delete(key);
  }
  if (next) states.set(key, next);
  else states.delete(key);
  emit();
}

/** Drop any pending / failed stop notice — called when the subagent's terminal frame is present. */
export function clearSubagentStop(sessionId: string, agentId: string): void {
  if (states.has(keyOf(sessionId, agentId))) setState(keyOf(sessionId, agentId), undefined);
}

/** React binding for the card. */
export function useSubagentStopState(sessionId: string | undefined, agentId: string | undefined): SubagentStopState | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (sessionId && agentId ? states.get(keyOf(sessionId, agentId)) : undefined),
  );
}

/** Test seam: reset the module store and its timers. */
export function __resetSubagentStopsForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  states.clear();
  emit();
}

/** Read a short, human reason from a refused stop response. */
async function refusalReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}`;
}

/**
 * Ask the server to stop one subagent. Idempotent while a request is pending.
 * Resolves once the POST settled; the terminal frame (not this promise) ends `pending`.
 */
export async function requestSubagentStop(sessionId: string, agentId: string): Promise<void> {
  const key = keyOf(sessionId, agentId);
  if (states.get(key)?.phase === "pending") return;
  setState(key, { phase: "pending" });
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      if (states.get(key)?.phase === "pending") setState(key, { phase: "unconfirmed" });
    }, STOP_CONFIRM_TIMEOUT_MS),
  );
  let res: Response;
  try {
    res = await fetch("/api/plugins/subagents/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, agentId }),
      credentials: "include",
    });
  } catch (err) {
    if (states.get(key)?.phase === "pending") setState(key, { phase: "error", reason: String(err) });
    return;
  }
  if (!res.ok) {
    const reason = await refusalReason(res);
    if (states.get(key)?.phase === "pending") setState(key, { phase: "error", reason });
  }
}

/** Plain translator over this plugin's catalog, keyed by the document language. */
function plainT(key: string, vars: Record<string, string | number> | undefined, fallback: string): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  const table = (catalog as Record<string, Record<string, string> | undefined>)[lang];
  const template = table?.[key] ?? fallback;
  return vars ? template.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) : template;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** `Agent` claim `rowStatus`: queued → clock + `queued · #n`, stopped → neutral stop glyph. */
export function agentRowStatus(
  toolDetails: Details,
  session: unknown,
): { state: "queued" | "stopped"; label?: string } | undefined {
  const status = toolDetails?.status;
  if (status === "queued") {
    const pos = toolDetails?.queuePosition;
    return {
      state: "queued",
      label:
        typeof pos === "number" && pos > 0
          ? plainT("rowQueuedPos", { pos }, "queued · #{pos}")
          : plainT("rowQueued", undefined, "queued"),
    };
  }
  let stopReason = toolDetails?.stopReason;
  if (status !== "stopped") {
    // Row healed from the subagent map before the tool's own end arrived.
    const agentId = str(toolDetails?.agentId);
    const sub = agentId
      ? (session as { subagents?: ReadonlyMap<string, { status?: string; stopReason?: string }> } | undefined)?.subagents?.get(agentId)
      : undefined;
    if (sub?.status !== "stopped") return undefined;
    stopReason = sub.stopReason;
  }
  return {
    state: "stopped",
    label:
      stopReason === "queued"
        ? plainT("rowStoppedQueued", undefined, "removed from queue")
        : plainT("rowStopped", undefined, "stopped"),
  };
}

/** `Agent` claim `stop`: consume the click with a per-subagent stop when the producer supports it. */
export function agentStop(input: { sessionId: string | undefined; toolCallId: string | undefined; toolDetails: Details }): boolean {
  const d = input.toolDetails;
  const agentId = str(d?.agentId);
  if (d?.stoppable !== true || !agentId || !input.sessionId) return false;
  void requestSubagentStop(input.sessionId, agentId);
  return true;
}

/** `Agent` claim `stopLabel`. */
export function agentStopLabel(toolDetails: Details): string | undefined {
  if (toolDetails?.stoppable !== true || !str(toolDetails?.agentId)) {
    return plainT("stopWholeTurn", undefined, "Stop (ends the whole turn)");
  }
  return toolDetails.status === "queued"
    ? plainT("stopRemoveFromQueue", undefined, "Remove from queue")
    : plainT("stopSubagent", undefined, "Stop subagent");
}
