# Tasks — automation-ui-mockup-parity

## 1. Board visual language (client + global CSS, no backend)
- [ ] 1.1 New `src/client/automation-card-visuals.ts`: local replica of the status→class mapping (rail color, dot color + pulse, headless source icon, stripe class, glow/ring classes) keyed off automation state (valid/disabled/running) → verify: unit test maps each state to expected classes.
- [ ] 1.2 `AutomationCard` renders the session-card shell: status rail, status dot, headless icon, name + scope pill + status **pill** badge; running card gets `card-stripes-fx card-stripes-running`; selected card gets `card-glow-fx`/`card-glow-fx-outer`/`card-ring-fx` → verify: classes present by state (test); `prefers-reduced-motion` path relies on global CSS (no JS gate needed).
- [ ] 1.3 Per-card last-run summary row: latest run for the automation (status pill + relative time + findings + result/log link), derived from the fetched runs → verify: card shows last-run summary when a run exists, nothing when none (test).
- [ ] 1.4 Card meta adds `mode` (worktree/local); board header adds the repo crumb → verify: meta shows mode, header shows decoded repo name (test).

## 2. Editor visual polish (client only)
- [ ] 2.1 Wrap groups (Identity/Trigger/Action/Advanced) in bordered boxes; keep Advanced collapsed → verify: group boxes render, Advanced collapsed (test).
- [ ] 2.2 Segmented controls for Scope and Action kind (replace plain `<select>`) → verify: segmented control writes correct scope/action (test).
- [ ] 2.3 Trigger category pills with icons + styled event checklist grid → verify: pills render, multi-select still writes `on.events` (test).
- [ ] 2.4 Relative next-run preview ("in 18h 12m") + pulsing green dot; keep raw-cron escape → verify: preview shows relative time, raw cron still written (test).
- [ ] 2.5 Header scope/path subtitle + pill-styled "armed on save" chip; footer caption → verify: subtitle + chip + caption render (test).

## 3. Findings count (server)
- [ ] 3.1 `run-store.ts`: compute a findings count from `result.md` on finish (heuristic: top-level markdown bullet lines; `0` when empty/auto-archived); persist it → verify: result with N bullets → findings=N; empty → 0 (test).
- [ ] 3.2 Add `findings?: number` to `RunRecord` in `shared/automation-types.ts`; surface via the `/runs` route payload → verify: type present, route returns findings (test).
- [ ] 3.3 Client renders findings in the per-card last-run summary and the runs table → verify: "N findings" shown when findings>0, "empty" when archived (test).

## 4. Stop a running run (host context extension)
- [ ] 4.1 `dashboard-plugin-runtime/server/server-context.ts`: add `AbortSessionFn` type + `abortSession` on `ServerPluginContext` and `ServerContextDeps`; wire in `createServerPluginContext`; gate like `spawnSession` (trusted plugins only) → verify: context exposes `abortSession`; untrusted plugin gets a no-op/false (test).
- [ ] 4.2 Host: supply `abortSession` when building the plugin context, routing to `piGateway.sendToSession(id, { type: "abort", sessionId: id })` → verify: calling `abortSession(id)` sends the abort control message (test with injected gateway).
- [ ] 4.3 Engine `stopRun(runId)`: look up the run's `sessionId`, call `abortSession`, finalize the run record idempotently so the later `agent_end` does NOT double-finish → verify: stopRun finalizes once; subsequent `onSessionEnded` is a no-op for that run (test).
- [ ] 4.4 `routes.ts`: `POST /api/plugins/automation/stop` (scope + cwd + runId) → engine `stopRun`; `index.ts` passes `abortSession` into the engine → verify: route returns ok and aborts the run (test with injected engine).
- [ ] 4.5 Client: `stopAutomationRun(...)` in `api.ts`; Stop action on running cards + `⋯` overflow holding Delete; refresh after stop → verify: Stop shown only when running, calls `/stop`, card transitions (test).

## 5. Wiring + docs + rebuild
- [ ] 5.1 Confirm the host abort by `sessionId` reaches a connected automation run bridge (headless spawn) → verify: integration check or documented limitation if the run session is not bridge-connected.
- [ ] 5.2 Update `docs/file-index-plugins.md` (new `automation-card-visuals.ts`, touched board/editor/engine/routes/run-store/api/types rows) and `docs/file-index-server.md` (`server-context.ts` `abortSession`) — caveman style, delegated to a subagent → verify: rows present.
- [ ] 5.3 Full rebuild + restart + reload per AGENTS.md (`npm run build` → `POST /api/restart` → `npm run reload`); `npm test` green → verify: board + editor render live, Stop works, findings show.
