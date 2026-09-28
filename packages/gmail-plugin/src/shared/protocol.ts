/**
 * Bridge ↔ server request-lane contract (design D5). See change: add-gmail-plugin.
 */
import type { Tier } from "./scopes.js";

export const PLUGIN_ID = "gmail";
export const LEASE_TYPE = "gmail/lease";
export const ACCOUNTS_TYPE = "gmail/accounts";

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
  addedAt: number;
}
