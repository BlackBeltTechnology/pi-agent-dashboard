## 1. Shared protocol and types

- [ ] 1.1 Add `PathYoloRequestMessage` (`path_yolo_request`: `requestId`, `sessionId`, absolute `path`, `access`, `tool`), `PathYoloResultMessage` (`requestId`, `verdict: "auto-allow" | "refused" | "decline"`) and `PathGateRefusalMessage` (`path_gate_refusal`: `sessionId`, `promptId`, `path`, `subject`) to `packages/shared/src/protocol.ts` unions; make `DashboardIdentityMessage.grantStoreId` optional and add `features?: string[]`. Verify `npx tsc -p packages/shared --noEmit` and server/extension typecheck pass.
- [ ] 1.2 Add `type YoloSurfaceId = AccessPlaneId | "agent-path"` to `packages/shared/src/browser-protocol.ts`, leaving `AccessPlaneId` closed; verify `GrantPromptDialog.tsx` maps still typecheck unchanged.

## 2. Shared resolved-subject containment (TDD)

- [ ] 2.1 Test (test-plan #E16) in `packages/shared/src/__tests__/` or `packages/server/src/access/__tests__/canonical-subject.test.ts` (exemplar: that file): ancestor `/x/repo` real; candidates `/x/repo/a/new` (absent), `/x/repo-secrets/f`, `/x/repo`, unresolvable ancestor, `caseInsensitive:true` `/X/REPO/a` · `isResolvedSubjectWithin` · `true,false,true,false,true` and `isSubjectWithin(/x/repo/a/new,/x/repo)` stays `false`. Verify it fails first.
- [ ] 2.2 Extract `withinCanonical` from `isSubjectWithin` and add `isResolvedSubjectWithin` in `packages/shared/src/canonical-subject.ts` (design D4); verify 2.1 and the existing canonical-subject tests pass.

## 3. Server — YoloController (TDD)

- [ ] 3.1 Test (test-plan #E1) in `packages/server/src/access/__tests__/yolo.test.ts` (exemplar: same file): unscoped session, abs path `<tmpdir>/outside/f.txt` · `decideAgentPath({path, hostGateMode:"enforce"})` · `"auto-allow"`, `autoAllowed` +1, last history `{plane:"agent-path", outcome:"auto-allowed"}`.
- [ ] 3.2 Test (test-plan #E2) in `yolo.test.ts`: scoped root `R`, path in a sibling of `R` · `decideAgentPath` · `null`, no history, `autoAllowed` unchanged.
- [ ] 3.3 Test (test-plan #E3) in `yolo.test.ts`: root `R`, `R/data/new.json` with `R/data` absent · `decideAgentPath` · `"auto-allow"`.
- [ ] 3.4 Test (test-plan #E4) in `yolo.test.ts`: held+eligible filesystem plane, subject `R/new.json` absent, capability held · `decide()` · `"auto-allow"`.
- [ ] 3.5 Test (test-plan #E5) in `yolo.test.ts`: `R/link` → outside dir, `R/link/new.conf` absent · `decideAgentPath` · `null`.
- [ ] 3.6 Test (test-plan #E6) in `yolo.test.ts`: unscoped, injected home `H`, path `H/.pi/agent/x.json` · `decideAgentPath` · `null`.
- [ ] 3.7 Test (test-plan #E7) in `yolo.test.ts`: unscoped, path `/etc/cron.d/job` · `decideAgentPath` · `null`, no history entry.
- [ ] 3.8 Test (test-plan #E8) in `yolo.test.ts`: unscoped, absent `realpath(os.tmpdir())/yolo-new-<rand>.txt` · `decideAgentPath` · `"auto-allow"`.
- [ ] 3.9 Test (test-plan #E9) in `yolo.test.ts`: unscoped, injected home `H`, path `H/proj/new.txt` · `decideAgentPath` · `"auto-allow"`.
- [ ] 3.10 Test (test-plan #E10) in `yolo.test.ts`: unscoped, path `foo/bar.txt` · `decideAgentPath` · `null`.
- [ ] 3.11 Test (test-plan #E11) in `yolo.test.ts`: live unscoped session · `decideAgentPath({hostGateMode:"report"})` · `null`.
- [ ] 3.12 Test (test-plan #E12) in `yolo.test.ts`: session auto-allowed once; (a) `now` at `expiresAt`, (b) `end()` · `decideAgentPath` same path · `null` both, `status()` null after (a).
- [ ] 3.13 Test (test-plan #E13) in `yolo.test.ts`: unscoped, `isRefused("agent-path", D)` true, path `D/b.txt` · `decideAgentPath` · `"refused-by-prior-refusal"`, history outcome matches, `refusedByPriorRefusal` +1, `autoAllowed` unchanged.
- [ ] 3.14 Test (test-plan #E14) in `yolo.test.ts`: refusal for `D`, path `D/sub/c.txt` with `D/sub` existing · `decideAgentPath` · `"auto-allow"`.
- [ ] 3.15 Test (test-plan #E15) in `yolo.test.ts`: live session, eligible plane · `decide({subject:""})` · `null`.
- [ ] 3.16 Implement `answer()` core, nearest-ancestor resolution in `decide()`, `decideAgentPath`, and the D9 system-dir rule in `packages/server/src/access/yolo-session.ts` (export system-dir lists from `packages/shared/src/forbidden-subjects.ts` if needed); widen `YoloLogEntry.plane` to `YoloSurfaceId`. Verify 3.1–3.15 and existing `yolo.test.ts` / `grant-coordinator.test.ts` pass.

## 4. Server — ledger, registry, handlers, wiring, routes (TDD)

- [ ] 4.1 Test (test-plan #E17) in `packages/server/src/access/__tests__/` refusal-ledger test (exemplar: `yolo.test.ts` refusal cases): tmp `PI_ACCESS_REFUSALS_STORE` · `recordRefusal("agent-path",D)` → `__resetRefusalLedger()` → `listRefusals()` → `clearRefusal` · row present after reset, `isRefused` false after clear, `plane:"bogus"` row dropped on load.
- [ ] 4.2 Test (test-plan #E18) in `packages/server/src/access/__tests__/agent-grant.test.ts` (exemplar: same file): select `S1` + confirm `C1` same path/subject; 40 selects then `C2` · `consume(…, kind)` · cross-kind consume errors; `S1` select consume ok once then error; `C2` still consumable.
- [ ] 4.3 Implement per-kind `observe`/`consume` + per-kind caps in `agent-confirm-registry.ts`, `kind:"confirm"` in `agent-grant.ts`, and `agent-path` acceptance in `refusal-ledger.ts` (`Refusal.plane: YoloSurfaceId`); verify 4.1, 4.2 and existing `agent-grant.test.ts` pass.
- [ ] 4.4 Test (test-plan #E19) in new `packages/server/src/access/__tests__/agent-yolo.test.ts` (exemplar: `agent-grant.test.ts`): connection `A`, `msg.sessionId` `B`, live unscoped YOLO · `handlePathYoloRequest` · `decline`, dep not called.
- [ ] 4.5 Test (test-plan #E20) in `agent-yolo.test.ts`: msgs missing `requestId` / `path:42` / `path:"rel/x"` · `handlePathYoloRequest` · each `decline`, log line free of control chars.
- [ ] 4.6 Test (test-plan #E21) in `agent-yolo.test.ts`: dep returns `auto-allow` / `refused-by-prior-refusal` / `null`, dep undefined · `handlePathYoloRequest` · `auto-allow` / `refused` / `decline` / `decline`.
- [ ] 4.7 Test (test-plan #E22) in `agent-yolo.test.ts`: observed select `P` for `A`, path `/o/dir/a.txt`, subject `/o/dir` · `handlePathGateRefusal` · `recordRefusal("agent-path","/o/dir")` once.
- [ ] 4.8 Test (test-plan #E23) in `agent-yolo.test.ts`: (a) unobserved `promptId`, (b) `P` reported twice, (c) session mismatch · `handlePathGateRefusal` · (a) no record, (b) one record, (c) no record.
- [ ] 4.9 Test (test-plan #E24) in `agent-yolo.test.ts`: observed `P` path `/o/dir/a.txt`, claimed subject `/o` · `handlePathGateRefusal` · no record, log `cause=subject mismatch`.
- [ ] 4.10 Test (test-plan #E25) in `agent-yolo.test.ts`: observed `P` path `H/notes.txt` (subject `H`) · `handlePathGateRefusal` · `recordRefusal("agent-path", H)` called.
- [ ] 4.11 Implement `packages/server/src/access/agent-yolo.ts` (`handlePathYoloRequest`, `handlePathGateRefusal`) per design D5; verify 4.4–4.10 pass.
- [ ] 4.12 Test (test-plan #E26) in the event-wiring test that covers `session_register` (exemplar: `packages/server/src/access/__tests__/agent-grant.test.ts` identity cases / nearest event-wiring test): register with and without announceable store id · handle register · `dashboard_identity` with `features:["path-yolo"]` both times, `grantStoreId` only when announceable.
- [ ] 4.13 Test (test-plan #E27) in the same event-wiring test: `prompt_request` metadata `{kind:"agent-path-gate", path, subject}` · handle · registry `select` entry for `promptId`; replay does not extend TTL.
- [ ] 4.14 Wire `path_yolo_request` / `path_gate_refusal` in `packages/server/src/event-wiring.ts` (lazy `decideAgentPath` dep on `EventWiringDeps`, select-prompt observation, identity always sent with `features`) and pass the closure from `packages/server/src/server.ts`; verify 4.12, 4.13 pass.
- [ ] 4.15 Test (test-plan #E28) in `packages/server/src/__tests__/access-prompt-routes.test.ts` (exemplar: same file): refusal `{agent-path, D}` · `DELETE /api/access/refusals?plane=agent-path&subject=D`, then `plane=bogus` · 200 + row gone; 400.
- [ ] 4.16 Test (test-plan #E29) in `access-prompt-routes.test.ts`: history holds an `agent-path` auto-allow · `GET /api/access/prompts` · `verdicts` includes `{plane:"agent-path", answeredBy:"yolo"}`.
- [ ] 4.17 Accept `agent-path` in the refusal clear route and widen route payload types in `packages/server/src/routes/access-prompt-routes.ts`; verify 4.15, 4.16 pass.

## 5. Bridge — path gate (TDD)

- [ ] 5.1 Test (test-plan #E37) in new `packages/extension/src/path-gate/__tests__/yolo-link.test.ts` (exemplar: `grant-link.test.ts`): identity `features:"path-yolo"` / `["path-yolo"]` / absent · `handleIdentity` → `supported()` · `false` / `true` / `false`.
- [ ] 5.2 Test (test-plan #X4) in `yolo-link.test.ts`: pending question then connection close · `reset()` · pending resolves `decline`; `supported()` false; next `ask` sends nothing.
- [ ] 5.3 Implement `packages/extension/src/path-gate/yolo-link.ts` (never-rejecting `ask`, 1500 ms budget, features validation, reset) per design D6/D7; verify 5.1, 5.2 pass.
- [ ] 5.4 Test (test-plan #E30) in `packages/extension/src/path-gate/__tests__/handler.test.ts` (exemplar: same file): decision table `hasUI` × suppressed × sensitive × grantable × supported × `storeMatches` · out-of-root `write` · `yoloDecide` called iff all-true; `no-ui` / `recently-denied` blocks unchanged.
- [ ] 5.5 Test (test-plan #E31) in `handler.test.ts`: `yoloDecide` → `auto-allow` · write `/o/f.txt` · returns `undefined`, no `select`, log `[path-gate] yolo-allowed tool=write access=w path=/o/f.txt session=<sid> sensitive=false`, `counters.yoloAllowed` 1.
- [ ] 5.6 Test (test-plan #E32) in `handler.test.ts`: `yoloDecide` → `refused` · out-of-root read · block reason starts `path-gate: yolo-refused`, no `select`, log `yolo-refused`, `counters.blocked` +1.
- [ ] 5.7 Test (test-plan #E33) in `handler.test.ts`: `yoloDecide` → `decline` · out-of-root read · `select` called once with title `Agent wants to read outside its workspace: …`.
- [ ] 5.8 Test (test-plan #E34) in `handler.test.ts`: select answers Deny / `undefined` / timeout / always-allow + confirm false / unknown / Deny with `storeMatches` false · out-of-root call · `path_gate_refusal {promptId:<select id>, path, subject}` sent only for Deny and dismiss.
- [ ] 5.9 Test (test-plan #E35) in `handler.test.ts`: grantable out-of-root path · prompt raised · select metadata includes `subject === d.subject`.
- [ ] 5.10 Test (test-plan #E36) in `handler.test.ts`: (a) `enabled:false`, (b) in-root read · tool call · no `path_yolo_request`, no `yoloDecide` call.
- [ ] 5.11 Test (test-plan #F1) in `handler.test.ts`: session S out-of-scope call held at unresolved `select`; YOLO scoped to `R` · second call writes `R/out.txt` · second resolves `undefined` while first `select` still pending.
- [ ] 5.12 Test (test-plan #X1) in `handler.test.ts` with fake timers: server never replies · out-of-root call · `select` called at 1500 ms, not at 1499 ms; no block.
- [ ] 5.13 Test (test-plan #X2) in `handler.test.ts`: `send` returns `false` · out-of-root call · `select` called with 0 ms advance.
- [ ] 5.14 Test (test-plan #X3) in `handler.test.ts`: `yoloDecide` throws · out-of-root call · `select` called; result is not `path-gate: error`.
- [ ] 5.15 Test (test-plan #X6) in `handler.test.ts`: identity without `features` · 5 out-of-root calls · zero `path_yolo_request` frames.
- [ ] 5.16 Test (test-plan #X7) in `handler.test.ts`: `send` throws on `path_gate_refusal` · operator Deny · blocked as `denied` with today's reason; no exception escapes.
- [ ] 5.17 Test (test-plan #P1) in `handler.test.ts` (timed): 10 000 in-root reads with yolo-link wired, probe settled · measure · p95 < 1 ms and zero `send` calls.
- [ ] 5.18 Test (test-plan #P2) in `handler.test.ts` with fake timers: identity without `features` · out-of-root call · `select` reached with 0 ms advance.
- [ ] 5.19 Implement the YOLO branch in `packages/extension/src/path-gate/handler.ts` (design D6: order, same-host gate via `storeMatches`, wrapped call, `yolo-allowed`/`yolo-refused` outcomes, select-step deny report, `subject` in select metadata, `counters.yoloAllowed`) and wire `yolo-link` in `packages/extension/src/path-gate/index.ts`; verify 5.4–5.18 and existing path-gate tests pass.
- [ ] 5.20 Test (test-plan #X5) in `packages/extension/src/__tests__/session-move.test.ts` (exemplar: same file): move to target sending `dashboard_identity {grantStoreId, features}` · move commits · `pathGate.onServerMessage` receives it; `storeMatches()` and `supported()` true.
- [ ] 5.21 Forward `dashboard_identity` from the move coordinator (`packages/extension/src/session-move.ts`) and bind the yolo support flag to the announcing connection in `packages/extension/src/bridge.ts`; add `yoloAllowed` to the heartbeat path-gate counters; verify 5.20 and existing bridge/session-move tests pass.

## 6. Client — copy and labels (TDD)

- [ ] 6.1 Test (test-plan #F6) in `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx` (exemplar: same file; plus a `YoloAccessCard` case): unscoped and scoped sessions · render · pill/banner text matches /agent/i, `yolo-access-planes` contains "Agent path gate".
- [ ] 6.2 Test (test-plan #F7) in `packages/client/src/components/settings/__tests__/AccessPromptsSection.test.tsx` (exemplar: same file): payload with `plane:"agent-path"` verdict + refusal · render · both rows show the agent-path label.
- [ ] 6.3 Update copy in `YoloIndicators.tsx`, `YoloAccessCard.tsx` (`yolo.cardBody`, planes line) and locale files (`i18n.tsx`, `i18n-hu.ts`); widen `access-prompts-types.ts` (`YoloVerdictView.plane`, `RefusalView.plane`), `access-prompts-api.ts` (`clearRefusal`) and `AccessPromptsSection.tsx` (`planeLabel`, label map) to `YoloSurfaceId`; verify 6.1, 6.2 and existing client tests pass.

## 7. E2E (docker harness)

- [ ] 7.1 Test (test-plan #F2) in `tests/e2e/agent-path-gate.spec.ts` (exemplar: same file + YOLO activation/cleanup from `tests/e2e/access-grant-dialog.spec.ts`): `POST /api/access/yolo {unscoped:true, durationMs:900000}` · faux `tool-read-outside-grantable` · no gate card, tool result rendered, `/api/health` `accessGrants.yolo.autoAllowed` ≥ previous+1, Access YOLO history row labelled agent path gate.
- [ ] 7.2 Test (test-plan #F3) in `agent-path-gate.spec.ts`: after 7.1, `DELETE /api/access/yolo` · faux `tool-read-outside-grantable` again · gate card appears.
- [ ] 7.3 Test (test-plan #F4) in `agent-path-gate.spec.ts`: unscoped YOLO live · faux `tool-read-outside` (`/etc/hostname`) · gate card appears; `autoAllowed` unchanged.
- [ ] 7.4 Test (test-plan #F5) in `agent-path-gate.spec.ts`: YOLO off · faux `tool-read-outside-grantable`, click Deny, open Settings ▸ Access · refusal row `/srv/fixtures-outside` labelled agent path gate; clear removes it (`DELETE` 200).

## 8. Docs and records

- [ ] 8.1 Update per-directory `AGENTS.md` rows for every new/changed file (`packages/server/src/access/`, `packages/extension/src/path-gate/`, `packages/shared/src/`, client dirs, `tests/e2e/agent-path-gate.spec.ts.AGENTS.md`) with `See change: yolo-covers-agent-path-gate`; verify `node scripts/check-conventions.mjs` passes.
- [ ] 8.2 Delegate the `docs/architecture.md` access-grant section update (YOLO covers agent path gate, `path_yolo_request`/`path_gate_refusal`, same-host gate, carve-outs) to DocScribe; verify the section names both frames.

## 9. Verification

- [ ] 9.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green and `openspec validate yolo-covers-agent-path-gate --strict` passes.
- [ ] 9.2 Manual: review YOLO pill, banner and Access card copy in EN and HU for accuracy and natural wording (test-plan: manual-only, #F8).
- [ ] 9.3 Manual: pi session without a dashboard connection while YOLO is live on the server — an out-of-root write still shows the terminal prompt as today (test-plan: manual-only, #X8).
