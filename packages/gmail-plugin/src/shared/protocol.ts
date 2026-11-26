/**
 * Bridge ↔ server request-lane contract (design D5). See change: add-gmail-plugin.
 */
import type { Tier } from "./scopes.js";

export const PLUGIN_ID = "gmail";
export const LEASE_TYPE = "gmail/lease";
export const ACCOUNTS_TYPE = "gmail/accounts";

/**
 * Google Connect (add-google-connect D1/D10): the only in-process service Gmail consumes, and the lanes
 * it follows a delegation to. The provider id is checked — a spoofing plugin is ignored.
 */
export const GOOGLE_PLUGIN_ID = "google";
export const GOOGLE_CONNECT_SERVICE = "google.connect";
export const GOOGLE_LEASE_TYPE = "google/lease";
export const GOOGLE_ACCOUNTS_TYPE = "google/accounts";

/** `gmail/lease` / `gmail/accounts` reply while Google Connect owns the accounts: follow it, no token inside. */
export interface DelegateReply {
  delegate: typeof GOOGLE_PLUGIN_ID;
}

export function isDelegateReply(v: unknown): v is DelegateReply {
  return !!v && typeof v === "object" && !Array.isArray(v) && (v as { delegate?: unknown }).delegate === GOOGLE_PLUGIN_ID;
}

/** `gmail/lease` success reply — exactly these keys, never a refresh token. */
export interface LeaseReply {
  accessToken: string;
  expiresAt: number;
  email: string;
  tier: Tier;
}

/** `gmail/accounts` reply row (secret-free). */
export interface AccountInfo {
  sub: string;
  email: string;
  alias?: string;
  tier: Tier;
  status: "ok" | "reauth_required";
  testingHint?: boolean;
  /** Filters option (Gmail filter tools); absent = off. */
  filters?: boolean;
  addedAt: number;
}
