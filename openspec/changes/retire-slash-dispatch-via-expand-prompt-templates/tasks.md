# Tasks — retire-slash-dispatch-via-expand-prompt-templates

Scenario ids reference `test-plan.md` (the manifest; disposition per row lives there).

## 1. Doubt-driven review closeout (before anything stands)

- [ ] 1.1 Re-grep `dispatch_extension_command` across `packages/*/src`, `tests/e2e`, `qa/`, `docker/` — confirm producer is only `slash-dispatch.ts` Path C and consumers are `server.ts` / `event-wiring.ts` L~2312 / `dispatch-router.ts` / `shared/protocol.ts`
- [ ] 1.2 Re-grep `writeRpc(` / `writeRpcToSockPath(` callers — confirm only `dispatch-router.ts` + tests (`keeper-manager.test.ts`, `headless-pid-registry.test.ts`, `cwd-policy-funnel.test.ts`, `process-manager-keeper-spawn.test.ts`)
- [ ] 1.3 Confirm on the installed pi (`dist/core/agent-session.js`): `prompt()` runs `_tryExecuteExtensionCommand` before the compaction guard and before `streamingBehavior`; `ExtensionAPI.sendUserMessage` (`loader.js`) is `assertActive()` + void call; note both line refs in the `slash-dispatch.ts` header comment
- [ ] 1.4 Confirm `process.argv[1]` inside a dashboard-spawned pi is pi's CLI entry under the package dir (log it once from the bridge in a scratch session) so the argv-anchored walk-up is sound

## 2. Extension tests first (L1, vitest — verify each FAILS before §3)

- [ ] 2.1 In `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` (harness exemplar: its existing `tryDispatchExtensionCommand` stubs + sink recorder), replace Path B/C/D cases with: headless stub → `sendUserMessage("/ctx-stats",{expandPromptTemplates:true,deliverAs:"followUp"})`, sink `[started,completed]`, no `connection.send` (test-plan E1); non-headless env → identical, no `RPC_KEEPER_HINT` text (E2)
- [ ] 2.2 Same file: `delivery:"steer"` → `deliverAs:"steer"` (E3); omitted → `"followUp"` (E4)
- [ ] 2.3 Same file, injected version reader: `"0.84.1"` → `[started,error]` containing `require pi 0.84.2+`, no `sendUserMessage` (E5); `"0.84.2"` → dispatch (E6); `"0.84.3"` → dispatch (E7); `"dev"` → dispatch + one distinct `console.warn` (E11); reader returns `undefined` twice → dispatch + exactly one `console.warn` (E10)
- [ ] 2.4 Same file, fault cases: `sendUserMessage` throws `"Extension context is stale"` → `[started,error]` with that message, no `completed`, returns `true` (X1); reader throws → wrapper yields `undefined`, `[started,completed]`, no unhandled rejection (X2); `getCommands` throws → returns `false`, empty sink (X3)
- [ ] 2.5 Same file: invariant over E1/E5/E10/X1/X2 sinks — exactly one `started`, exactly one terminal, in order (E18); drop the `describe("hasDispatchCommand")` block at L~444
- [ ] 2.6 In `packages/extension/src/__tests__/pi-version-tracker.test.ts` (harness exemplar: its `readPkgVersionByWalkUp` fs/resolver stubs), add `readRunningPiVersion` cases: argv[1] under `@mariozechner/pi-coding-agent` manifest `0.73.1` → `"0.73.1"` (E8); argv[1] walks to earendil `0.80.10` while a by-name resolver stub returns `0.85.1` → `"0.80.10"`, resolver never called (E9); no matching manifest → `undefined` (E10 half)
- [ ] 2.7 In `packages/extension/src/__tests__/extension-slash-command-detection.test.ts` (exemplar: its own table), keep detection tests; assert `/__dashboard_reload` → `false` (E12), `/roles` → `false` (E13), multi-line → `false` (E14); drop its `describe("hasDispatchCommand")` block (L~85–112)
- [ ] 2.8 In `packages/extension/src/__tests__/command-handler.test.ts` (exemplar: its `parseSendPrompt` + `getFlowsList` stubs): flow name collision `/deploy-prod` → `flow:run`, no flagged `sendUserMessage` (E15); `/flows:new` → `sendUserMessage("/flows:new",{expandPromptTemplates:true,deliverAs:"followUp"})`, `expandPromptTemplateFromDisk` not called (E16); `/foo` with extension `foo` AND temp-cwd `.pi/prompts/dashboard-foo.md` `executable: bash` → flagged dispatch, no `bash_output` (E17); `/skill:foo hi` with temp `SKILL.md` → `sendUserMessage(<content+" hi">,{deliverAs:"followUp"})` and NO `expandPromptTemplates` key (E20); both call sites pass `delivery`, helper has no `connection` param (E19)

