/**
 * Readiness polling — bound to the Gateway dialog's lifetime.
 *
 * A readiness tick shells out per provider (~4 subprocesses), which is
 * affordable while someone is looking at the tab and NOT affordable as a
 * background service. So: one tick immediately on open, every 5s while open,
 * stopped on close, overlapping ticks suppressed.
 *
 * The scheduling decisions live here as pure functions so "does it stop on
 * close" and "is a second tick suppressed while one is in flight" are testable
 * without a DOM, a timer mock, or a rendered dialog.
 *
 * See change: add-zrok-custom-reserved-name (D7).
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

export interface PollState {
  /** The dialog is open. Polling exists only in this state. */
  open: boolean;
  /** A tick is in flight. */
  inFlight: boolean;
  /** Epoch ms of the last completed tick, for the "checked Ns ago" stamp. */
  lastCheckedAt?: number;
  providers: ProviderReadiness[];
}

export const INITIAL_POLL_STATE: PollState = { open: false, inFlight: false, providers: [] };

/**
 * May a tick start now?
 *
 * Two independent reasons not to, and conflating them is how a poll leaks: a
 * closed dialog must never tick at all, and an in-flight tick must not be
 * joined by a second one. Overlap suppression matters because a tick is bounded
 * at 4s per provider while the interval is 5s — a slow tick can otherwise be
 * overtaken by its own successor.
 */
export function shouldTick(state: Pick<PollState, "open" | "inFlight">): boolean {
  return state.open && !state.inFlight;
}

/** Opening triggers an IMMEDIATE tick — not one interval of blank board. */
export function onOpen(state: PollState): PollState {
  return { ...state, open: true };
}

/**
 * Closing stops polling AND drops the in-flight marker.
 *
 * Leaving `inFlight` true across a close would permanently suppress the first
 * tick of the NEXT open: the response that would have cleared it is discarded
 * because the dialog is gone.
 */
export function onClose(state: PollState): PollState {
  return { ...state, open: false, inFlight: false };
}

export function onTickStart(state: PollState): PollState {
  return { ...state, inFlight: true };
}

/**
 * A tick's result.
 *
 * A result arriving after close is DISCARDED rather than stored: it would
 * repopulate a board nobody is looking at and make "zero further readiness
 * activity after close" observably false.
 */
export function onTickResult(state: PollState, providers: ProviderReadiness[], now: number): PollState {
  if (!state.open) return { ...state, inFlight: false };
  return { ...state, inFlight: false, providers, lastCheckedAt: now };
}

/** A failed tick clears the in-flight flag but keeps the last good board. */
export function onTickError(state: PollState): PollState {
  return { ...state, inFlight: false };
}

/** Whole seconds since the last completed tick, for the freshness stamp. */
export function secondsSinceCheck(state: PollState, now: number): number | null {
  return state.lastCheckedAt === undefined ? null : Math.max(0, Math.floor((now - state.lastCheckedAt) / 1000));
}

/**
 * Human label for a readiness state.
 *
 * Every state carries TEXT, never colour alone (WCAG 1.4.1). The board's dot is
 * decoration; this string is the information.
 */
export const READINESS_LABEL: Record<ProviderReadiness["state"], string> = {
  "not-installed": "Not installed",
  "not-set": "Not set up",
  disconnected: "Disconnected",
  connected: "Connected",
};

/** The one outstanding action a provider's state implies. */
export function nextAction(state: ProviderReadiness["state"]): "install" | "enroll" | "connect" | null {
  switch (state) {
    case "not-installed":
      return "install";
    case "not-set":
      return "enroll";
    case "disconnected":
      return "connect";
    case "connected":
      return null;
  }
}

/**
 * Severity for the row's non-text affordance. `connected` is success,
 * `disconnected` is neutral (a tunnel you have not started is not a fault), and
 * the two setup states are advisory.
 */
export function readinessSeverity(state: ProviderReadiness["state"]): "success" | "warning" | "neutral" {
  if (state === "connected") return "success";
  if (state === "disconnected") return "neutral";
  return "warning";
}
