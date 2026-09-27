/**
 * In-process reload of a terminal-hosted pi session, requested from the
 * dashboard.
 *
 * `ExtensionContext` has no `reload()`; only a command handler's
 * `ExtensionCommandContext` does. Since pi 0.84.2,
 * `pi.sendUserMessage(text, {expandPromptTemplates: true})` runs
 * `_tryExecuteExtensionCommand`, which hands the handler a FRESH command ctx.
 * So the bridge self-dispatches `/__dashboard_reload <token>` and the handler
 * calls `ctx.reload()`. Nothing callable is cached, so every reload works (the
 * retired captured reload fn on `globalThis` was single-use: pi
 * invalidates its runner on the first reload).
 *
 * Verified on pi 0.87.1 (spike, task 1.1): the self-dispatch produces no user
 * message and no `agent_start`; the order is handler start →
 * `session_shutdown{reload}` → new extension instance loads →
 * `session_start{reload}` → the old handler's `ctx.reload()` resolves.
 *
 * Handshake (design D3/D4): the requesting instance (B1) arms a slot on
 * `process` (shared with the reloaded instance B2, also under vm-sandboxed
 * extension contexts). B2 moves `started → delivered` in its `session_start`
 * and reports `completed` after `replay_complete`, because B1's connection is
 * torn down by the reload. B1 reports every failure. Slot transitions are
 * compare-and-set, so B1's `error` and B2's `completed` are mutually exclusive.
 *
 * See change: fix-terminal-session-dashboard-reload.
 */
import crypto from "node:crypto";
import {
  NO_RELOAD_PATH_REASON,
  PI_DID_NOT_RELOAD_REASON,
  RELOAD_DID_NOT_RUN_REASON,
  RELOAD_IN_PROGRESS_REASON,
  RELOAD_SUPERSEDED_REASON,
  RELOAD_TIMEOUT_REASON,
  type ReloadOutcome,
} from "./command-handler.js";
import { supportsInProcessCommandDispatch } from "./slash-dispatch.js";

/** The bridge's reload command (registered as `__dashboard_reload`). */
export const RELOAD_COMMAND_NAME = "__dashboard_reload";

/** `process` key of the pending-reload slot. */
export const PENDING_RELOAD_SLOT_KEY = "__pi_dashboard_pending_reload__" as const;

/** The handler must start within this bound, measured from `armedAt`. */
export const START_TIMEOUT_MS = 5_000;

/** The reload must finish within this bound, measured from `armedAt`. */
export const FINISH_TIMEOUT_MS = 60_000;

export type PendingReloadState = "armed" | "started" | "delivered" | "expired";

export interface PendingReloadSlot {
  token: string;
  sessionId: string;
  state: PendingReloadState;
  armedAt: number;
}

type ProcessWithSlot = NodeJS.Process & { [PENDING_RELOAD_SLOT_KEY]?: PendingReloadSlot };
const slotHost = process as ProcessWithSlot;

export function readPendingReload(): PendingReloadSlot | undefined {
  return slotHost[PENDING_RELOAD_SLOT_KEY];
}

export function writePendingReload(slot: PendingReloadSlot | undefined): void {
  if (slot === undefined) delete slotHost[PENDING_RELOAD_SLOT_KEY];
  else slotHost[PENDING_RELOAD_SLOT_KEY] = slot;
}

/** Delete the slot only if it still belongs to `token` (compare-and-delete). */
function deleteSlotIfOwned(token: string): void {
  if (readPendingReload()?.token === token) writePendingReload(undefined);
}

/** True when `slot` is a live (armed/started, fresh) reload of `sessionId`. */
function isInFlight(slot: PendingReloadSlot | undefined, sessionId: string, now: number): boolean {
  return (
    slot !== undefined &&
    slot.sessionId === sessionId &&
    (slot.state === "armed" || slot.state === "started") &&
    now - slot.armedAt < FINISH_TIMEOUT_MS
  );
}

