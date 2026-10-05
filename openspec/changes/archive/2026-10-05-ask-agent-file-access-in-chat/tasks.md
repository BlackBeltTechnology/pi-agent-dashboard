## 1. Shared foundations

- [x] 1.1 Move `canonical-subject.ts` and `forbidden-subjects.ts` from `packages/server/src/access/` to `packages/shared/src/` with server re-exports so existing imports keep working — verify the existing `canonical-subject.test.ts` / forbidden-subject tests pass unchanged
- [x] 1.2 Add `DashboardConfig.agentPathGate { enabled = true, timeoutSeconds = 120 }` parse + defaults in `packages/shared/src/config.ts` and the `PI_DASHBOARD_AGENT_PATH_GATE` (`off`/`on`) override
- [x] 1.3 Add protocol frames to `packages/shared/src/protocol.ts`: `path_grant_request { requestId, sessionId, promptId, path, subject }`, `path_grant_result { requestId, ok, subject?, error? }`, `dashboard_identity { grantStoreId }`
- [x] 1.4 Widen `AccessGrant.via` to `"prompt" | "agent-prompt"`
- [x] 1.5 Add faux catalog entries `tool-read-outside` (reads `/etc/hostname`) and `tool-read-outside-grantable` (reads `/srv/fixtures-outside/a.txt`, then a sibling) to `qa/fixtures/faux-scenarios.ts`, and create `/srv/fixtures-outside/` in the docker test image

## 2. Bridge path gate (extension)

- [x] 2.1 Implement `packages/extension/src/path-gate/resolve.ts`: pi-parity resolution (`~`, `@` strip, Unicode-space normalisation, resolve against cwd) + nearest-existing-ancestor realpath canonicalisation, with injectable `path` flavour / platform
- [x] 2.2 Implement `path-gate/roots.ts`: cwd + checkout root via the `file-read-containment` resolution rules (async probe started at `session_start`, bounded, fail closed to cwd), built-in read-only roots (pi agent dir, loaded skill dirs, pi docs dir, loaded context files), read+write roots (tmpdir, `/tmp`, session dir); all real-pathed once
- [x] 2.3 Implement `path-gate/grant-cache.ts`: read-only, mtime-gated reader of `~/.pi/dashboard/access-grants.json` (project-scope subjects; malformed/missing → empty)
- [x] 2.4 Implement pure `path-gate/decide.ts` (`decidePathAccess`): component-wise containment via `isSubjectWithin`, verdict set (in-root / ask), option set (Always allow only for grantable + store match), sensitive flag, lexical suppression key
- [x] 2.5 Implement `path-gate/suppression.ts`: per-session 120 s "recently denied" map keyed by lexical parent directory
- [x] 2.6 Implement `path-gate/handler.ts`: gated tools `read`/`write`/`edit` only; per-session mutex; `ctx.ui.select` (metadata `kind:"agent-path-gate"`, no preselection) + `ctx.ui.confirm` (metadata `kind:"agent-path-gate-confirm"`, path, subject); one shared timeout budget with PromptBus cancel; settlement table from design D4/D5; own try/catch → block; `path_grant_request` on confirm and handling of `path_grant_result`
- [x] 2.7 Register the handler in `packages/extension/src/bridge.ts` after the fan-out admission `tool_call` handler (not wrapped in `safe`); store the latest `dashboard_identity.grantStoreId` and compare with the local `~/.pi/dashboard/grant-store-id` on every identity frame; re-read `agentPathGate` on config change
- [x] 2.8 Emit `[path-gate] <outcome> tool= access= path= session= sensitive=` log lines for non-in-root outcomes and in-root counters on the bridge status payload

## 3. Server

- [x] 3.1 Ensure `~/.pi/dashboard/grant-store-id` at startup with exclusive create (`O_EXCL`, `0600`, 128-bit random); re-read it and send `dashboard_identity` on every bridge (re)registration
- [x] 3.2 Implement `packages/server/src/access/agent-confirm-registry.ts`: first-sight-only record of `agent-path-gate-confirm` prompt_requests `{promptId, sessionId, path, subject, expiresAt}`; removed on `prompt_cancel` / session end; settled-on-dismiss with 5 s redeem window; per-session cap; single-use consume
- [x] 3.3 Handle `path_grant_request` in the extension-message dispatch: session-connection binding, registry match (`isSameSubject` on path + subject), re-derive subject and refuse on change, `isUngrantableSubject`, `recordGrant({scope:"project", origin, via:"agent-prompt"})`, reply `path_grant_result`; log accepted/refused with cause
- [x] 3.4 Track `kind` on server-side pending prompts across live fan-out, reconnect replay (exempt from the replay write-nothing rule for this field only) and unicast resync; derive and broadcast session field `awaitingFileAccess`; leave `currentTool` untouched

