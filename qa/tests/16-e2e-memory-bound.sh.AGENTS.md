# 16-e2e-memory-bound.sh — index

L2 memory-bound smoke over an ALREADY-RUNNING harness (never boots/tears down; port from `.pi-test-harness.json`). Asserts P1 (late `memory.current` ≤ early + 10 %), P3 (resident-`pi` vs live-session divergence) and P4 (container healthy, no unexplained daemon restart). `live_sessions()` fails loudly on a bad response rather than reporting 0. Bash 3.2-safe (no `mapfile`). See change: fix-e2e-harness-memory-exhaustion, fix-tmux-session-shutdown-leak.