/** The slice of pi's `ExtensionCommandContext` the reload handler uses. */
export interface ReloadCommandCtx {
  reload?: () => Promise<void>;
  ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void };
}

export interface TerminalReloadDeps {
  pi: { sendUserMessage: (text: string, options?: { expandPromptTemplates?: boolean }) => void };
  getSessionId: () => string;
  /** Injectable for tests; defaults to the argv-anchored pi version reader. */
  readVersion?: () => string | undefined;
  /** Injectable for tests. */
  mintToken?: () => string;
}

interface PendingDeferred {
  onStart(): void;
  onSettle(err?: unknown): void;
}

export interface TerminalReload {
  /** The bridge `reload` option: self-dispatch and await the outcome. */
  reload(): Promise<ReloadOutcome>;
  /** The `__dashboard_reload` command handler. */
  handleReloadCommand(args: string, ctx: ReloadCommandCtx | undefined): Promise<void>;
}

/**
 * Outcome once the handler's `ctx.reload()` settled, from the slot state.
 * `undefined` when the finish timer already reported (`expired`).
 */
function settleOutcome(token: string, err: unknown): ReloadOutcome | undefined {
  const slot = readPendingReload();
  // Only this token in `delivered` proves the reloaded instance reported.
  // A missing or replaced slot (session switched, another reload armed) is not
  // proof: report, and leave a foreign slot alone.
  if (slot?.token !== token) return { ok: false, reason: RELOAD_SUPERSEDED_REASON };
  if (slot.state === "delivered") {
    writePendingReload(undefined);
    return { ok: true, handedOff: true };
  }
  if (slot.state !== "started") return undefined;
  writePendingReload(undefined);
  const detail = err === undefined ? "" : ` (${err instanceof Error ? err.message : String(err)})`;
  return { ok: false, reason: `${PI_DID_NOT_RELOAD_REASON}${detail}` };
}