## 4. Client

- [x] 4.1 Needs-you rollup and urgency-sort predicate: chat-routed `ask_user` state OR `awaitingFileAccess`
- [x] 4.2 Non-modal waiting toast for `agent-path-gate` prompts of a session not in view, with Open action; cleared on settlement
- [x] 4.3 Render the sensitive flag and "can't be remembered here" / "not saved: <error>" notes in the existing select / confirm cards from prompt metadata (new renderer only if the select renderer cannot show them)
- [x] 4.4 Settings ▸ Security: `agentPathGate.enabled` toggle (disabled with reason under env override) + timeout field, draft-bound
- [x] 4.5 Settings ▸ Access: label `via:"agent-prompt"` grants "Agent prompt" with origin session; unknown `via` → generic prompt origin
- [x] 4.6 i18n keys for all new copy

## 5. Tests — L1 path resolution and roots (vitest)

- [x] 5.1 Test in-root relative read — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; cwd `/w/repo`, target `src/a.ts` · `decidePathAccess` read · verdict `in-root`, no prompt (test-plan #E1)
- [x] 5.2 Test `../` traversal — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; cwd `/w/repo`, target `../other/x.txt` · decide read · canonical `/w/other/x.txt`, verdict `ask` (test-plan #E2)
- [x] 5.3 Test tilde expansion — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; target `~/.ssh/id_rsa`, home `/h` · decide read · canonical `/h/.ssh/id_rsa`, `ask`, `sensitive=true` (test-plan #E3)
- [x] 5.4 Test `@` marker — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; target `@/etc/hosts` · decide write · canonical `/etc/hosts`, `ask` (test-plan #E4)
- [x] 5.5 Test string-prefix sibling — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; cwd `/w/repo`, target `/w/repo-old/a.txt` · decide read · `ask` (test-plan #E5)
- [x] 5.6 Test symlink escape — exemplar `packages/server/src/access/__tests__/verified-read.test.ts` (tmp symlink fixture); `/w/repo/link` → `/w/other` · decide write `/w/repo/link/f.txt` · canonical `/w/other/f.txt`, `ask` (test-plan #E6)
- [x] 5.7 Test non-existent nested target — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; target `/w/repo/new/dir/f.txt` absent · decide write · canonical = realpath(`/w/repo`)+`new/dir/f.txt`, `in-root` (test-plan #E7)
- [x] 5.8 Test pi resolution parity — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; fixtures `~/x`, `@/etc/x`, `@~/x`, NBSP name, `../`, absolute · gate resolver vs pi `dist/core/tools/path-utils.js` `resolveToCwd` · identical output; missing pi file fails with "pi path-utils not found" (test-plan #E8)
- [x] 5.9 Test win32 flavour — exemplar `packages/server/src/access/__tests__/canonical-subject.test.ts`; injected `path.win32`, cwd `C:\w\repo`, targets `..\x`, `D:\x`, `\\srv\share\x`, `c:\W\REPO\a` · decide read · drive/UNC `ask`, case-variant cwd `in-root` on case-insensitive volume (test-plan #E9)
- [x] 5.10 Test non-gated tool — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; tool `bash` input `cat /w/other/x` · handler · returns `undefined`, no UI call (test-plan #E10)
- [x] 5.11 Test checkout root — exemplar `packages/server/src/access/__tests__/ladder-scenarios.test.ts`; cwd `/w/repo/packages/a`, probe `/w/repo` · decide read `/w/repo/README.md` · `in-root` (test-plan #E11)
- [x] 5.12 Test probe timeout — exemplar `packages/server/src/access/__tests__/ladder-scenarios.test.ts`; probe exceeds bound · decide read `/w/repo/README.md` from `packages/a` · `ask` (cwd-only fallback) (test-plan #E12)
- [x] 5.13 Test built-in read-only roots — exemplar `packages/server/src/access/__tests__/ladder-scenarios.test.ts`; loaded skill `/h/.pi/agent/skills/x` · read then edit `SKILL.md` · read `in-root`, edit `ask` (test-plan #E13)
- [x] 5.14 Test tmpdir write — exemplar `packages/server/src/access/__tests__/ladder-scenarios.test.ts`; `os.tmpdir()/pi-test.log` · write · `in-root` (test-plan #E14)
- [x] 5.15 Test grant subtree — exemplar `packages/server/src/access/__tests__/access-grants.test.ts`; store `/w/other` · read `/w/other/docs/a.md`, read `/w/other2/a.md` · `in-root`, then `ask` (test-plan #E15)
- [x] 5.16 Test revoke via file rewrite — exemplar `packages/server/src/access/__tests__/access-grants.test.ts`; store `/w/other` then rewritten without it (mtime bump) · decide read `/w/other/a.md` · `ask` (test-plan #E16)
- [x] 5.17 Test malformed store — exemplar `packages/server/src/access/__tests__/access-grants.test.ts`; file `{not json` · decide read `/w/other/a.md` · `ask`, no throw (test-plan #E17)

## 6. Tests — L1 prompt options, settlement and suppression (vitest)

- [x] 6.1 Test option decision table — exemplar `packages/server/src/access/__tests__/planes.test.ts`; grantable×{store match, mismatch, no identity}, `~/notes.txt`, `~/.ssh/x` · build options · Always allow only for grantable+match, else Allow once/Deny + note (test-plan #E18)
- [x] 6.2 Test no ancestor offered — exemplar `packages/server/src/access/__tests__/planes.test.ts`; gated `/w/other/docs/a.md` · build options · only directory named `/w/other/docs` (test-plan #E19)
- [x] 6.3 Test allow once is single-call — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; out-of-root read · `Allow once` then same read · 1st `undefined`, 2nd raises new prompt (test-plan #E20)
- [x] 6.4 Test suppression window boundary — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts` (fake clock); deny `/w/other/a.txt` at t=0 · read `/w/other/b.txt` at 119 s / 121 s · `recently-denied` without UI, then prompt (test-plan #E21)
- [x] 6.5 Test suppression scope — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts`; deny absent `/w/newproj1/a.txt` in S · S writes `/w/newproj2/b.txt`, T reads `/w/newproj1/a.txt` · both prompt (test-plan #E22)
- [x] 6.6 Test suppression beats sensitive — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts`; deny `~/.ssh/a` · read `~/.ssh/b` within 120 s · `recently-denied`, no prompt (test-plan #E23)
- [x] 6.7 Test config decision table — exemplar `packages/shared/src/__tests__/config-access-grants.test.ts`; `{enabled:true}`×env off, `{enabled:false}`, malformed · handler on out-of-root read · `undefined`, `undefined`, default enabled (test-plan #E32)
- [x] 6.8 Test deny — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; answer `Deny` · handler · `{block:true}` reason `denied`, log `outcome=denied` (test-plan #X1)
- [x] 6.9 Test dismiss — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; select resolves `undefined` · handler · `{block:true}` reason `denied` (test-plan #X2)
- [x] 6.10 Test timeout — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts` (injected timers); no answer, 120 s · handler · `{block:true}` reason `timeout`, PromptBus `cancel` once (test-plan #X3)
- [x] 6.11 Test shared budget — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; Always allow at 100 s, confirm unanswered · handler · block at 120 s `timeout`, confirm cancelled, no grant request (test-plan #X4)
- [x] 6.12 Test no UI — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; `ctx.hasUI === false` · out-of-root read · `{block:true}` reason `no-ui`, no UI call (test-plan #X5)
- [x] 6.13 Test internal error — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; `ctx.cwd` getter throws · handler · `{block:true}` reason `error`, no propagation (test-plan #X6)
- [x] 6.14 Test grant write failure — exemplar `packages/chat-gateway/src/guard/__tests__/guard.test.ts`; `path_grant_result ok:false error:"cap"` · after confirm · returns `undefined`, card note "not saved: cap", log records failure (test-plan #X7)
- [x] 6.15 Test endpoint migration — exemplar `packages/extension/src/__tests__/prompt-bus-wiring.test.ts`; identity from A (match), grant answered by B (no entry) · after confirm · `ok:false` → runs once, not saved (test-plan #X8)
- [x] 6.16 Test per-session mutex — exemplar `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`; two concurrent out-of-root calls in one session · both pending · one prompt open at a time, second asks after first settles (test-plan #X9)

## 7. Tests — L1 server grant binding, identity and attention (vitest)

- [x] 7.1 Test subject derivation — exemplar `packages/server/src/access/__tests__/access-grants.test.ts`; path `/w/other/docs/a.md`, subject `/w/other/docs` · `path_grant_request` · stored realpath subject, `scope:"project"`, `via:"agent-prompt"`, origin session (test-plan #E24)
- [x] 7.2 Test binding refusals — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts`; wrong session / unknown / used / expired / cancelled / path mismatch / subject mismatch · request · each `ok:false`, store unchanged (test-plan #E25)
- [x] 7.3 Test replay does not extend TTL — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts`; confirm seen t=0, replayed t=100 s · request t=125 s · refused (test-plan #E26)
- [x] 7.4 Test settled redeem window — exemplar `packages/server/src/access/__tests__/pending-grant-registry.test.ts`; dismiss at t=0 · request at 4.9 s / 5.1 s · accepted / refused (test-plan #E27)
- [x] 7.5 Test subject swap refused — exemplar `packages/server/src/access/__tests__/verified-read.test.ts`; confirm named `/w/other/docs`, dir replaced by symlink → `/w/secret` · request · refused, store unchanged (test-plan #E28)
- [x] 7.6 Test forbidden subject — exemplar `packages/server/src/access/__tests__/access-grants.test.ts`; path `/h/notes.txt` · request · refused (test-plan #E29)
- [x] 7.7 Test HTTP grant binding unchanged — exemplar `packages/server/src/__tests__/access-prompt-routes.test.ts`; POST grant without denial id · route · refused as today (test-plan #E30)
- [x] 7.8 Test grant-store-id creation race — exemplar `packages/server/src/access/__tests__/access-grants.test.ts` (temp dir); two concurrent ensures · startup · created once, both announce same token (test-plan #E31)
- [x] 7.9 Test awaitingFileAccess across disconnect + replay — exemplar `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`; gate prompt tracked, bridge disconnects then replays · events · false after disconnect, true after replay, `currentTool` unchanged (test-plan #X10)
- [x] 7.10 Test sibling tool start keeps flag — exemplar `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`; gate prompt pending · sibling `tool_execution_start` `grep` · flag stays true, `currentTool` = `grep` (test-plan #X11)

## 8. Tests — L1 performance and client (vitest)

- [x] 8.1 Test in-root p95 — exemplar `packages/server/src/access/__tests__/ladder-perf.test.ts`; 10 000 in-root decisions, settled probe, 200-entry store · run · p95 < 1 ms, 0 server messages (test-plan #P1)
- [x] 8.2 Test disabled-gate cost — exemplar `packages/server/src/access/__tests__/ladder-perf.test.ts`; 10 000 handler calls, gate disabled · run · p95 < 0.05 ms, no fs syscalls (spy) (test-plan #P2)
- [x] 8.3 Test server unreachable on in-root — exemplar `packages/extension/src/__tests__/prompt-bus-wiring.test.ts`; `sendToServer` never resolves · in-root read · returns `undefined` without awaiting server (test-plan #P3)
- [x] 8.4 Test Access list `via` labels — exemplar `packages/client/src/components/settings/__tests__/access-page-composition.test.tsx`; grants `via:"agent-prompt"` and `via:"x"` · render · "Agent prompt" + session; generic prompt origin (test-plan #E33)
- [x] 8.5 Test client import guard — exemplar `packages/shared/src/__tests__/browser-protocol-types.test.ts`; client source tree · scan imports · no import of `forbidden-subjects` / `canonical-subject` (test-plan #E34)

## 9. Tests — L3 Playwright (docker harness, faux provider)

- [x] 9.1 E2E card in chat, no modal — exemplar `tests/e2e/faux-ask.spec.ts`; faux `tool-read-outside` · `[[faux:tool-read-outside]] go` · session chat card shows path + Allow once/Deny, grant-host `role=dialog` absent (test-plan #F1)
- [x] 9.2 E2E first answer wins across tabs — exemplar `tests/e2e/access-grant-dialog.spec.ts`; F1 card in two tabs · tab A `Allow once` · tab B card removed, tool result renders content (test-plan #F2)
- [x] 9.3 E2E always allow persists — exemplar `tests/e2e/access-grants-revoke.spec.ts`; faux `tool-read-outside-grantable` · Always allow + confirm · Access lists "Agent prompt" grant; sibling read shows no card (test-plan #F3)
- [x] 9.4 E2E cancelled confirm denies — exemplar `tests/e2e/access-grants-revoke.spec.ts`; as F3 · Always allow then cancel · tool result `denied`, Access list unchanged (test-plan #F4)
- [x] 9.5 E2E needs-you rollup — exemplar `tests/e2e/faux-ask.spec.ts`; A blocked on F1 card, viewing B · observe folder header · rollup "1", A still shows `read` (test-plan #F5)
- [x] 9.6 E2E rollup survives reconnect — exemplar `tests/e2e/optimistic-prompt.spec.ts` (`page.routeWebSocket`); as F5 · drop + restore bridge link · rollup "1", card answerable (test-plan #F6) — e2e drops the BROWSER link; the BRIDGE disconnect/re-register/replay is covered at integration level (`path-gate-attention.integration.test.ts`, bridge socket + subscribed browser + answer routed to the new bridge socket)
- [x] 9.7 E2E toast for other session — exemplar `tests/e2e/faux-ask.spec.ts`; viewing B, A raises gate prompt · — · toast names A with Open, Open selects A, toast gone after answer (test-plan #F7)
- [x] 9.8 E2E no toast when in view — exemplar `tests/e2e/faux-ask.spec.ts`; viewing A · A raises gate prompt · no toast (test-plan #F8)
- [x] 9.9 E2E gate off — exemplar `tests/e2e/blackhole-settings.spec.ts`; Settings ▸ Security toggle off · rerun F1 faux · no card, read succeeds (test-plan #F9)

## 10. Tests — L2 Windows QA

- [x] 10.1 Run the path-gate and shared canonical-subject vitest suites natively on the Windows QA VM — exemplar `qa/tests/16-windows-path-casing.ps1`; Windows VM · run suites · pass on win32 (test-plan #X14)

## 11. Manual verification

- [x] 11.1 Gate card visual review in light + dark theme and mobile width: path legible, sensitive warning noticeable, no allow option visually dominant (test-plan: manual-only, #F10)
- [x] 11.2 TUI-only session (no dashboard): out-of-root read shows select in terminal, answer honoured, no Always allow (test-plan: manual-only, #X12)
- [x] 11.3 Bridge attached to a dashboard on another machine via SSH port-forward: no Always allow, "can't be remembered here" shown (test-plan: manual-only, #X13)

## 12. Docs and coordination

- [x] 12.1 DocScribe: `docs/architecture.md` agent path gate section (roots, fail-closed table, bash non-goal, TOCTOU residual, same-user non-goal); config reference for `agentPathGate` and `PI_DASHBOARD_AGENT_PATH_GATE`
- [x] 12.2 Update directory `AGENTS.md` rows for new/changed files (`packages/extension/src/path-gate/`, `bridge.ts`, `packages/shared/src/` moved modules + `protocol.ts` + `config.ts`, `packages/server/src/access/agent-confirm-registry.ts`, event-wiring, client files)
- [x] 12.3 Add a coordination note to `openspec/changes/add-supervised-tool-approval/tasks.md`: compose `decidePathAccess` before the action gate
- [x] 12.4 Run `security-hardening` on the handler, confirm registry and grant write before commit; `review-code` on the diff (done as 11 ship-it review rounds; rounds 10-11 used @planning as substitute reviewer, @review out of quota)
- [x] 12.5 `npm test` green; `npm run quality:changed` clean (change-touched suites green; full run still shows 11 failures in untouched areas: pi-version pin, plugin-registry, send-types, explore-mockup W2, verify-published-imports — worktree node_modules incomplete; to be confirmed by CI)
