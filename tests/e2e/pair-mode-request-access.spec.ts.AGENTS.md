# pair-mode-request-access.spec.ts — index

F7/F8 (variant harness `PI_E2E_TRUST_MODE=pair`, `PI_E2E_OAUTH=0`; skips elsewhere): unpaired browser shows `network-denied-request-access` (not Offline), health carries `networkAccess`; click → same-context `/pair?request`. See change: surface-network-denial-on-health.
