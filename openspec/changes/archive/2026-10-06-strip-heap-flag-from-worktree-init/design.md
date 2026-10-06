## Context

`server-launcher.ts` stamps `--max-old-space-size=<serverHeap>` into the server's `NODE_OPTIONS` and records the exact token in `PI_DASHBOARD_HEAP_FLAG` (`stampHeapFlag`). Children that are user-facing must not inherit it: `terminal-manager.ts` and `process-manager.ts` already call `stripDashboardHeapFlag`. `worktree-init.ts` spawns three children with `env: opts.env ?? process.env`, and `git-routes.ts` (`runInitHook` at :554, `evaluateGate` at :137) never passes `env` — so all three inherit the cap.

## Goals / Non-Goals

**Goals:** hook children run with Node's default heap (or the operator's own pin); keep unrelated `NODE_OPTIONS`; keep the `opts.env` test/caller override.

**Non-Goals:** auditing other spawn sites; changing `serverHeap` defaults; stripping operator-pinned flags.

## Decisions

- **D1 — Reuse `stripDashboardHeapFlag`.** Provenance-gated, quote-aware, already tested (`heap-flags-quoted-options.test.ts`). Alternative (issue text): strip any `--max-old-space-size` — rejected; it would remove a deliberate operator pin and diverge from the terminal/session behavior (design D4 of `bound-session-heap-and-gc-telemetry`).
- **D2 — One module-local helper** `defaultHookEnv(): NodeJS.ProcessEnv` returning `stripDashboardHeapFlag({ ...process.env })`; each site uses `opts.env ?? defaultHookEnv()`. Copy is required — the strip mutates, and `process.env` must stay intact for the server.
- **D3 — Strip at the runner, not the route.** Fixes every caller (route, gate cache, agent-flavor internal `evalGate`) in one file; route stays unchanged.

## Risks / Trade-offs

- [Hook now uses the default V8 heap (~4 GB on 64-bit)] → intended; matches running the command in a terminal.
- [Stale/mismatched marker] → `stripDashboardHeapFlag` no-ops on mismatch (safe: today's behavior), drops orphan marker.

## Migration Plan

Server-only change; land, then `curl -X POST http://localhost:8000/api/restart`. Rollback: revert commit + restart. No persisted state.