## 3. Extension implementation

- [ ] 3.1 `packages/extension/src/model-tracker.ts`: add `readRunningPiVersion(argv1 = process.argv[1], fs stubs)` — walk up from `dirname(argv1)` via `readPkgVersionByWalkUp` accepting either pi package name; whole body try/catch → `undefined`
- [ ] 3.2 `packages/extension/src/slash-dispatch.ts`: replace Paths B/C/D with gate + single call per design D1/D3 (`isAtLeast` local triplet compare; three distinct outcomes; `console.warn` once per process per reason); detection + read + call inside one try; emit `started` → `completed`/`error`; signature `(pi, text, sessionId, sink, delivery?, readVersion?)`; remove `connection`, `DispatchConnection`, unused `crypto` import; new error text "Extension slash commands from the dashboard require pi 0.84.2+"
- [ ] 3.3 `packages/extension/src/bridge-context.ts`: delete `hasDispatchCommand`; keep `isHeadlessRpcSession` (live caller `bridge.ts` `isHeadless:`)
- [ ] 3.4 `bridge.ts` `sessionPrompt` and `command-handler.ts` slash else-arm: drop `connection` arg, pass `delivery`
- [ ] 3.5 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — extension suite green

## 4. Server + shared tests first, then removal

- [ ] 4.1 Add `packages/server/src/__tests__/event-wiring-dispatch-tombstone.test.ts` (harness exemplar: `event-wiring-queue-state.test.ts` for the handler-context stub; `dispatch-extension-command-router.test.ts` for the `emitCommandFeedback` spy shape — copy before deleting it): inject `dispatch_extension_command {sessionId,command:"/ctx-stats",requestId}` → `insertEvent` once with `command_feedback {command:"/ctx-stats",status:"error",message:"bridge outdated — reload the session"}`, broadcast once, `console.warn` once, no keeper write (F3); `insertEvent` throws → handler does not throw, still logs (X4). Verify FAILS first
- [ ] 4.2 Delete `packages/server/src/rpc-keeper/dispatch-router.ts` and `packages/server/src/__tests__/dispatch-extension-command-router.test.ts`
- [ ] 4.3 `event-wiring.ts` L~2312: replace the router call with the tombstone (`emitCommandFeedback(...)` + `console.warn`); `packages/shared/src/protocol.ts`: mark `DispatchExtensionCommandMessage` `@deprecated` pointing at this change
- [ ] 4.4 Remove `writeRpc` + `writeRpcToSockPath` from `rpc-keeper/keeper-manager.ts` and `spawn-process/headless-pid-registry.ts` (`KeeperWriter` keeps `discoverExistingKeepers`); remove their cases in `keeper-manager.test.ts`, `headless-pid-registry.test.ts`, the mock in `cwd-policy-funnel.test.ts`, and `writeRpc`/`writeRpcToSockPath`/`writeCalls` from the `km` literal in `process-manager-keeper-spawn.test.ts`
- [ ] 4.5 Update stale comments: `server.ts` L~2227 `setKeeperWriter` (`writeRpc` mention), `headless-pid-registry.ts` `HeadlessEntry.keeperSockPath` doc, `process-manager.ts` L~219, `dispatch-reload.ts` L~27–40 (qualify the measurement: "on pi < 0.84.2; rpc-mode `prompt()` defaults `expandPromptTemplates` true since 0.84.2")
- [ ] 4.6 `npx tsc --noEmit -p packages/server && npx tsc --noEmit -p packages/extension && npx tsc --noEmit -p packages/shared`; `rg 'writeRpc' packages/server/src` → no call sites (X5); full `npm test` green

