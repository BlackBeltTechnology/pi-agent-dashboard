/**
 * Reserved-name input state — the pure half of Gateway Setup step 3.
 *
 * Kept out of the component so the seven states the step can be in (idle,
 * typing-valid, invalid, taken, write-failed, reserved, replace-confirm) are
 * testable as a function of inputs rather than as rendered DOM.
 *
 * The client-side regex MIRRORS the server's `RESERVED_NAME_RE`. It is a
 * latency affordance, never the authority: the server re-validates before the
 * name reaches zrok argv, because a client check is not a security boundary.
 *
 * See change: add-zrok-custom-reserved-name (D1).
 */
import type { ReservedNameResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

/** Mirror of the server's `RESERVED_NAME_RE` — DNS-safe label, ≤63, no leading hyphen. */
export const RESERVED_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export const RESERVED_NAME_MAX = 63;

export type ReservedNameStepState =
  /** No name stored and the field is empty. */
  | { kind: "idle" }
  /** Field holds a name that passes the local mirror; the round trip may still reject it. */
  | { kind: "typing-valid"; name: string }
  /** Locally rejected — no request is worth making. */
  | { kind: "invalid"; name: string; message: string }
  /** Server said the name is not usable. */
  | { kind: "taken"; name: string; message: string }
  /** Reserved remotely but not persisted; serving it would orphan it. */
  | { kind: "write-failed"; name: string; message: string }
  /** A name is stored and in effect. */
  | { kind: "reserved"; name: string; liveUrlUnchanged?: string; tunnelStopped?: boolean }
  /** A different name is stored: replacing it DESTROYS the old URL. */
  | { kind: "replace-confirm"; current: string; next: string };

/**
 * Why a name fails the local mirror, phrased so the message states a FIX rather
 * than restating the rejection. `null` when the name is acceptable.
 */
export function localValidationError(name: string): string | null {
  if (name.length === 0) return "Enter a name, or clear the field to use an ephemeral URL.";
  if (name.length > RESERVED_NAME_MAX) {
    return `Too long — use at most ${RESERVED_NAME_MAX} characters (this is ${name.length}).`;
  }
  if (name.startsWith("-")) return "Cannot start with a hyphen — start with a letter or a digit.";
  if (/_/.test(name)) return "Underscores are not allowed — use hyphens instead.";
  if (!RESERVED_NAME_RE.test(name)) {
    return "Use only letters, digits and hyphens, starting with a letter or a digit.";
  }
  return null;
}

/**
 * State of the step given what is stored, what is typed, and the last server
 * outcome.
 *
 * `submitted` distinguishes "the user has not asked yet" from "the server
 * answered": an untouched field showing a stored name must render as `reserved`,
 * not re-litigate a previous rejection.
 */
export function reservedNameStepState(input: {
  stored?: string;
  draft: string;
  /** The most recent server outcome, if any, for the CURRENT draft. */
  outcome?: ReservedNameResult;
  /** True once the user has committed the draft (blur or submit). */
  submitted?: boolean;
  /** True while the user is confirming a destructive replace. */
  confirming?: boolean;
}): ReservedNameStepState {
  const { stored, draft, outcome, submitted, confirming } = input;
  const trimmed = draft.trim();

  if (confirming && stored && trimmed && trimmed !== stored) {
    return { kind: "replace-confirm", current: stored, next: trimmed };
  }

  if (submitted && outcome && outcome.name === trimmed) {
    switch (outcome.status) {
      case "ok":
        return {
          kind: "reserved",
          name: outcome.name,
          liveUrlUnchanged: outcome.liveUrlUnchanged,
          tunnelStopped: outcome.tunnelStopped,
        };
      case "taken":
        return { kind: "taken", name: outcome.name, message: outcome.message ?? "That name is not available." };
      case "write-failed":
        return {
          kind: "write-failed",
          name: outcome.name,
          message: outcome.message ?? "Reserved, but the name could not be saved.",
        };
      case "invalid":
        return { kind: "invalid", name: outcome.name, message: outcome.message ?? "That name is not valid." };
    }
  }

  if (trimmed.length === 0) return stored ? { kind: "reserved", name: stored } : { kind: "idle" };

  const localError = localValidationError(trimmed);
  if (localError) return { kind: "invalid", name: trimmed, message: localError };
  if (stored && trimmed === stored) return { kind: "reserved", name: stored };
  return { kind: "typing-valid", name: trimmed };
}

/** The URL a reserved name resolves to, for confirmation copy that names it exactly. */
export function reservedNameUrl(name: string): string {
  return `https://${name}.shares.zrok.io`;
}

/**
 * Replacing a stored name RELEASES it immediately, returning it to zrok's
 * global pool where anyone may claim it. A user may have shared that URL, so
 * the action is confirm-gated and the copy names the exact URL being destroyed
 * rather than saying "the old name".
 */
export function needsReplaceConfirm(stored: string | undefined, draft: string): boolean {
  const trimmed = draft.trim();
  return Boolean(stored) && trimmed.length > 0 && trimmed !== stored;
}
