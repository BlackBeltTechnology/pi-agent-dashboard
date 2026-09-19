# network-guard.spec.ts — index

L3 flagship refusal (test-plan #S20, change: add-universal-network-guard): auth OFF + untrusted peer ⇒ `GET /` still serves the app shell while `POST /api/plugins/automation/create` is 403 `network_not_allowed`. SELF-GATING on `PW_E2E_GUARD_UNTRUSTED=1` — the harness defaults to trust-any `0.0.0.0/0`, so it must be booted with a narrow `PI_E2E_TRUSTED_NETWORKS` (see the spec header). Deliberately does NOT clear `trustedNetworks` at runtime: with auth off there is no cookie branch and no `bypassUrls` exception, so it could not be restored.