## 5. Rendered / end-to-end (L3 Playwright vs docker harness)

- [ ] 5.1 Add `tests/e2e/extension-slash-inprocess.spec.ts` (harness exemplar: `tests/e2e/coalesced-streaming.spec.ts` for `spawnFreshGitSession` + `sendPrompt`; `tests/e2e/apple-tools-activation.spec.ts` for pill `getByTestId` assertions): fresh headless session → `sendPrompt(page,"/dashboard-where")` → pill for `/dashboard-where` converges to `completed` within 10 s; transcript has no user row `/dashboard-where` and no assistant row; no `error` pill (test-plan F1)
- [ ] 5.2 Same spec: reload page, reopen session → pill still `completed` after replay (F2)
- [ ] 5.3 Run per `run-dashboard-e2e-local-changes` skill so the harness reflects local code, always teardown

## 6. Manual (deferred post-merge by ship-change)

- [ ] 6.1 tmux-hosted pi with bridge: type `/dashboard-where` in the dashboard composer → pill `completed`, terminal stderr shows `[dashboard] where:`, no model turn (test-plan: manual-only, F4)

## 7. Withdraw the superseded change

- [ ] 7.1 Delete `openspec/changes/retire-rpc-keeper-when-dispatchcommand-available/` (user decision at planning; its Phase 0 upstream `dispatchCommand` PR is moot); `openspec list --json` no longer lists it

## 8. Docs (DocScribe for `docs/`; main agent for source-tree rows)

- [ ] 8.1 `docs/slash-command.md`: rewrite step 9 + surface map (single dispatch, gate, tombstone); mark Paths B/C/D retired with this change id
- [ ] 8.2 `docs/architecture.md` § RPC keeper sidecar: purpose sentence → durable stdin owner; slash dispatch retired by this change
- [ ] 8.3 Source-tree rows: `packages/extension/src/AGENTS.md` (`slash-dispatch.ts`, `bridge-context.ts`, `model-tracker.ts`) + `slash-dispatch.ts.AGENTS.md`; `packages/server/src/rpc-keeper/AGENTS.md` (drop `dispatch-router.ts`, note tombstone location); `packages/server/src/spawn-process/headless-pid-registry.AGENTS.md` (`writeRpc` gone); `packages/shared/src/AGENTS.md` (`protocol.ts` deprecated type); `tests/e2e/AGENTS.md` new spec row
- [ ] 8.4 `openspec/specs/extension-rpc-dispatch/spec.md` `## Purpose` — rewrite by hand at archive time (Purpose is outside delta sync) to the DEPRECATED pointer
- [ ] 8.5 `CHANGELOG.md` `## [Unreleased]`: "Extension slash commands sent from the dashboard now dispatch in-process and work in tmux/terminal sessions; `dispatch_extension_command` is a deprecated tombstone; pi < 0.84.2 gets an explicit error"

## 9. Simplify + review + rebuild

- [ ] 9.1 `code-simplification` pass on `slash-dispatch.ts` — one gate, one call, no residue of three paths
- [ ] 9.2 `review-code` before commit; `npm run quality:changed`
- [ ] 9.3 Rebuild order: `npm run reload` (bridges) THEN `curl -X POST http://localhost:8000/api/restart` (server/shared) — tombstone should not fire on the local instance