export function createTerminalReload(deps: TerminalReloadDeps): TerminalReload {
  // Deferreds of reloads THIS instance requested, keyed by token. The handler
  // that runs for a dispatch is this instance's own registration (the
  // pre-reload runner dispatches it), so it reaches the map via closure.
  const pending = new Map<string, PendingDeferred>();

  function reload(): Promise<ReloadOutcome> {
    const readVersion = deps.readVersion;
    if (!supportsInProcessCommandDispatch(readVersion)) {
      return Promise.resolve({ ok: false, reason: NO_RELOAD_PATH_REASON });
    }
    const sessionId = deps.getSessionId();
    const armedAt = Date.now();
    if (isInFlight(readPendingReload(), sessionId, armedAt)) {
      return Promise.resolve({ ok: false, reason: RELOAD_IN_PROGRESS_REASON });
    }

    const token = (deps.mintToken ?? crypto.randomUUID)();
    // A stale slot (other session after /new or /resume, or older than the
    // finish bound) is replaced.
    writePendingReload({ token, sessionId, state: "armed", armedAt });

    return new Promise<ReloadOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: ReloadOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        clearTimeout(finishTimer);
        pending.delete(token);
        resolve(outcome);
      };

      const startTimer = setTimeout(() => {
        const slot = readPendingReload();
        if (slot?.token === token && slot.state === "armed") {
          writePendingReload(undefined);
          finish({ ok: false, reason: RELOAD_DID_NOT_RUN_REASON });
        } else if (slot?.token !== token) {
          // Missing or replaced before the handler ran: report now, not at 60 s.
          finish({ ok: false, reason: RELOAD_SUPERSEDED_REASON });
        }
      }, START_TIMEOUT_MS);

      const finishTimer = setTimeout(() => {
        const slot = readPendingReload();
        if (slot?.token === token && (slot.state === "armed" || slot.state === "started")) {
          slot.state = "expired";
          finish({ ok: false, reason: RELOAD_TIMEOUT_REASON });
          return;
        }
        // Slow success: B2 already reported `completed`.
        if (slot?.token === token && slot.state === "delivered") {
          writePendingReload(undefined);
          finish({ ok: true, handedOff: true });
          return;
        }
        // Missing or replaced slot: no proof of delivery.
        finish({ ok: false, reason: RELOAD_SUPERSEDED_REASON });
      }, FINISH_TIMEOUT_MS);

      pending.set(token, {
        onStart: () => clearTimeout(startTimer),
        onSettle: (err?: unknown) => {
          const outcome = settleOutcome(token, err);
          if (outcome) finish(outcome);
        },
      });

      try {
        deps.pi.sendUserMessage(`/${RELOAD_COMMAND_NAME} ${token}`, { expandPromptTemplates: true });
      } catch (err) {
        // A stale ExtensionAPI throws synchronously out of `assertActive()`.
        deleteSlotIfOwned(token);
        finish({ ok: false, reason: `Reload failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  }

  async function handleReloadCommand(args: string, ctx: ReloadCommandCtx | undefined): Promise<void> {
    const token = (args ?? "").trim();
    const slot = readPendingReload();

    if (!token) {
      // A human typed `/__dashboard_reload` in the TUI: reload, no dashboard
      // feedback — unless a dashboard reload is in flight (no nested reload).
      if (isInFlight(slot, deps.getSessionId(), Date.now())) {
        ctx?.ui?.notify?.("A dashboard reload is already in progress.", "warning");
        return;
      }
      await ctx?.reload?.();
      return;
    }

    // Late, stale or foreign dispatch → no-op.
    if (!slot || slot.token !== token || slot.state !== "armed") return;

    slot.state = "started";
    const deferred = pending.get(token);
    deferred?.onStart();
    try {
      if (typeof ctx?.reload !== "function") throw new Error("command ctx has no reload()");
      await ctx.reload();
      deferred?.onSettle();
    } catch (err) {
      deferred?.onSettle(err);
    }
  }

  return { reload, handleReloadCommand };
}

/**
 * B2 side, called synchronously at the top of the bridge's `session_start`.
 * Returns true when this instance must emit the `/reload` `completed`
 * (after `replay_complete`). Also garbage-collects expired/old slots.
 */
export function consumePendingReloadOnSessionStart(
  reason: string | undefined,
  sessionId: string,
  now: number = Date.now(),
): boolean {
  const slot = readPendingReload();
  if (!slot) return false;
  const fresh = now - slot.armedAt < FINISH_TIMEOUT_MS;
  if (reason === "reload" && slot.sessionId === sessionId && slot.state === "started" && fresh) {
    slot.state = "delivered";
    return true;
  }
  if (slot.state === "expired" || !fresh) writePendingReload(undefined);
  return false;
}

/** The terminal `/reload` feedback the reloaded instance reports. */
export function reloadCompletedFeedback(sessionId: string) {
  return {
    type: "event_forward" as const,
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: { command: "/reload", status: "completed" as const },
    },
  };
}

/** Bridge ownership fields read by the subagent re-entry guard. */
export interface BridgeOwner {
  generation?: number;
  pi?: unknown;
}

/**
 * True when `initBridge` must skip: the bridge is already active for a
 * different pi instance (a subagent loading extensions in the same process).
 */
export function isBridgeReentry(prev: BridgeOwner, pi: unknown): boolean {
  return !!(prev.generation && prev.generation > 0 && prev.pi && prev.pi !== pi);
}

/**
 * On `session_shutdown{reason:"reload"}`, release ownership so the reloaded
 * instance (a fresh `ExtensionAPI`) re-initialises instead of being mistaken
 * for a subagent load. A subagent never receives the parent's shutdown.
 * Spike: without this, every in-process reload orphaned the dashboard session.
 */
export function releaseBridgeOwnerOnShutdown(prev: BridgeOwner, reason: string | undefined): void {
  if (reason === "reload") prev.pi = undefined;
}
