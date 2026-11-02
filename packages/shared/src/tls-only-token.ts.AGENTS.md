# tls-only-token.ts — index

TLS-only bridge token marker. Exports `TLS_ONLY_TOKEN_PREFIX="pi_tls_"`, `isTlsOnlyToken`, `TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL`. Bridge never sends a `pi_tls_` token to a non-https origin; hub refuses and marks it off a proven channel. See change: prove-vault-bridge-tls.
