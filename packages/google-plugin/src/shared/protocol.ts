/**
 * Bridge ↔ server request-lane contract. `google/lease` returns a live access token,
 * `google/accounts` lists identities — both are hub-local-only on the host.
 * See change: add-google-connect.
 */
export const LEASE_TYPE = "google/lease";
export const ACCOUNTS_TYPE = "google/accounts";
/** Service name `provide`d for the gmail plugin's one-time legacy import. */
export const CONNECT_SERVICE = "google.connect";

/** `google/lease` success reply — exactly these keys, never a refresh token. */
export interface LeaseReply {
  accessToken: string;
  expiresAt: number;
  email: string;
  level: string;
  /** Enabled product options (non-secret), present only when the selection has any. */
  options?: Record<string, boolean>;
}

/** Refusal codes of a lease (design D7, D14 A13/A14). Thrown as `<code>: <detail>`. */
export type LeaseRefusal =
  | "bad_request"
  | "not_found"
  | "ambiguous"
  | "product_disabled"
  | "level_insufficient"
  | "scope_missing"
  | "default_client_unavailable"
  | "no_client"
  | "reauth_required"
  | "refresh_failed";

export type AccountStatus = "ok" | "reauth_required";
