# Tasks

WIP commit `1d546c995` on `develop` already holds a first pass (global + per-cwd cap, all-terminal reaper, browse confined for all callers to `$HOME` + pinned, recovery loopback bind + gate without forwarding-header check). Rework it to match `design.md` D1–D4. TDD: write each test first, see it fail, then implement.

## 1. PTY cap (B7, D3)

- [ ] 1.1 Config: add `terminals.maxConcurrent` (32), `terminals.maxPerOwner` (16), `terminals.inlineOrphanTtlMs` (600000) to `packages/shared/src/config.ts` with fail-safe parsing (non-integer or `< 1` → default, one warn line).
- [ ] 1.2 `packages/server/src/terminal/terminal-manager.ts`: replace the per-cwd cap with a per-owner cap (`{iss,sub}` equality, ownerless PTYs count toward global only); `TerminalLimitError.scope` becomes `"global" | "owner"`; global checked first; check before any pty spawn; a failed pty spawn is not counted.
- [ ] 1.3 `terminal-manager.ts`: replace the all-terminal idle reaper (`DEFAULT_IDLE_REAP_MS`) with an orphaned-inline reaper: ephemeral only, clock starts at spawn, restarts at every last-client detach, paused while attached; kills through the existing kill path (transcript tombstone). Tab terminals are never reaped.
- [ ] 1.4 `packages/server/src/server.ts`: pass the three config values into `createTerminalManager`.
- [ ] 1.5 `packages/shared/src/browser-protocol.ts`: add `terminal_limit_reached {scope, limit, cwd, inline}` and `folder_refused {path, reason: "outside_allowed_roots"}` to `ServerToBrowserMessage`.
- [ ] 1.6 `packages/server/src/browser-handlers/terminal-handler.ts`: catch `TerminalLimitError` in `handleCreateTerminal` / `handleOpenInlineTerminal`, send `terminal_limit_reached` to the requesting socket only, log one line; skip broadcast, session-order insert and event insert; rethrow any other error.
- [ ] 1.7 Client: handle `terminal_limit_reached` in the message handler; terminals view notice (mockup A2/A3: `role="status"`, `--severity-warning-*`, dismissible, replaced by the next rejection, cleared by the next `terminal_added` for that cwd); inline refusal shows the same notice in the chat slot.

## 2. Remote browse confinement (B8, D1, D1b, D2)

- [ ] 2.1 `packages/server/src/auth/localhost-guard.ts`: export `PLUGIN_PROXY_FORWARDING_HEADERS` (used by the recovery parity test).
- [ ] 2.2 `packages/server/src/lib/browse-roots.ts`: `resolveBrowseRoots(sources)` over home + pinned + session cwds + workspace folders + worktree-init roots + project-scope grant subjects; drop `isUngrantableSubject` candidates (home added explicitly); a throwing source contributes nothing (one warn); unreadable roots dropped; `isWithinBrowseRoots` uses `safeRealpath` on the request side and refuses `~/.ssh` / `~/.pi` subtrees.
- [ ] 2.3 `packages/server/src/routes/file-routes.ts` + `server.ts` wiring: thread `localTrust` and the root-source readers into `registerFileRoutes`; confine only when `!isLocallyTrusted`; add `confined: true`; `parent: null` at a root top; omit escaping entries from confined listings; flags/mkdir 403 before any probe/write; one log line per refusal.
- [ ] 2.4 `packages/server/src/pairing/browser-gateway.ts`: stamp a per-socket `locallyTrusted` bit at `/ws` upgrade (`isLocallyTrusted` over the upgrade request) and expose it on `BrowserHandlerContext` (`browser-handlers/handler-context.ts`).
- [ ] 2.5 `browser-handlers/directory-handler.ts`: in `handlePinDirectory`, `handleAddFolderToWorkspace` and `handleMoveFolderToWorkspace`, for a non-local socket refuse a canonical path outside the shared roots (before any store write) and send `folder_refused`. `create_workspace` takes only `{name}` and is not gated.
- [ ] 2.6 `packages/shared/src/rest-api.ts`: add optional `confined?: boolean` to `BrowseResult`.
- [ ] 2.7 `packages/client/src/lib/api/browse-api.ts`: add `PathOutsideRootsError` (`code = "path_outside_allowed_roots"`), thrown by `browseDirectory` and `createDirectory` on 403 `path outside allowed roots`; leave the `network_not_allowed` mapping unchanged.
- [ ] 2.8 Client: `PathPicker.tsx` B1 hint (when `confined` and `parent === null`, no `..` row) and B2 refusal (branch on `PathOutsideRootsError.code` from browse or mkdir → plain-language text + "Back to home"); `folder_refused` → error toast with the B2 copy.

