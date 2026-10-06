## 1. Tests first (red)

- [x] 1.1 In `packages/server/src/__tests__/worktree-init.test.ts`, with `process.env.NODE_OPTIONS="--foo --max-old-space-size=1536"` and `PI_DASHBOARD_HEAP_FLAG="--max-old-space-size=1536"` (restored after each test), capture the `env` passed to a stub `spawnFn` and assert for `runInitHook` script flavor: no `--max-old-space-size=1536`, `NODE_OPTIONS === "--foo"`, no `PI_DASHBOARD_HEAP_FLAG`
- [x] 1.2 Same assertion for `evaluateGate` and for the agent-flavor spawn
- [x] 1.3 Stamp-only case: `NODE_OPTIONS` equal to the marker token → child env has no `NODE_OPTIONS`
- [x] 1.4 Operator pin case: `NODE_OPTIONS="--max-old-space-size=8192"`, marker absent → preserved
- [x] 1.5 Explicit `opts.env` passed → child receives that object unchanged
- [x] 1.6 Assert `process.env` is not mutated by any call
- [x] 1.7 Run the file, confirm 1.1–1.3 fail

## 2. Implementation

- [x] 2.1 Add `defaultHookEnv()` in `packages/server/src/git-worktree/worktree-init.ts` = `stripDashboardHeapFlag({ ...process.env })` (import from `@blackbelt-technology/pi-dashboard-shared/heap-flags.js`)
- [x] 2.2 Replace `opts.env ?? process.env` with `opts.env ?? defaultHookEnv()` at the gate, script-run, and agent-spawn sites
- [x] 2.3 Tests green; run full `npm test` per AGENTS.md (pipefail + tee)

## 3. Closeout

- [x] 3.1 Update `worktree-init.ts` row in `packages/server/src/git-worktree/AGENTS.md` (`See change: strip-heap-flag-from-worktree-init`)
- [ ] 3.2 `review-code` pass on the diff
- [ ] 3.3 Manual QA: restart server, create a worktree from the dashboard, run init → `pnpm install` / `vite build` completes (no exit 134) (test-plan: manual-only)
