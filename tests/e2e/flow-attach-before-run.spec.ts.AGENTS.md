# flow-attach-before-run.spec.ts — index

L3 spec (change: attach-flow-before-run). Real pi-flows engine + faux agents; `e2e:synthetic` (alpha → beta).
F15: card `flows-open-button` → pick `synthetic` → `flow-dashboard` `data-flow-mode=idle`, "not started", 2 `[data-node]`, 2 `[data-step]`, `waiting: alpha` → `flow-idle-run` → `flow-launch-run` → `flow-summary-scrollbox`.
In-page MutationObserver records: same idle element flipped to `live` (no remount), no "not started" while live, max 1 panel. Faux flow finishes sub-second → transient states recorded, not polled.
F16: Run Flow… → observer records `flows-open-button` disabled during the run → enabled after summary.
Needs PI_E2E_SEED=1.
