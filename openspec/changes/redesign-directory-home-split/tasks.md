## 1. Shared protocol + argv

- [x] 1.1 Add optional `model?: string`, `thinkingLevel?: ThinkingLevel` to `SpawnSessionBrowserMessage`, `SendPromptToBrowserMessage`, `ResumeSessionBrowserMessage`; optional `requestId?` to the `spawn_register_timeout` message (`packages/shared/src/browser-protocol.ts`) — verify `npm run build` type-checks
- [x] 1.2 Add `thinking?` to `SessionFlags`; `sessionFlagsToArgv` emits `--model`/`--thinking` on fresh + `continue` branches, fork unchanged (`packages/shared/src/platform/spawn-mechanism.ts`) — verify with 1.3
- [x] 1.3 Test (L1, see `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`): `SessionFlags` fresh/continue/fork each with model+thinking · `sessionFlagsToArgv` · fresh+continue carry `"--model",m` and `"--thinking",t` as discrete elements, fork output unchanged (test-plan #E7)
- [x] 1.4 Add `ROUTE_TIERS` row `{GET, "/api/pi-resources/commands", observe}` (`packages/shared/src/route-tiers.ts`) — verify with 1.5
- [x] 1.5 Test (L1, see `packages/server/src/identity/__tests__/http-road-classification.test.ts` + `packages/server/src/__tests__/route-tier-gate.test.ts`): `GET /api/pi-resources/commands` · tier + road lookup · tier `observe`, road `packages`, totality test passes (test-plan #E15)

## 2. Server validation + spawn/resume

- [x] 2.1 Add `validateSpawnChoice({model?, thinkingLevel?})` helper per design D5 (slash required, non-empty segments, no dash-led segment, ≤200, charset, suffix split only when no `thinkingLevel` field, `THINKING_LEVELS` enum, warn on drop) — verify with 2.2–2.5
- [x] 2.2 Test (L1, see `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`): `{model:"anthropic/claude-sonnet-5", thinkingLevel:"high"}` · `spawn_session` handled · `spawnPiSession` options `model:"anthropic/claude-sonnet-5"`, `thinking:"high"` (test-plan #E1)
- [x] 2.3 Test (L1, same exemplar): `model:"openrouter/meta-llama/llama-4"` · validator · accepted unchanged (test-plan #E2)
- [x] 2.4 Test (L1, same exemplar): `"x; rm -rf /"`, `"--help/x"`, `"a/b/--x"`, `"sonnet"`, `"a/"`, `"/b"`, `"a//b"`, 201-char, 200-char · validator · invalid dropped + warn, 200 accepted, 201 dropped (test-plan #E3)
- [x] 2.5 Test (L1, same exemplar): the 7 `THINKING_LEVELS` + `"turbo"`, `""`, `"HIGH"` · validator · 7 accepted, 3 dropped (test-plan #E4)
- [x] 2.6 Test (L1, same exemplar): suffix decision table (a) `m/x:high` no level, (b) + `low`, (c) + `bogus`, (d) `m/x:free` · validator · (a) `m/x`+`high`; (b) `m/x:high`+`low`; (c) `m/x:high`, no thinking; (d) `m/x:free`, no thinking (test-plan #E5)
- [x] 2.7 `spawn_session` handler: validate, forward `model`/`thinking` to `spawnPiSession`; fill `model` from config `defaultModel` when only `thinkingLevel` given; add `thinking` to `SessionOptions` (`process-manager.ts`) — verify with 2.8
- [x] 2.8 Test (L1, same exemplar): config default `anthropic/claude-opus-5-5`; (a) `thinkingLevel:"high"` only, (b) no default + `high` · `spawn_session` · (a) model default + thinking high; (b) thinking only (test-plan #E6)
- [x] 2.9 Test (L1, see `packages/server/src/__tests__/process-manager.test.ts`): tmux strategy, model `"a/b@c+d"` · pane command built · model is one `shellEscape`d token, no unescaped `;`/`$` (test-plan #E8)
- [x] 2.10 Auto-resume (`send_prompt` on ended session) and `resume_session`: drop pick fields unless `mode==="continue"` (send_prompt auto-resume counts as continue), validate, pass directly to the resume `spawnPiSession`; when model picked without thinking, fill the session's stored `thinkingLevel`; ignore fields on live sessions; ignore pick while `alreadyResuming` — verify with 2.11–2.16
- [x] 2.11 Test (L1, see `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`): ended session M0/high with picks (a) M1 (b) low (c) both (d) none · auto-resume · options (a) M1+high (b) low only (c) M1+low (d) neither (test-plan #E22)
- [x] 2.12 Test (L1, same exemplar): `resume_session` continue+M1 and fork+M1 · handler · continue → model M1; fork → no model in options/argv (test-plan #E23)
- [x] 2.13 Test (L1, same exemplar): `send_prompt` on ended session with `model:"--help/x"` · handler · resume spawn without model, warn logged (test-plan #E24)
- [x] 2.14 Test (L1, same exemplar): `send_prompt` with `model` to a connected live session · handler · prompt forwarded, no spawn, no `set_model` (test-plan #E25)
- [x] 2.15 Test (L1, same exemplar): ended A (pick M1) and B (no pick) in `/p` · concurrent `send_prompt` · A options M1, B no model (test-plan #X5)
- [x] 2.16 Test (L1, same exemplar): A resuming (`alreadyResuming`) · second `send_prompt` with M2 · no second spawn, M2 not applied (test-plan #X6)
- [x] 2.17 Fill `requestId` on `spawn_register_timeout` from the existing `spawnToken → requestId` map — verify with 7.6

## 3. Folder command list route

- [x] 3.1 `sessionCommandRegistry`: store `{commands, receivedAt}`, stamp on accept only — verify `packages/server/src/__tests__/session-skill-registry.test.ts` extended and green
- [x] 3.2 `resolveFolderCommands(cwd)` + `GET /api/pi-resources/commands`: 400 on missing/relative cwd; normalize (strip trailing sep, `canonicalPath`); live = `piGateway.isSessionConnected` + equal cwd + non-empty, latest `receivedAt`; else scan (enabled skills/prompts, `path`=`filePath`), `none` when empty; `scope` per design D3 — verify with 3.3–3.9
- [x] 3.3 Test (L1, see `packages/server/src/__tests__/pi-resource-activation-timeout.test.ts` + `session-skill-registry.test.ts`): A(173, t1) and B(5, t2>t1) connected in `/p` · GET `?cwd=/p` · origin `live`, B's 5 commands (test-plan #E9)
- [x] 3.4 Test (L1, same exemplar): (a) only ended (b) active but not connected (c) connected empty list (d) live only in `/p/sub` · GET `/p` · (a)(b)(d) not `live`; (c) `scan` (test-plan #E10)
- [x] 3.5 Test (L1, same exemplar): live in `/p`; request `/p/`, symlink `/link`→`/p`, missing `/gone/` · GET · `live`, `live`, 200 `none`/`scan` without throw (test-plan #E11)
- [x] 3.6 Test (L1, same exemplar): no cwd, `cwd=p`, `cwd=` · GET · 400 each (test-plan #E12)
- [x] 3.7 Test (L1, same exemplar): scan with local `document-organizer`, global `xlsx`, disabled `pdf`, local-package `pkgskill`, prompt `weekly-review` · GET · scopes folder/folder/global, prompt source, no `pdf`, `path`=`filePath` (test-plan #E13)
- [x] 3.8 Test (L1, same exemplar): live entries under `/p/.pi/skills/`, global path, no path · GET · scopes folder/global/global (test-plan #E14)
- [x] 3.9 Test (L1, same exemplar): scan returns `degraded:true` · GET · 200, origin `scan`, fallback list (test-plan #X4)

## 4. Client hooks

- [x] 4.1 `useFolderCommands(cwd)` (GET route, cache by cwd, 404/500/network → `[]`, ≤1 request per cwd change) + `useModelCatalogue()` extracted from `SettingsPanel` (module cache) — verify `SettingsPanel.test.tsx` still green and 4.2–4.4
- [x] 4.2 Test (L1, see `packages/client/src/lib/__tests__/resources-api.test.ts`): route → 404 · `useFolderCommands("/p")` · `[]`, no throw, ≤1 request (test-plan #X1)
- [x] 4.3 Test (L1, same exemplar): route → 500 / network error · hook · `[]`, composer usable (test-plan #X2)
- [x] 4.4 Test (L1, see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`): catalogue `unavailable`, no default · send from folder home · spawn without `model`, chip `pi default` (test-plan #X3)

## 5. Folder home rewrite

- [x] 5.1 Rewrite `DirectoryHomeView` as pre-session pane (starters `flex-1 min-h-0 overflow-auto` + `CommandInput` docked last child, header with layout switch + gear, model/thinking/run-location chips); remove session list + quick actions + orphaned i18n keys — verify with 5.4–5.15
- [x] 5.2 Folder route renders `SplitWorkspace` with pre-session pane + folder editor pane keyed `folderPaneId(cwd)`, default `split` when no stored mode — verify with 5.16 and 7.2
- [x] 5.3 Spawn wiring: `handleSpawnSession` opts gain `model`/`thinkingLevel`; page reads its `pendingSpawnsRef` entry by `requestId`, re-enables on failed `spawn_result` / `spawn_register_timeout` for that id; worktree `onSpawnStart`/`onSpawn`/`onSpawnAbort` wrapped — verify with 5.10–5.14
- [x] 5.4 Test (L1, see `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`): lists of 0/1/6/9 mixed-scope commands · render · 0/1/6/6 cards, folder skills → prompts → global (test-plan #E16)
- [x] 5.5 Test (L1, same exemplar): drafts `""`, `"summarize 2025"`, `"/skill:xlsx clean"`, `"/"` · click `doc-summarizer` card · expected drafts per manifest, caret at end, no `spawn_session` (test-plan #E17)
- [x] 5.6 Test (L1, same exemplar): defaults (a) model+thinking (b) model only (c) none (d) catalogue fail + model · send `"hi"` · fields + `default` tags per manifest (test-plan #E18)
- [x] 5.7 Test (L1, same exemplar): `folderGitMap` git / not git / unknown · render · run-location shown / hidden / hidden (test-plan #E19)
- [x] 5.8 Test (L1, same exemplar): `""`, `"   \n\t"` · Enter / Start · no `spawn_session` (test-plan #E20)
- [x] 5.9 Test (L1, same exemplar): in-flight spawn · Enter ×2 + click Start · exactly one `spawn_session` (test-plan #F7)
- [x] 5.10 Test (L1, see `packages/client/src/hooks/__tests__/useSessionActions.placeholder-cwd.test.tsx`): in-flight R · failed `spawn_result` R / `spawn_register_timeout` R / one for R2 · R → enabled + draft kept; R2 → still disabled (test-plan #F8)
- [x] 5.11 Test (L1, see `packages/client/src/hooks/__tests__/useMessageHandler.no-focus-spawn.test.tsx`): `session_added {spawnRequestId:R}` · correlation · `navigate` called once by App, not by the page (test-plan #F9)
- [x] 5.12 Test (L1, see `DirectoryHomeView.test.tsx`): git cwd, draft `"x"`, model M · New worktree… → `onSpawnStart` → `onSpawn("/wt",{gitWorktreeBase:"develop"})` · exactly 1 `spawn_session {cwd:"/wt", initialPrompt:"x", model:M, gitWorktreeBase:"develop", requestId}` (test-plan #F10)
- [x] 5.13 Test (L1, same exemplar): as 5.12 · `onSpawnAbort` · Start enabled, draft kept, no `spawn_session` (test-plan #F11)
- [x] 5.14 Test (L1, see `packages/client/src/components/__tests__/CommandInput-view.test.tsx`): rerender with new `onDraftChange` v2 · click starter card · v2 called, v1 not (test-plan #F18)
- [x] 5.15 Test (L1, see `packages/client/src/lib/__tests__/folder-home-route.test.tsx`): no stored layout for `folderPaneId(cwd)` · render · mode `split` (test-plan #F17)
- [x] 5.16 Update `DirectoryHomeView.test.tsx` + `folder-home-route.test.tsx` assertions on removed ids; update `DirectoryHomeView.tsx.AGENTS.md` + `components/folder/AGENTS.md` rows — verify `npm run quality:changed` clean

## 6. Ended-session composer

- [x] 6.1 `App.tsx`: ended session with no `commands_list` → `useFolderCommands(session.cwd)`; keep folder list until the live list arrives; catalogue models + chips (pick ?? persisted); per-session pick stored client-side, sent on `send_prompt`/`resume_session` continue, cleared on register and on `set_model`/`set_thinking_level` — verify with 6.2–6.6
- [x] 6.2 Test (L1, see `packages/client/src/hooks/__tests__/useMessageHandler.spawn-error-toast.test.tsx`): (a) live, no list (b) ended, no list, folder [skill:x] (c) ended with stored list · select · `[]` / `[skill:x]` / stored (test-plan #E21)
- [x] 6.3 Test (L1, see `packages/client/src/components/__tests__/ModelSelector.test.tsx`): ended session model `anthropic/claude-opus-5-5` · render · chip reads it (test-plan #F13)
- [x] 6.4 Test (L1, same exemplar as 6.2): ended showing [skill:x] · status active, list pending, then [skill:y] · never `[]` (test-plan #F14)
- [x] 6.5 Test (L1, same exemplar as 6.2): ended with pick M1 · (a) register live (b) `set_model` · pick cleared; next resume sends no model (test-plan #F15)
- [x] 6.6 Test (L1, see `ModelSelector.test.tsx`): ended M0 with pick M1 · render · chip reads M1 (test-plan #F16)
- [x] 6.7 Test (L1, see `packages/client/src/hooks/__tests__/useSessionActions.optimistic-prompt.test.tsx`): server ignores `model` · spawn · client still navigates on `session_added`, no error (test-plan #X7)

## 7. E2E (docker harness)

- [ ] 7.1 Test (L3, see `tests/e2e/split-composer-overflow.spec.ts`): `/folder/<cwd>` at 1440×900 and 768×900, empty draft · load · `composer-card` `scrollHeight<=clientHeight`, Start fully inside card + viewport (test-plan #F1)
- [ ] 7.2 Test (L3, see `tests/e2e/directory-home.spec.ts`): fresh harness · load → Editor → peek → Chat → reload · Split → editor+peek → Split → chat+peek → Chat persists (test-plan #F2)
- [ ] 7.3 Test (L3, same exemplar): Split · pane new-terminal · active `term:` tab, cwd = folder (test-plan #F3)
- [ ] 7.4 Test (L3, same exemplar): folder with ≥2 sessions · load · no `directory-home-session-list` / `directory-home-open-*`, gear present, `LandingPage` absent (test-plan #F4)
- [ ] 7.5 Test (L3, same exemplar): loaded page · click gear · URL `/folder/<encoded>/settings` (test-plan #F5)
- [ ] 7.6 Test (L3, same exemplar): type `"say hi"`, defaults · Enter · Start disabled, converges to `/session/<newId>`, first user message `"say hi"` (test-plan #F6)
- [ ] 7.7 Test (L3, see `tests/e2e/route-backed-overlay.spec.ts` for session fixtures): ended session in a cwd with skill `doc-summarizer`, no live session there · open + type `/` · popover lists `skill:doc-summarizer` with "from disk" hint (test-plan #F12)
- [ ] 7.8 Update `tests/e2e/route-backed-overlay.spec.ts` references to removed `directory-home-*` ids — verify `npm run test:e2e` green for both specs

## 8. Verification

- [ ] 8.1 Full `npm test` green (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`)
- [ ] 8.2 Manual: `/folder/<cwd>` in base dark, base light, one non-base palette at 1440/768/375 vs `mockups/directory-home-split/index.html` — hierarchy, spacing, chip density match (test-plan: manual-only, #F19)
- [ ] 8.3 Close issue #877 referencing this change
