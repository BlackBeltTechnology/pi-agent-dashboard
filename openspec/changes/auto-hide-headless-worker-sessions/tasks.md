## 1. Shared protocol: register fields

- [ ] 1.1 In `packages/shared/src/protocol.ts`, add optional `hasUI?: boolean` and `visibilityIntent?: "hidden" | "visible"` to `SessionRegisterMessage`, with doc comments (fact-forwarding from bridge; server decides).
- [ ] 1.2 Type-check passes across packages (`npm run reload:check` or `tsc`).

## 2. Bridge: forward hasUI + env intent

- [ ] 2.1 (DECISION 4) Read `PI_DASHBOARD_HIDDEN` / `PI_DASHBOARD_VISIBLE` (or chosen shape) once; resolve to `visibilityIntent` (`VISIBLE` wins if both set; absent ⇒ undefined).
- [ ] 2.2 In `packages/extension/src/bridge.ts`, include `hasUI: cachedHasUI` and `visibilityIntent` in the `session_register` payload (near `source: detectSessionSource(...)`, ~line 1795).
- [ ] 2.3 Bridge test: a print-mode (hasUI=false) register carries `hasUI: false`; a TUI register carries `hasUI: true`; env intent maps to `visibilityIntent`.

## 3. Server: auto-hide decision at first register

- [ ] 3.1 In `packages/server/src/event-wiring.ts` (`session_register` handler, ~line 444), thread `hasUI` and `visibilityIntent` from the message into the registration params.
- [ ] 3.2 In `packages/server/src/memory-session-manager.ts` (~line 105), replace unconditional `hidden: false` with: if `existing` present → `hidden: existing.hidden`; else compute `visibilityIntent`-override-then-heuristic (`hasUI === false && source !== "dashboard"`).
- [ ] 3.3 Unit tests: first register headless+non-dashboard → `hidden: true`; first register TUI → `hidden: false`; first register headless+dashboard → `hidden: false`; `visibilityIntent: "visible"` on headless → `hidden: false`; `visibilityIntent: "hidden"` on TUI → `hidden: true`.
- [ ] 3.4 Unit test (one-shot): a re-register (existing record) preserves `existing.hidden` regardless of `hasUI` — manual unhide survives reattach.
- [ ] 3.5 (Risk) Verify reattach after server restart sources `existing.hidden` from persisted store before re-evaluating; add test if the rebuild path can lose a manual unhide.

## 4. Skill doc (optional)

- [ ] 4.1 (DECISION 5) If yes: update `parallel-pi-model-workers` SKILL.md to recommend `PI_DASHBOARD_HIDDEN=1` on the worker launch line.

## 5. Verification

- [ ] 5.1 Manual: spawn 3 `pi -p` workers → no new visible cards; `Show hidden` reveals them with `[↩]`.
- [ ] 5.2 Manual: unhide one worker → it stays visible after the dashboard restarts (reattach).
- [ ] 5.3 Manual: a normal TUI session and a dashboard-spawned headless session remain visible throughout.
- [ ] 5.4 `npm test` green; `openspec validate auto-hide-headless-worker-sessions` passes.
