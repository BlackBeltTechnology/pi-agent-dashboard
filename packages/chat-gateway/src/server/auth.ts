/**
 * chat-gateway authorization (L1 allowlist, L2 bind authority, L4 channel
 * isolation) and the pairing code state machine.
 *
 * Fails CLOSED everywhere: every refusal carries a distinct reason string
 * (`not_allowlisted`, `not_admin`, `group_channel_not_opted_in`,
 * `ambiguous_identity`) so a refusal is never undifferentiated silence.
 *
 * See change: add-chat-gateway.
 */

import type { AuthAction, AuthDecision } from "../shared/types.js";

export interface AuthorizeInput {
  config: { allowlist: string[]; admins: string[]; groupChannels: string[] };
  userId: string;
  action: AuthAction;
  channelId: string;
  isDM: boolean;
}

export function authorize(input: AuthorizeInput): AuthDecision {
  const { config, userId, action, channelId, isDM } = input;

  // No usable identity -> nothing may be attributed to a user.
  if (typeof userId !== "string" || userId.trim() === "") {
    return { allowed: false, reason: "ambiguous_identity" };
  }

  // L4: a DM is always isolated; a guild channel must be explicitly opted in.
  if (!isDM && !(config.groupChannels ?? []).includes(channelId)) {
    return { allowed: false, reason: "group_channel_not_opted_in" };
  }

  // L1: talking at all requires the allowlist. Binding is strictly NARROWER
  // than talking, so it requires the allowlist too — admin alone is not enough.
  if (!(config.allowlist ?? []).includes(userId)) {
    return { allowed: false, reason: "not_allowlisted" };
  }

  // L2: binding additionally requires bind authority.
  if (action === "bind" && !(config.admins ?? []).includes(userId)) {
    return { allowed: false, reason: "not_admin" };
  }

  return { allowed: true, reason: "authorized" };
}

interface PairingState {
  code: string;
  expiresAt: number;
  attempts: number;
  locked: boolean;
}

export interface Pairing {
  state(): Readonly<PairingState>;
  currentCode(): string;
  /** Redeem a code. Consumes it on success; locks out after maxAttempts. */
  attempt(code: string): boolean;
}

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 10;

function generateCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

export function createPairing(opts: {
  now?: () => number;
  ttlMs?: number;
  maxAttempts?: number;
}): Pairing {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const state: PairingState = {
    code: generateCode(),
    expiresAt: now() + ttlMs,
    attempts: 0,
    locked: false,
  };

  return {
    state: () => ({ ...state }),
    currentCode: () => state.code,
    attempt(code: string): boolean {
      // A locked pairing never accepts a code again.
      if (state.locked) return false;
      if (now() > state.expiresAt) {
        state.code = ""; // expiry invalidates the code
        return false;
      }
      if (state.code !== "" && code === state.code) {
        state.code = ""; // consumed on success
        return true;
      }
      state.attempts += 1;
      if (state.attempts > maxAttempts) {
        state.locked = true;
        state.code = "";
      }
      return false;
    },
  };
}
