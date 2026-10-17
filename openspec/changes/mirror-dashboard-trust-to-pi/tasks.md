## 1. Shared core (`packages/shared`) — tests first

- [ ] 1.1 Write failing golden test for `piTrustKey` against the installed pi trust-store key (see `packages/server/src/__tests__/pi-core-trust-exports.test.ts` for loading pi's `ProjectTrustStore`): inputs `~/p`, symlink `/l → home/w`, missing leaf, NBSP name, case-variant path · compare each with pi's stored key · identical strings, NBSP not normalised, relative input throws (test-plan #E8)
- [ ] 1.2 Write failing table test for `decidePiTrust` (see `packages/server/src/__tests__/host-project-trust.test.ts`): rows recorded `/r:false`+pinned · `/a:false`,`/a/b:true` query `/a/b/c` · none+pinned+ask · none+pinned+never · mirror disabled · no trust-requiring resources · call `decidePiTrust` · untrusted `/r` · trusted `/a/b` · trusted `pinned folder` ×2 · pi resolution · trusted `implicit` (test-plan #E9)
- [ ] 1.3 Write failing test for `mirrorDenyRules` exact set (see `packages/shared/src/__tests__/client-no-node-subjects-import.test.ts` for the shared test layout): pins `/Users`, `$HOME`, `/`, `/usr`, `$HOME/Documents` · filter · first four ignored `forbidden-folder`, `$HOME/Documents` counted (test-plan #E6)
- [ ] 1.4 Write failing test for `mirrorDenyRules` subtree set (same exemplar as 1.3): `/private/tmp`, `/tmp/clone`, `~/Downloads/x`, `~/.ssh/k`, `~/.aws/p`, `~/.cache/c` · filter · all ignored `forbidden-folder` and `forbiddenGrantSubjects()` output byte-identical before/after (test-plan #E7)
- [ ] 1.5 Write failing decision-table test for `filterMirrorEntries` source/choice logic (see `packages/server/src/__tests__/resource-activation-toggle.test.ts` fixture style): pin with `sources.pinned` {true,false} × choice {unset,true,false} · filter · counted iff (source on ∧ choice≠false) ∨ choice=true, else `source-off` (test-plan #E1)
- [ ] 1.6 Write failing test (same exemplar as 1.5): `accessGrants` off, project-root grant with choice `true` and one without · filter · first counted, second `source-off` (test-plan #E2)
- [ ] 1.7 Write failing test for config defaults (see `packages/shared/src/__tests__/config-access-grants.test.ts`): config without `piTrustMirror` and with `{enabled:false}` · parse · defaults `enabled:true, coverInteractive:false, accessGrants:false`, others true; partial merges (test-plan #E21)
- [ ] 1.8 Implement `piTrustKey`, `decidePiTrust`, `mirrorDenyRules`, `filterMirrorEntries`, reason-code type, snapshot types and `piTrustMirror` config schema; move pure `normalizeHook`/`canonicalize`/`hookDefHash` from `packages/server/src/git-worktree/worktree-init.ts` to shared (server re-imports); verify 1.1–1.7 pass and `packages/server/src/__tests__/worktree-init-trust.test.ts` stays green

## 2. Server sources, choices and snapshot

- [ ] 2.1 Write failing test (see `packages/server/src/__tests__/worktree-init-trust.test.ts`): worktree entry for hash H1, current hook H2 · registry+filter · ignored `hook-changed`, counts after recording H2 (test-plan #E3)
- [ ] 2.2 Write failing test (same exemplar): session worktree trust `/r`, YOLO root `/w`, session grant `/g` · registry list + snapshot · none counted and none of the paths appear in snapshot bytes (test-plan #E4)
- [ ] 2.3 Write failing test (same exemplar): worktree entry keyed `path.resolve('/l/repo')` with `/l` a symlink · registry · keyed canonical, covers `/real/repo/x` (test-plan #E26)
- [ ] 2.4 Write failing test (see `packages/server/src/__tests__/preferences-store-workspace-seam.test.ts`): pin via dialog with choice `false`, move folder to another workspace, plus pre-existing pin · registry + Access data · choice kept, pre-existing marked "by default" (test-plan #E22)
- [ ] 2.5 Write failing test (see `packages/server/src/__tests__/resource-activation-toggle.test.ts` fs fixtures): durable pin + session worktree trust · snapshot write · mode 0600, durable entries only, no session path bytes, generation increases (test-plan #E19)
- [ ] 2.6 Write failing test (same exemplar as 2.5): 5,000 then 5,001 counted entries · rewrite · no warning at 5,000, one warning at 5,001 (test-plan #E20)
- [ ] 2.7 Write failing fault test (same exemplar as 2.5): snapshot writer throws EACCES · unpin `/r` · unpin errors, `/r` still pinned, snapshot unchanged (test-plan #X5)
- [ ] 2.8 Write failing fault test (same exemplar as 2.5): choices writer throws ENOSPC · pin `/r` with choice `false` · pin fails, not pinned, snapshot unchanged (test-plan #X6)
- [ ] 2.9 Write failing fault test (same exemplar as 2.5): `pi-trust-overrides.json` = `{` · registry + Access data · pins not counted, reason `choice-unreadable` (test-plan #X7)
- [ ] 2.10 Write failing fault test (see `packages/server/src/__tests__/worktree-init-trust.test.ts`): worktree store write throws · revoke `/r` hash H · revoke reports failure, snapshot already without `/r` (test-plan #X8)
- [ ] 2.11 Write failing fault test (same exemplar as 2.5): preferences contain pin `/r`, stale snapshot lacks it · server boot · snapshot rebuilt with `/r`, generation increased (test-plan #X9)
- [ ] 2.12 Implement the durable source registry (worktreeInit current-hash, workflow slot reporting `source-not-installed`, pinned incl. Docker-seeded, folderWorkspaces, accessGrants project-root), `pi-trust-overrides.json` choices, snapshot writer (home-lock holder, 0600, boot rebuild, revoke-snapshot-first, grant-store-first, >5,000 warning), write-through revocation in `preferences-store.ts` and failure-reporting revoke in `worktree-init-trust.ts`; verify 2.1–2.11 pass

## 3. Server consumers

- [ ] 3.1 Write failing test (see `packages/server/src/__tests__/host-project-trust.test.ts`): `PI_CODING_AGENT_DIR=/x/agent` with `{"/r":true}` there · `host.isProjectTrusted("/r")` · true with source `/r` (test-plan #E24)
- [ ] 3.2 Write failing fault test (same exemplar as 3.1): pi core resolution throws · `loadHostProjectTrust` · exactly one log line, predicate false (test-plan #X10)
- [ ] 3.3 Write failing test (see `packages/mcp-client-plugin/src/core/__tests__/effective-view.test.ts`): pin-only trust, `pi mcp list` stub reports project servers absent, accessor present/absent · effective view · servers active, live `not checked by pi` + note, source present/omitted (test-plan #E25)
- [ ] 3.4 Write failing test (see `packages/mcp-client-plugin/src/core/__tests__/config-writer.test.ts`): dashboard-only-trusted folder defines `docs` · global write `docs` · no collision; pi-trusted folder still collides (test-plan #E23)
- [ ] 3.5 Write failing test (see `packages/server/src/__tests__/resource-activation-toggle.test.ts`): pinned cwd, nothing recorded, default `ask` · `POST /api/resources/toggle` local · 403 `trustRequired` with `preselected:"trust"`, source `pinned folder`, lasting-effect note; settings.json and trust.json unchanged (test-plan #E17)
- [ ] 3.6 Write failing test (same exemplar as 3.5): pinned + `never` · exact `{"/r":false}` pinned · `{"/a":false}` + pinned `/a/b` · toggle · prompt · refuse without prompt · prompt without pre-selection (test-plan #E18)
- [ ] 3.7 Implement `host-project-trust.ts` (shared decision, agent dir via `PI_CODING_AGENT_DIR`, one boot log, optional `host.projectTrustSource`), mcp-client effective-view source + "not checked by pi", pi-only predicate for config-writer collisions, `resolveToggleTrust` pre-selection; verify 3.1–3.6 pass

## 4. Bridge (`packages/extension`)

- [ ] 4.1 Write failing test (see `packages/extension/src/__tests__/project-trust.test.ts`): 4 session classes × `coverInteractive` {false,true}, cwd pinned · handler · only dashboard-spawned headless yes when false (others undecided `not-covered-session`), all yes when true (test-plan #E11)
- [ ] 4.2 Write failing test (same exemplar): activationCwd `/link/repo` symlink, eventCwd real path, dashboard-spawned headless · handler · yes (test-plan #E12)
- [ ] 4.3 Write failing test (same exemplar): activation = event = `/private/tmp/clone` · handler · undecided, log contains `forbidden-folder` (test-plan #E13)
- [ ] 4.4 Write failing test (same exemplar): activation cwd `/r`, trust.json `{"/r":false}` · handler · undecided, log contains `recorded-entry` (test-plan #E14)
- [ ] 4.5 Write failing test (same exemplar): trust.json BOM-valid, `null`, `"yes"`, torn, absent with `/r` pinned · handler in `/r/app` · recorded-entry · yes · store-unreadable ×2 · yes (test-plan #E15)
- [ ] 4.6 Write failing test (see the existing spawn-token tests for `consumeSpawnToken` in `packages/extension/src/__tests__/`): env token `t1` (and `""`), dashboard reachable and unreachable, a `/reload` before first register, both register paths racing · activation then registers · env unset right after activation with `dashboardSpawned` true captured first; exactly one register carries `t1` (also after the reload); empty token → `dashboardSpawned` false, no `spawnToken`; nested child env lacks the token (test-plan #E16)
- [ ] 4.7 Write failing test (same exemplar as 4.1, tmp dirs): pinned folder unchanged / deleted+re-created / entry without birthtime · handler · yes / `identity-mismatch` / yes (test-plan #E10)
- [ ] 4.8 Write failing test (same exemplar as 4.1): project-root grant `/r`, snapshot written, then `.git` removed · handler in `/r/app` · yes, then undecided `not-project-root` (test-plan #E5)
- [ ] 4.9 Write failing fault test (same exemplar as 4.1): no server, snapshot lists `/r` · dashboard-spawned headless in `/r` · yes, no network call (test-plan #X1)
- [ ] 4.10 Write failing fault test (same exemplar): snapshot absent / truncated · handler · undecided, no throw escapes (test-plan #X2)
- [ ] 4.11 Write failing fault test (same exemplar): server down, `piTrustMirror.enabled:false`, snapshot lists `/r` · handler in `/r` (not activation cwd) · undecided (test-plan #X3)
- [ ] 4.12 Write failing fault test (same exemplar): server down, hook edited after snapshot · handler in repo · undecided `hook-changed` (test-plan #X4)
- [ ] 4.13 Write failing fault test (same exemplar): ancestor chmod 000 · handler · undecided `identity-mismatch`, no throw (test-plan #X11)
- [ ] 4.14 Write failing invariant test (same exemplar + `host-project-trust.test.ts`): trust.json bytes B · 50 bridge decisions + 50 host predicate calls · bytes and mtime unchanged (test-plan #E27)
- [ ] 4.15 Write failing timed test (same exemplar as 4.1): snapshot 1,000 entries, cwd 20 deep, warm fs · 200 handler decisions · p95 < 20 ms (test-plan #P1)
- [ ] 4.16 Implement the bridge: capture `dashboardSpawned` and scrub the spawn token at activation (keep value for first register), canonical activation compare + deny rules + recorded-entry check, lockless trust.json read with pi's rules, config + snapshot read per event (no module caches), identity + hook recompute + project-root recheck, reason-code logging, inside `safe()` with explicit undecided; verify 4.1–4.15 pass and existing `project-trust.test.ts` scenarios still pass

## 5. Client

- [ ] 5.1 Write failing component test (see `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx`): default settings · open worktree-init, pin, Add Folder dialogs and the access-grant prompt · checkbox checked/checked/checked/unchecked, consequence text names extensions + MCP servers incl. later additions (test-plan #F1)
- [ ] 5.2 Write failing component test (see `packages/client/src/components/settings/__tests__/access-page-composition.test.tsx`): pinned Documents, grant `/private/tmp`, hook-changed entry, agent dir `/x/agent` · render Access · effective row, ignored rows with codes + labels, precedence/coverInteractive/`--no-approve`/`--no-extensions` disclosures, agent dir shown (test-plan #F2)
- [ ] 5.3 Write failing component test (see `packages/mcp-client-plugin/src/client/__tests__/FolderMcpPage.test.tsx`): trustedBy pi / dashboard / none, coverInteractive false · render · three texts, dashboard text says dashboard sessions only, none links to Access (test-plan #F3)
- [ ] 5.4 Write failing component test (see `packages/client/src/components/settings/__tests__/AccessPromptsSection.test.tsx` and `ResourceTrustDialog` usage): payload `preselected:"trust"` · render, Esc, reopen, confirm · trust pre-selected, lasting-effect text, Esc sends nothing, confirm sends one `/api/resources/trust` (test-plan #F4)
- [ ] 5.5 Implement the checkbox in the four dialogs, Settings → Access mirror blocks, MCP folder banner states and toggle-prompt pre-selection; verify 5.1–5.4 pass

## 6. End to end, docs, verification

- [ ] 6.1 Write Playwright spec (see `tests/e2e/project-trust-headless-spawn.spec.ts` and `tests/e2e/mcp-client-project-override.spec.ts`): harness folder with `.pi/mcp.json` stdio echo server, pinned, empty trust.json · spawn headless session · tool list has the folder server's tool; folder MCP page shows "trusted by the dashboard — pinned folder" (test-plan #F5)
- [ ] 6.2 Extend the same spec: after 6.1 · unpin, spawn a new headless session · new session lacks the tool; Access effective list no longer lists the folder (test-plan #F6)
- [ ] 6.3 Manual check of Settings → Access wording at desktop and mobile width: precedence and scope understandable (test-plan: manual-only, #M1)
- [ ] 6.4 Delegate `docs/` updates (architecture §MCP client trust, faq "Why is my mcp.json server ignored?", security notes: default ON, subtree, precedence over `never`, three bridge behaviour changes, reason codes) to DocScribe in caveman style; update `AGENTS.md` rows for every touched source file; verify `scripts/check-conventions.mjs` passes
- [ ] 6.5 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and `npm run quality:changed`; verify green
- [ ] 6.6 Record the new boundary (dashboard trust → pi `project_trust` via snapshot) in the security-boundary inventory left by the archived `security-boundary-audit`; verify the inventory row exists
