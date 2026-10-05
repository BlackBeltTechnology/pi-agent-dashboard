/**
 * Closed set of fixed, input-free codes a Gmail sign-in flow can terminate
 * with (design D2/D3). Shared by the server failure log (allow-list) and the
 * client error table. See change: improve-gmail-settings-ux.
 */
export const KNOWN_FLOW_CODES = [
  "org_internal",
  "access_denied",
  "admin_policy_enforced",
  "redirect_uri_mismatch",
  "invalid_client",
  "scope_missing",
  "account_mismatch",
  "missing_refresh",
  "email_unverified",
  "invalid_redirect",
  "state_mismatch",
  "callback_failed",
  "token_exchange_failed",
  "id_token_invalid",
  "authorization_failed",
  "timeout",
  "start_timeout",
  "login_failed",
  "cancelled",
  "aborted",
] as const;

export type FlowCode = (typeof KNOWN_FLOW_CODES)[number];

const KNOWN = new Set<string>(KNOWN_FLOW_CODES);

/** `code` when it is a string in {@link KNOWN_FLOW_CODES}, else `null` (exact match). */
export function knownFlowCode(code: unknown): FlowCode | null {
  return typeof code === "string" && KNOWN.has(code) ? (code as FlowCode) : null;
}
