# inline-terminal-transcript.spec.ts — index

L3 gate for `preserve-inline-terminal-transcript`: F1 exit-then-close keeps scrollback, F2/F3 untouched card removed, F4/F5 any input (incl. arrows/Tab) freezes, F7/F8 replay convergence, F9 two-browser identity, F10/F11 live/dead-PTY reattach regressions, P1 close→frozen latency. Selects `terminal-card` + `data-terminal-state` (live\|frozen); `openInline()` falls back to the ⋯ `overflow-button` menu below the composer's `@[44rem]` breakpoint; widens viewport to 1680×900. Manual harness runs REQUIRE `PI_E2E_SEED=1 PI_TEST_PEERS=both`.
