## 1. Declaration + persistence (D1, D4)

- [ ] 1.1 Test (see `packages/server/src/__tests__/meta-key-byte-identity.test.ts` case E2): session `{archiveOnEnd:true}` + unrelated field change · `sessionToMeta` → write → `sessionFromMeta` · restored `archiveOnEnd === true` (test-plan #E1)
- [ ] 1.2 Test (see `packages/server/src/__tests__/meta-key-byte-identity.test.ts`): plain user session, no declaration, no `lifecyclePolicy` · serialize · no `archiveOnEnd` key, bytes equal pre-change fixture (test-plan #E2)
- [ ] 1.3 Test (see `packages/server/src/__tests__/meta-key-byte-identity.test.ts`): `{lifecyclePolicy:"ephemeral"}` undeclared · serialize · no `archiveOnEnd` key (test-plan #E3)
- [ ] 1.4 Test (see `packages/server/src/pending/__tests__/pending-plugin-ref-registry.test.ts` + `packages/server/src/__tests__/core-lifecycle-generic.test.ts`): empty ref + `lifecycle:{archiveOnEnd:true}` · file + register, read sidecar before any routine save · `file()` true, sidecar `archiveOnEnd === true` (test-plan #E4)
- [ ] 1.5 Test (see `packages/server/src/pending/__tests__/pending-plugin-ref-registry.test.ts`): ref body `{archiveOnEnd:true, foo:1}`, no declaration · sanitize/register · key dropped with one warning, session undeclared (test-plan #E5)
- [ ] 1.6 Verify 1.1–1.5 fail, then implement: `archiveOnEnd?: boolean` on `PluginSessionLifecycle` (`server-context.ts:167`, `pending-plugin-ref-registry.ts:48`), `hasLifecycle` (`:196-200`), `CORE_RESERVED_REF_KEYS` (`:27`) + `packages/chat-gateway/src/server/__tests__/fake-seam.ts` mirror; session + sidecar types (`packages/shared/src/types.ts`, `session-meta.ts`); widen `event-wiring.ts:1636` inline lifecycle type; register seam `if (lifecycle)` block sets it in memory + own `mergeSessionMeta`; `sessionToMeta` pass-through; `sessionFromMeta` restore. Verify 1.1–1.5 pass

## 2. Config + log reason (D5, D6)

- [ ] 2.1 Test (see `packages/shared/src/__tests__/config.test.ts`): `sessionList` absent / `{archiveServiceSessionsOnEnd:false}` / `"yes"` · `parseSessionListConfig` + `validateSessionListConfig` · `true` / `false` / parse→`true` + validate error (test-plan #E24)
- [ ] 2.2 Test (see `packages/server/src/__tests__/config-api.test.ts`): running server, flag `true` · PUT `archiveServiceSessionsOnEnd:false` then end a declared session · GET returns `false`, session not archived, no restart (test-plan #E25)
- [ ] 2.3 Test (see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`): Sessions page · render · archive-after hint contains "age-based" (test-plan #E27)
- [ ] 2.4 Verify 2.1–2.3 fail, then implement: flag in `sessionList` type, `DEFAULT_SESSION_LIST` (`config.ts:299`), `parseSessionListConfig` (`:1455`), `validateSessionListConfig` (`:1478`); export `ArchiveReason` + add `"service-end"` (`session-archive.ts:26`); hint strings in `packages/client/src/lib/i18n-en-source.json` (`settings.archiveAfterDaysHint`, `settings.archiveDaysInvalid`) + `i18n-hu.ts`. Verify 2.1–2.3 pass

## 3. On-end graced archive (D2)

- [ ] 3.1 Test (see `packages/server/src/session/__tests__/archive-sweeper.test.ts`, fake timers): resident declared session, flag on · `→ ended`, advance 30 000 ms · one `archiveSession(id,"service-end")`, archived broadcast, log names id (test-plan #E6)
- [ ] 3.2 Test (same exemplar): as 3.1 · advance 29 999 ms then +1 ms · resident at 29 999, archived at 30 000 (test-plan #E7)
- [ ] 3.3 Test (same exemplar): (a) undeclared (b) ephemeral-only · `→ ended`, advance 60 s · no timer, resident (test-plan #E8)
- [ ] 3.4 Test (same exemplar): declared, flag `false` · `→ ended`, advance 60 s · not archived (test-plan #E9)
- [ ] 3.5 Test (same exemplar): declared, `archiveAfterDays:0`, flag on · `→ ended`, advance 30 s · archived (test-plan #E10)
- [ ] 3.6 Test (same exemplar): scheduled, at fire (a) removed (b) status `idle` (c) declaration cleared (d) `live:true` (e) flag `false` · advance 30 s · not archived, timer dropped, no re-arm (test-plan #E11)
- [ ] 3.7 Test (same exemplar): declared ended · `scheduleServiceArchive` twice in window, advance 30 s · exactly one archive (test-plan #E12)
- [ ] 3.8 Test (same exemplar): declared, viewed at first fire · advance 30 s, unview, advance 30 s · archived only at second fire (test-plan #E13)
- [ ] 3.9 Test (same exemplar): declared ended · manual archive t=5 s, unarchive t=10 s, advance to 35 s · resident, no second archive (test-plan #E14)
- [ ] 3.10 Test (same exemplar): as 3.9 + viewed at fire · advance to 35 s then +60 s · not archived, timer map empty (test-plan #E15)
- [ ] 3.11 Test (same exemplar): restored session `restoredAt ≥ endedAt` · `scheduleServiceArchive` (closedReason re-fire) · no timer, resident after 60 s (test-plan #E16)
- [ ] 3.12 Test (same exemplar): declared ended while flag `false` · flip flag `true`, advance 60 s · not archived (test-plan #E17)
- [ ] 3.13 Test (same exemplar): 3 pending timers · `stop()`, advance 60 s · 0 archives, map empty (test-plan #X3)
- [ ] 3.14 Test (same exemplar): stopped sweeper · `scheduleServiceArchive`, `start()`, advance 2 h · no timer, no interval, 0 archives (test-plan #X4)
- [ ] 3.15 Test (same exemplar): `archiveSession` returns `{ok:false}` · fire · no throw, timer dropped, no success log (test-plan #X6)
- [ ] 3.16 Verify 3.1–3.15 fail, then implement in `packages/server/src/session/archive-sweeper.ts`: `SERVICE_ARCHIVE_GRACE_MS = 30_000`, `scheduleServiceArchive(id)` (skip if restored after end), `Map<id, Timeout>`, ordered fire-time checks (resident → ended → declared → `live` → restored-since-scheduling → setting → viewed⇒re-arm), per-instance stopped latch, widened `getConfig`. Verify 3.1–3.15 pass
- [ ] 3.17 Test (see `packages/server/src/__tests__/core-lifecycle-generic.test.ts`): end handler reads session 20 s after `→ ended` on the `onUnregister` path · advance 20 s, then 30 s · resident with `result.md` captured at 20 s, archived at 30 s (test-plan #X1)
- [ ] 3.18 Test (see `packages/server/src/__tests__/shutdown-endpoint.test.ts`): server with sweeper spy · server `stop()` and `start()` failure teardown · `archiveSweeper.stop()` after `piGateway.stop()` on both (test-plan #X5)
- [ ] 3.19 Verify 3.17–3.18 fail, then implement: `wireEvents` deps gain the sweeper; `sessionManager.onEnded` owner (`event-wiring.ts:602`) calls `scheduleServiceArchive`; `server.ts` calls `archiveSweeper.stop()` after `piGateway.stop()` in `stop()` and the `start()` teardown (`:2862-2870`). Verify 3.17–3.18 pass

## 4. Boot backfill (D3)

- [ ] 4.1 Test (see `packages/server/src/__tests__/session-scanner.test.ts`): sidecar `archiveOnEnd:true`, `live:false`, `status:"idle"`, age 1 h · `scanAllSessions` · archived at scan, in `archived[]`, absent from `sessions`, no broadcast (test-plan #E18)
- [ ] 4.2 Test (same exemplar): as 4.1 without `lifecyclePolicy` · scan · archived (test-plan #E19)
- [ ] 4.3 Test (same exemplar): 3 ephemeral undeclared `live:false` sidecars ended 3 weeks ago, `legacyPass:true` · scan · all archived, excluded from snapshot, per-id `service-end-backfill` log lines (test-plan #E20)
- [ ] 4.4 Test (see `packages/server/src/__tests__/boot-state.test.ts` + scanner exemplar): no stamp · boot #1 (flag on) then new ephemeral sidecar, boot #2 · #1 archives + stamps `serviceArchiveBackfillAt`; #2 keeps new sidecar (test-plan #E21)
- [ ] 4.5 Test (same exemplars): no stamp · boot with flag `false`, then with `true` · first: no archive, no stamp; second: archived + stamp (test-plan #E22)
- [ ] 4.6 Test (scanner exemplar): (a) `archived:false` ephemeral (b) `live:true` declared (c) `live:true` ephemeral (d) flag `false` declared · scan with `legacyPass:true` · none archived by this rule (test-plan #E23)
- [ ] 4.7 Test (see `packages/server/src/__tests__/boot-state.test.ts`): `boot-state.json` missing / corrupt · boot scan · treated as no stamp; stamp written atomically after scan (test-plan #X7)
- [ ] 4.8 Verify 4.1–4.7 fail, then implement: `ScanOptions` gains `archiveServiceSessionsOnEnd` + `legacyPass`; backfill as a separate branch beside the age rule (`session-scanner.ts:395`); `boot-state.ts` read/stamp `serviceArchiveBackfillAt`; `server.ts` passes `legacyPass` and stamps after the scan when the flag is on. Verify 4.1–4.7 pass

## 5. Automation plugin (D1 declaration, D7 monitor)

- [ ] 5.1 Test (see `packages/automation-plugin/src/__tests__/engine.test.ts`): automations with `visibility:"hidden"` and `"shown"` · `startRunFor` · both spawn `lifecycle` include `archiveOnEnd:true`; goal plugin spawn does not (test-plan #E26)
- [ ] 5.2 Test (see `packages/automation-plugin/src/__tests__/engine.test.ts`): run session archived (removed from live set) · late `agent_end` / `onSessionDeath` for that id · no throw, run record unchanged, no error log (test-plan #X2)
- [ ] 5.3 Test (see `packages/automation-plugin/src/__tests__/routes-stop.test.ts`): run store child `{sessionId:"s1", runId:"r1"}` + `result.md` · `GET /result?sessionId=s1` and unknown id · 200 with result + status; unknown → 404 (test-plan #F4)
- [ ] 5.4 Test (see `packages/automation-plugin/src/__tests__/AutomationRunMonitor.test.tsx`): `session` undefined, `params.sid` set, endpoint mocked `{status:"done", result:"# findings"}` · render · terminal status (not "running"), result markdown, transcript href `/session/<sid>?archived=1` (test-plan #F2)
- [ ] 5.5 Test (same exemplar): resident running session · render · `run-live-hint` shown, no archived link (test-plan #F3)
- [ ] 5.6 Verify 5.1–5.5 fail, then implement: widen `engine.ts:175-176` spawn lifecycle type; `archiveOnEnd:true` at `engine.ts:726`; result route accepts `sessionId` (run-store lookup) + `api.ts` client fn; `AutomationRunMonitor` non-resident fallback + archived transcript link. Verify 5.1–5.5 pass

## 6. End-to-end (L3, docker harness)

- [ ] 6.1 Test (see `tests/e2e/automation-identity-restart.spec.ts` for sidecar seeding, `tests/e2e/archive-fold.spec.ts` for `Archive (N)`): seeded ended shown run with `archiveOnEnd:true` · wait ≤ 45 s · board card converges 1 → 0, folder `Archive (N)` +1, Automation view still lists the run (test-plan #F1)
- [ ] 6.2 Test (see `tests/e2e/automation-identity-restart.spec.ts` + `tests/e2e/archived-attachment.spec.ts`): archived run session + run record · open `/folder/:cwd/automations/run/:sid` · terminal status, findings rendered, transcript link opens read-only archived chat (test-plan #F5)

## 7. Verification and closeout

- [ ] 7.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary; verify 0 failures
- [ ] 7.2 Run `npm run quality:changed` and fix new Biome findings; verify clean
- [ ] 7.3 Manual: copy of a real `~/.pi/agent/sessions` with pre-#710 run sidecars · upgrade boot · stale run cards gone from folder boards, `Archive (N)` counts rise, user sessions untouched (test-plan: manual-only, #M1)
- [ ] 7.4 Update per-file rows in the nearest `AGENTS.md` / `*.AGENTS.md` for every touched source + test file (incl. new `tests/e2e/*.spec.ts.AGENTS.md` sidecars) with `See change: archive-service-sessions-on-end`; delegate `docs/` prose for `sessionList.archiveServiceSessionsOnEnd` to DocScribe
- [ ] 7.5 Run `review-code` on the diff and resolve blocking findings before commit