## 3. Recovery lockdown (B9, D4)

- [ ] 3.1 `packages/server/src/lifecycle/recovery-server.ts` `isRecoveryActionAllowed`: add an inline 8-header forwarding check; require Origin host (default port stripped, lower-cased) to equal the normalised `Host`; refuse `Origin: null` / unparseable; keep the token path and the loopback-`Host` requirement. Keep imports node built-ins only.
- [ ] 3.2 Keep the loopback default bind and `cli.ts` passing `config.host` + `localToken` (WIP); verify they are unchanged.
- [ ] 3.3 Recovery page: render a 403 body in a `role="alert"` callout with remedy copy (mockup C2), buttons left enabled; one log line per refusal (route only, no token).

## Tests

- [ ] T-E1 L1 extend `packages/server/src/__tests__/terminal-manager.test.ts` (see that file): 31 then 32 live PTYs · `spawn(cwd)` · 32nd spawns; at 32 throws `TerminalLimitError{scope:"global",limit:32}`, pty.spawn not called, count stays 32 (test-plan #E1)
- [ ] T-E2 L1 extend `terminal-manager.test.ts`: enforced owners A=16, B=5 · spawn for A then B · A refused `scope:"owner",limit:16`; B spawns (test-plan #E2)
- [ ] T-E3 L1 extend `terminal-manager.test.ts`: 20 ownerless live PTYs · spawn without owner · spawns, no owner-scope refusal (test-plan #E3)
- [ ] T-E4 L1 extend `terminal-manager.test.ts`: global 32 live, requester owns 3 · spawn · scope `"global"` (test-plan #E4)
- [ ] T-E5 L1 config parse test modeled on `packages/shared/src/__tests__/config-editor.test.ts`: `maxConcurrent` 0/-1/2.5/"x"/1/64 · parse · 32,32,32,32,1,64 + warn lines; same for `maxPerOwner` (16) and `inlineOrphanTtlMs` (600000) (test-plan #E5)
- [ ] T-E6 L1 handler test modeled on `packages/server/src/__tests__/inline-terminal-handler.test.ts`: manager at cap · `handleCreateTerminal({cwd:"/w"})` · ws gets `{type:"terminal_limit_reached",scope:"global",limit:32,cwd:"/w",inline:false}`; broadcast and session-order insert not called (test-plan #E6)
- [ ] T-E7 L1 extend `inline-terminal-handler.test.ts`: manager at cap · `handleOpenInlineTerminal` · `terminal_limit_reached` with `inline:true`; no event inserted; no `terminal_added` (test-plan #E7)
- [ ] T-E8 L1 extend `inline-terminal-handler.test.ts`: spawn throws `Error("pty boom")` · `handleCreateTerminal` · error propagates; no `terminal_limit_reached` (test-plan #E8)
- [ ] T-E9 L1 extend `terminal-manager.test.ts` (fake timers): non-ephemeral PTY, no client · advance 24 h · still live (test-plan #E9)
- [ ] T-E10 L1 extend `terminal-manager.test.ts`: ephemeral never attached, TTL 600000 · advance 599 s then past TTL + sweep · alive then killed (test-plan #E10)
- [ ] T-E11 L1 extend `terminal-manager.test.ts`: detach t=0, attach 9 min, detach 9.5 min · advance to 15 min then 19.5 min + sweep · alive then killed (test-plan #E11)
- [ ] T-E12 L1 extend `terminal-manager.test.ts`: ephemeral with 1 attached client · advance 60 min · not killed (test-plan #E12)
- [ ] T-E13 L1 extend `terminal-manager.test.ts`: orphan with output "hello" · reaper fires · `getTerminalRecord(id).transcript` contains "hello"; removal fired once (test-plan #E13)
- [ ] T-E14 L1 extend `packages/server/src/__tests__/browse-confinement-route.test.ts`: {local, remote 192.168.1.5} × {`/`, `$HOME/Project`} · GET `/api/browse` · 200 no confined / 200 no confined / 403 `path outside allowed roots` / 200 `confined:true` (test-plan #E14)
- [ ] T-E15 L1 extend `browse-confinement-route.test.ts`: peer 127.0.0.1 + `x-forwarded-for` · browse `/` · 403 (test-plan #E15)
- [ ] T-E16 L1 extend `packages/server/src/__tests__/browse-roots.test.ts`: one dir per source (pinned, session cwd, workspace folder, worktree root, project grant, session grant) · remote browse · first five 200 confined, session grant 403 (test-plan #E16)
- [ ] T-E17 L1 extend `browse-roots.test.ts`: pinned `/`, `/Users`, `$HOME` · remote browse `/etc`, `/Users/other`, `$HOME` · 403, 403, 200 (test-plan #E17)
- [ ] T-E18 L1 extend `browse-confinement-route.test.ts`: `$HOME/.ssh`, `$HOME/.pi/agent` · remote / local browse · remote 403 both; local `.ssh` 200 (test-plan #E18)
- [ ] T-E19 L1 extend `browse-roots.test.ts`: `$HOME/out`→`/etc`, `$HOME/in`→`$HOME/Project` · remote browse · 403 / 200 (test-plan #E19)
- [ ] T-E20 L1 extend `browse-confinement-route.test.ts`: `$HOME/does-not-exist` · remote browse · `{success:false,error:"directory not found"}` not 403 (test-plan #E20)
- [ ] T-E21 L1 extend `browse-confinement-route.test.ts`: remote list `$HOME`, `$HOME/Project`; local list `$HOME` · `parent` null / `$HOME` / dirname($HOME) without confined (test-plan #E21)
- [ ] T-E22 L1 extend `browse-confinement-route.test.ts`: `$HOME/Dropbox`→outside, `$HOME/Project` · remote vs local list `$HOME` · remote omits Dropbox; local includes both (test-plan #E22)
- [ ] T-E23 L1 extend `browse-confinement-route.test.ts`: flags `[$HOME/a,/etc]` vs `[$HOME/a,$HOME/b]` · remote GET flags · 403 with no `fs.access`; 200 both keys (test-plan #E23)
- [ ] T-E24 L1 extend `browse-confinement-route.test.ts`: mkdir parents `/tmp`, `$HOME/x` · remote and local POST · remote `/tmp` 403 and nothing on disk; remote home 200 created; local `/tmp` 200 created (test-plan #E24)
- [ ] T-E25 L1 extend `browse-confinement-route.test.ts`: `/srv/work` unpinned · remote browse, pin, remote browse · 403 then 200 (test-plan #E25)
- [ ] T-E26 L1 extend `packages/server/src/browser-handlers/__tests__/directory-handler.test.ts`: remote/local sockets · `pin_directory` `/`, `$HOME/Project/app`, `/srv/work` · remote `/` refused + `folder_refused`; remote home pinned; local `/srv/work` pinned (test-plan #E26)
- [ ] T-E27 L1 extend `packages/server/src/browser-handlers/__tests__/directory-handler.test.ts`: remote socket, workspace W · `add_folder_to_workspace` `/opt/x`, `$HOME/p`; local `/opt/x` · remote outside → W unchanged + `folder_refused`, then remote browse `/opt/x` 403; remote inside added; local added (test-plan #E27)
- [ ] T-E37 L1 extend `directory-handler.test.ts`: remote socket · `move_folder_to_workspace` `/opt/x` with `toWorkspaceId:null`, pinned `$HOME/Project/app` into W · outside → nothing pinned/moved + `folder_refused`; pinned root → moved (test-plan #E37)
- [ ] T-E38 L1 extend `packages/shared/src/__tests__/browser-protocol-types.test.ts`: `BrowseResult` with/without `confined` · read `.confined` · `boolean | undefined`; `confined:"yes"` is `@ts-expect-error` (test-plan #E38)
- [ ] T-E28 L1 extend `packages/server/src/__tests__/authorize-ws-upgrade.test.ts`: upgrades from 127.0.0.1 clean, 127.0.0.1 + `x-forwarded-for`, 192.168.1.5 authenticated · upgrade · `locallyTrusted` true/false/false and visible on handler ctx (test-plan #E28)
- [ ] T-E29 L1 extend `packages/server/src/__tests__/recovery-lockdown.test.ts`: the 10-row Host/Origin/token/peer table · `isRecoveryActionAllowed` · allow, deny, allow, allow, deny, deny, allow, allow, deny, deny (test-plan #E29)
- [ ] T-E30 L1 extend `recovery-lockdown.test.ts`: each of the 8 forwarding headers alone on a loopback request · gate · deny for each (test-plan #E30)
- [ ] T-E31 L1 extend `recovery-lockdown.test.ts`: recovery inline header list vs exported `PLUGIN_PROXY_FORWARDING_HEADERS` · compare as sets · equal (test-plan #E31)
- [ ] T-E32 L1 extend `packages/server/src/__tests__/recovery-server.test.ts`: start without `host` · listen · `address().address === "127.0.0.1"` (test-plan #E32)
- [ ] T-E33 L1 extend `packages/server/src/__tests__/recovery-reinstall-reject.test.ts`: `spawn` mocked, request with `x-forwarded-for` · POST reinstall · 403 with remedy text, spawn not called (test-plan #E33)
- [ ] T-E34 L1 extend `recovery-server.test.ts`: source of `lifecycle/recovery-server.ts` · parse imports · node built-ins only (test-plan #E34)
- [ ] T-E35 L1 extend `packages/shared/src/__tests__/browser-protocol-types.test.ts`: both new messages · assign to `ServerToBrowserMessage` · compiles; bad `scope` is a `@ts-expect-error` (test-plan #E35)
- [ ] T-E36 L1 extend `inline-terminal-handler.test.ts`, `browse-confinement-route.test.ts`, `recovery-lockdown.test.ts`: one refusal of each kind · log spy · one line each with scope/limit, path, route; no token value (test-plan #E36)
- [ ] T-P1 L1 timed test next to `browse-confinement-route.test.ts`: 200 tmp roots + 200-entry dir, remote · 100 sequential `/api/browse` calls · p95 < 50 ms (test-plan #P1)
- [ ] T-F1 L1 client test modeled on `packages/client/src/hooks/__tests__/useMessageHandler.retry-session-error.test.tsx`: terminals view for `/w` · `terminal_limit_reached` twice, dismiss, again + `terminal_added` · one `role="status"` notice "32 terminals are open", replaced, removed, cleared (test-plan #F1)
- [ ] T-F2 L1 same file as T-F1: `scope:"owner",limit:16` · dispatch · "You already have 16 terminals open" (test-plan #F2)
- [ ] T-F3 L1 same file as T-F1: chat view, `inline:true` refusal · dispatch · notice in chat slot, no inline card (test-plan #F3)
- [ ] T-F4 L1 extend `packages/client/src/components/__tests__/PathPicker.test.tsx`: responses `{confined:true,parent:null}`, `{parent:null}`, `{confined:true,parent:"/Users/r"}` · render · hint + no `..` / no hint / `..` without hint (test-plan #F4)
- [ ] T-F5 L1 extend `PathPicker.test.tsx`: browse 403 and mkdir 403 `path outside allowed roots` · type `/`, click New folder · plain-language B2 text + "Back to home", raw string absent (test-plan #F5)
- [ ] T-F11 L1 new `packages/client/src/lib/api/__tests__/browse-api.test.ts` (fetch mock pattern from `PathPicker.test.tsx`): 403 `path outside allowed roots`, 403 `network_not_allowed`, 500 · `browseDirectory("/")`, `createDirectory("/tmp","n")` · `code:"path_outside_allowed_roots"` from both; `NetworkNotAllowedError` unchanged; plain `Error("x")` (test-plan #F11)
- [ ] T-F6 L1 client test modeled on `packages/client/src/components/__tests__/Toast.test.tsx` + `useMessageHandler.retry-session-error.test.tsx`: `folder_refused{path:"/"}` · dispatch · one error toast containing `/` and "Ask the host to pin it" (test-plan #F6)
- [ ] T-F7 L1 extend `recovery-server.test.ts` (jsdom): `buildRecoveryHtml` page, `fetch` mocked 403 · click Retry start · `role="alert"` remedy shown, buttons enabled (test-plan #F7)
- [ ] T-F8 L3 e2e modeled on `tests/e2e/terminal-tab.spec.ts`: harness config `terminals.maxConcurrent: 2` · open 2 tabs, click "+", close one, click "+" · notice + 2 tabs, then 2 tabs and notice gone (test-plan #F8)
- [ ] T-F9 L3 e2e modeled on `tests/e2e/agent-path-gate.spec.ts`: authenticated context with `x-forwarded-for` (or the harness's non-local peer), picker open · type `/`, go home · B2 refusal; home shows hint without `..` (test-plan #F9)
- [ ] T-X1 L1 extend `browse-roots.test.ts`: pinned dir realpath EACCES / deleted · remote browse `$HOME/Project` · 200, no 500 (test-plan #X1)
- [ ] T-X2 L1 extend `browse-roots.test.ts`: `listGrants` throws · remote browse grant-only dir and `$HOME/Project` · 403 and 200, one warn line (test-plan #X2)
- [ ] T-X3 L1 extend `terminal-manager.test.ts`: pty spawn throws after cap check · spawn then count · count unchanged; next spawn at cap-1 succeeds (test-plan #X3)
- [ ] T-X4 L1 extend `terminal-manager.test.ts`: orphan exits in the same tick the reaper fires · sweep · no throw, one tombstone, one removal (test-plan #X4)
- [ ] M1 Manual: compare notices A2/A3, picker B1/B2, recovery C2 in dark + light (and 375 px) against `mockups/index.html` (test-plan: manual-only, #F10)
- [ ] M2 Manual: over a real zrok tunnel, browse `/` shows the refusal and a recovery retry POST gets the 403 remedy callout (test-plan: manual-only, #X5)

## Docs

- [ ] DOC1 Update per-file rows in the nearest `AGENTS.md` / `<File>.AGENTS.md` sidecars for every touched source file (`terminal-manager.ts`, `terminal-handler.ts`, `browse-roots.ts`, `file-routes.ts`, `directory-handler.ts`, `browser-gateway.ts`, `localhost-guard.ts`, `recovery-server.ts`, `config.ts`, `browser-protocol.ts`, `rest-api.ts`, `browse-api.ts`, `PathPicker.tsx`, client notice files).
- [ ] DOC2 Via DocScribe: `docs/` note on terminal caps + config keys, remote browse confinement (shared roots, local exemption, Docker note, marker-less relay residual), recovery lockdown posture.

## Discipline checkpoints

- [ ] D1 `security-hardening` pass on the final diff (root computation, symlink handling, D1b gate, recovery gate).
- [ ] D2 `review-code` on the diff before commit.

## Validate

- [ ] V1 `openspec validate harden-server-capability-bounds --strict` passes.
- [ ] V2 `npm test` green (terminal-manager, handlers, browse, directory-handler, recovery, client suites).
- [ ] V3 Docker harness run for T-F8 / T-F9.
