# csp-report-sink-oauth.spec.ts — index

WF5: report sink POST public to armed OAuth gate; GET / unknown label gated. Needs `PI_E2E_OAUTH_NO_BYPASS=1` + narrowed `PI_E2E_TRUSTED_NETWORKS`; skips when gate unarmed. See change: harden-cors-and-csp-reporting.
