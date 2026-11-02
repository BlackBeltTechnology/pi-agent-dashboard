/**
 * Prefix of a bridge device token issued over a proven TLS channel. The bridge
 * never sends such a token to a non-`https:` origin; the hub refuses (and marks
 * exposed) one presented on a non-proven channel.
 *
 * See change: prove-vault-bridge-tls (D9).
 */
export const TLS_ONLY_TOKEN_PREFIX = "pi_tls_";

/** 401 error code the hub answers when a `pi_tls_` bearer arrives off a proven channel. */
export const TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL = "tls_only_token_untrusted_channel";

/** True for a TLS-only bridge token. */
export function isTlsOnlyToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith(TLS_ONLY_TOKEN_PREFIX);
}
