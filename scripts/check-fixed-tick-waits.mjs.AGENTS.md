# check-fixed-tick-waits.mjs — index

Fixed-tick wait guard, run by ci.yml (standalone step) + ship gate. Bans `await new Promise((r) => setTimeout(r, …))` barriers in client test files; per-occurrence opt-out marker `// fixed-tick-waits: opt-out — <reason>` on the line directly above. Exports `analyzeFixedTickWaits(root)`, `CLIENT_SRC`, `REPO_ROOT`. Exit non-zero iff ≥1 violation; violations named on stderr. See change: make-test-suite-deterministic.
