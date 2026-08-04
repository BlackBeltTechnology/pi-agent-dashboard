# replay-rss-soak.mjs — index

P4 (L2) replay RSS soak for `compact-warm-replay-stream` (#399). Repeats N cold subscribes (`lastSeq:0` → full replay) over `ws://localhost:<port>/ws` against a RUNNING dashboard, samples `server.rss` from `/api/health` each iteration, settles 30s for GC, asserts settled RSS ≤ baseline×(1+tolerance). Args `--port --iterations (10) --tolerance (0.10)`; port falls back to `PW_E2E_PORT` then `dashboardPort` in `.pi-test-harness.json` — never hardcodes 18000. ON-DEMAND probe, NOT a CI gate (RSS is too noisy for a non-flaky threshold).
