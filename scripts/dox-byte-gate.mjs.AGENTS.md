# dox-byte-gate.mjs — index

AGENTS.md byte-cap gate for `ship-it` step 4.4. Filters `kb dox lint --json` to `kind:"over-threshold"` + `arm:"bytes"` and recomputes nothing — `packages/kb/src/dox.ts` owns `AGENTS_BYTE_CAP`. Must filter: raw `kb dox lint` exits 1 on any of 7 issue kinds and the tree carries 57 non-gating issues, so wiring it directly could never land green. Exports `byteArmIssues`. Fix a breach with `split-large-agents.mjs --write`. See change: wire-local-review-gate.
