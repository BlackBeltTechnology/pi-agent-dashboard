# Test Plan — harden-server-capability-bounds

Stage: design   Generated: 2026-10-19

Hard gate answered (planning session): orphan clock = starts at spawn, restarts at every last-client detach, paused while attached; confined-browse budget = 200 roots + 200-entry dir, p95 < 50 ms over 100 calls.

Exemplars (harness glue to copy):
- server unit: `packages/server/src/__tests__/terminal-manager.test.ts`, `inline-terminal-handler.test.ts`, `browse-confinement-route.test.ts`, `browse-roots.test.ts`, `recovery-server.test.ts`, `recovery-lockdown.test.ts`, `recovery-reinstall-reject.test.ts`, `authorize-ws-upgrade.test.ts`, `localhost-guard.test.ts`; `packages/server/src/browser-handlers/__tests__/directory-handler.test.ts`
- shared unit: `packages/shared/src/__tests__/config-editor.test.ts`, `browser-protocol-types.test.ts`
- client unit: `packages/client/src/components/__tests__/PathPicker.test.tsx`, `packages/client/src/hooks/__tests__/useMessageHandler.retry-session-error.test.tsx`, `packages/client/src/components/__tests__/Toast.test.tsx`, `packages/client/src/components/__tests__/PathPicker.test.tsx` (mocks `browse-api`)
- e2e: `tests/e2e/terminal-tab.spec.ts`, `tests/e2e/agent-path-gate.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | PTY global cap | BVA | L1 | automated | manager with defaults; 31 live PTYs, then 32 | `spawn(cwd)` | 31→32nd spawns (pty.spawn called once); at 32 → throws `TerminalLimitError{scope:"global",limit:32}`, pty.spawn NOT called, `list()` length stays 32 |
| E2 | PTY per-owner cap | decision-table | L1 | automated | enforced owners: A owns 16, B owns 5, global 21 | `spawn` for A, then for B | A → `TerminalLimitError{scope:"owner",limit:16}`; B → spawns (owner stamped B) |
| E3 | per-owner only when owned | EP | L1 | automated | 20 ownerless live PTYs (inert plane) | `spawn(cwd)` with no owner | spawns; no owner-scope error at 17+ ownerless |
| E4 | per-owner vs global precedence | decision-table | L1 | automated | global 32 live, requester owns 3 | `spawn` for that owner | scope `"global"` (global checked first) |
| E5 | cap config fallback | EP+BVA | L1 | automated | `terminals.maxConcurrent` = `0`, `-1`, `2.5`, `"x"`, `1`, `64` | config parse | first four → 32 (one warn line each parse); `1` → 1; `64` → 64; same for `maxPerOwner` (default 16) and `inlineOrphanTtlMs` (default 600000) |
| E6 | create_terminal refusal delivery | state-transition | L1 | automated | handler ctx with manager at global cap; spies on `ws.send`, `broadcast`, `sessionOrderManager.insert` | `handleCreateTerminal({cwd:"/w"})` | requesting ws receives exactly `{type:"terminal_limit_reached",scope:"global",limit:32,cwd:"/w",inline:false}`; `broadcast` and `insert` not called |
| E7 | inline refusal delivery | state-transition | L1 | automated | manager at cap; eventStore spy | `handleOpenInlineTerminal({cwd,sessionId})` | ws receives `terminal_limit_reached` with `inline:true`; `eventStore.insertEvent` not called; no `terminal_added` |
| E8 | non-cap spawn error rethrown | fault-injection (abort) | L1 | automated | `spawn` throws `Error("pty boom")` | `handleCreateTerminal` | error propagates out of the handler (gateway logger path); no `terminal_limit_reached` sent |
| E9 | tab terminals never reaped | state-transition | L1 | automated | non-ephemeral PTY, no client, fake timers | advance 24 h | PTY not killed; still in `list()` |
| E10 | orphan inline reaped from spawn | BVA | L1 | automated | ephemeral PTY never attached, TTL 600000, fake timers | advance 599 s, then past 600 s + one sweep | alive at 599 s; killed after TTL + sweep |
| E11 | reattach resets orphan clock | state-transition | L1 | automated | ephemeral PTY; detach t=0, attach t=9 min, detach t=9.5 min | advance to 15 min, then 19.5 min + sweep | alive at 15 min; killed by 19.5 min + sweep |
| E12 | attached inline kept | state-transition | L1 | automated | ephemeral PTY with 1 attached client, no output | advance 60 min | not killed |
| E13 | reaped inline keeps transcript | state-transition | L1 | automated | ephemeral PTY with output "hello", orphaned | reaper fires | `getTerminalRecord(id).transcript` contains "hello"; `terminal_removed` path fired once |
| E14 | browse locality × containment | decision-table | L1 | automated | requests: {local 127.0.0.1 no fwd hdr, remote 192.168.1.5} × {path `/`, path `$HOME/Project`} | `GET /api/browse?path=…` | local+`/` → 200, no `confined`; local+home → 200, no `confined`; remote+`/` → 403 `path outside allowed roots`; remote+home → 200 `confined:true` |
| E15 | relayed loopback is remote | EP | L1 | automated | peer 127.0.0.1 with `x-forwarded-for: 203.0.113.9` | `GET /api/browse?path=/` | 403 |
| E16 | root sources | EP | L1 | automated | one dir per source outside $HOME: pinned, session cwd, workspace folder, worktree-init root, project-scope grant, session-scope grant | remote `GET /api/browse?path=<dir>` | first five → 200 `confined:true`; session-scope grant dir → 403 |
| E17 | forbidden filter | decision-table | L1 | automated | pinned `/`, pinned `/Users` (or `/home`), pinned `$HOME` | remote browse `/etc`, `/Users/other`, `$HOME` | `/etc` → 403; `/Users/other` → 403; `$HOME` → 200 (home root explicit) |
| E18 | sensitive subtrees | EP | L1 | automated | `$HOME/.ssh`, `$HOME/.pi/agent` exist | remote browse each | both 403; local browse `$HOME/.ssh` → 200 |
| E19 | symlink containment | EP | L1 | automated | `$HOME/out` → `/etc`; `$HOME/in` → `$HOME/Project` | remote browse each | `out` → 403; `in` → 200 |
| E20 | non-existent path inside root | EP | L1 | automated | `$HOME/does-not-exist` | remote browse | `{success:false,error:"directory not found"}` (not 403) |
| E21 | parent at root top | BVA | L1 | automated | `$HOME` parent outside every root | remote list `$HOME`; remote list `$HOME/Project`; local list `$HOME` | remote home → `parent:null`; remote Project → `parent:$HOME`; local home → `parent` = dirname($HOME), no `confined` |
| E22 | escaping entries omitted | EP | L1 | automated | `$HOME/Dropbox` → `/Volumes/ext/Dropbox` (outside), `$HOME/Project` plain | remote list `$HOME`; local list `$HOME` | remote entries lack `Dropbox`, include `Project`; local includes both |
| E23 | flags confinement | decision-table | L1 | automated | paths `[$HOME/a, /etc]` vs `[$HOME/a, $HOME/b]` | remote `GET /api/browse/flags` | first → 403, `fs.access` never called; second → 200 with both keys |
| E24 | mkdir confinement | decision-table | L1 | automated | parents `/tmp` (outside), `$HOME/x` (inside) | remote and local `POST /api/browse/mkdir {name:"n"}` | remote `/tmp` → 403 and `/tmp/n` absent on disk; remote `$HOME/x` → 200 created; local `/tmp` → 200 created |
| E25 | roots recomputed per request | state-transition | L1 | automated | `/srv/work` not pinned | remote browse (403) → pin `/srv/work` → remote browse | second request 200 without restart |
| E26 | remote pin gate | decision-table | L1 | automated | sockets stamped remote / local | `pin_directory` `/`, `$HOME/Project/app`, `/srv/work` | remote `/` → not pinned + ws gets `folder_refused{path:"/",reason:"outside_allowed_roots"}`; remote home path → pinned; local `/srv/work` → pinned |
| E27 | remote add-folder gate | decision-table | L1 | automated | remote socket, existing workspace W; paths `/opt/x` (outside), `$HOME/p` (inside); local socket with `/opt/x` | `add_folder_to_workspace {id:W,path}` | remote `/opt/x` → W unchanged + `folder_refused{path:"/opt/x"}`, then remote browse `/opt/x` → 403; remote `$HOME/p` → added; local `/opt/x` → added |
| E37 | remote move-folder gate | decision-table | L1 | automated | remote socket; `/opt/x` (not a root), `$HOME/Project/app` (pinned) | `move_folder_to_workspace {path, toWorkspaceId:null}` and `{path, toWorkspaceId:W}` | `/opt/x` → nothing pinned/moved + `folder_refused`; pinned `$HOME/Project/app` → moved into W |
| E38 | BrowseResult.confined type | type-level | L1 | automated | `BrowseResult` value with and without `confined` | assign / read `.confined` | compiles as `boolean \| undefined`; `confined: "yes"` is a `@ts-expect-error` |
| E28 | locality bit stamped at upgrade | EP | L1 | automated | `/ws` upgrades from 127.0.0.1 no fwd hdr; 127.0.0.1 + `x-forwarded-for`; 192.168.1.5 (authenticated) | upgrade | socket `locallyTrusted` = true / false / false; handler ctx exposes it |
| E29 | recovery gate decision table | decision-table | L1 | automated | rows: token match from 192.168.1.5; token mismatch; loopback `Host: localhost:8000` no Origin; + `Origin: http://localhost:8000`; `Origin: http://localhost:3000`; `Origin: null`; `Host: localhost` + `Origin: http://localhost:80`; `Host: [::1]:8000` + `Origin: http://[::1]:8000`; `Host: abc.share.zrok.io` + matching https Origin; peer 192.168.1.5 no token | `isRecoveryActionAllowed` | allow, deny, allow, allow, deny, deny, allow, allow, deny, deny |
| E30 | recovery forwarding headers | EP | L1 | automated | loopback, loopback Host, each of the 8 headers alone (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `x-real-ip`, `forwarded`, `via`, `x-forwarded-server`, `x-forwarded-port`) | `isRecoveryActionAllowed` | deny for each of the 8 |
| E31 | header-list parity | invariant | L1 | automated | recovery inline list; exported `PLUGIN_PROXY_FORWARDING_HEADERS` | compare as sets | equal |
| E32 | recovery bind host | EP | L1 | automated | `startRecoveryServer` without `host`; with `host:"127.0.0.1"` | listen | `server.address().address === "127.0.0.1"`; never `0.0.0.0`/`::` by default |
| E33 | refused reinstall spawns nothing | fault-injection | L1 | automated | `child_process.spawn` mocked; request with `x-forwarded-for` | `POST /api/recovery/reinstall` | 403, body contains remedy text, spawn mock not called |
| E34 | recovery node-built-in imports | static | L1 | automated | source of `packages/server/src/lifecycle/recovery-server.ts` | parse imports | every specifier starts with `node:` (or is a node built-in) — no relative/workspace/npm import |
| E35 | protocol members type-check | type-level | L1 | automated | `{type:"terminal_limit_reached",scope:"owner",limit:16,cwd:"/w",inline:false}`, `{type:"folder_refused",path:"/",reason:"outside_allowed_roots"}` | assign to `ServerToBrowserMessage` | compiles, no `as any`; wrong `scope` value is a type error (`@ts-expect-error`) |
| E36 | refusal log lines | observability | L1 | automated | cap refusal, browse refusal, recovery refusal | each refusal | exactly one log line each with scope/limit (terminal), requested path (browse), route (recovery); no token value in any line |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | confined browse latency budget | tail-latency (timed unit) | L1 | automated | 200 shared roots (tmp dirs as pins), 200-entry dir under `$HOME` (tmp home), remote request | p95 < 50 ms | 100 sequential calls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | terminal limit notice | state-transition | L1 | automated | terminals view mounted for cwd `/w` | dispatch `terminal_limit_reached{scope:"global",limit:32,cwd:"/w",inline:false}` twice, then dismiss, then again + `terminal_added` for `/w` | one `role="status"` notice with "32 terminals are open"; second message replaces (still one); dismiss removes it; `terminal_added` clears it |
| F2 | owner-scope copy | EP | L1 | automated | same view | `terminal_limit_reached{scope:"owner",limit:16,…}` | notice text "You already have 16 terminals open" |
| F3 | inline refusal surfaces in chat | state-transition | L1 | automated | chat view for session S with composer | `terminal_limit_reached{inline:true,…}` after open-inline click | notice shown in the chat slot; no inline card rendered |
| F4 | PathPicker confined hint | decision-table | L1 | automated | browse responses: `{confined:true,parent:null}`; `{parent:null}` (local `/`); `{confined:true,parent:"/Users/r"}` | render picker | first → no `..` row + hint "browse the folders this dashboard shares"; second → no hint; third → `..` row, no hint |
| F5 | PathPicker outside-roots refusal | EP | L1 | automated | `/api/browse` 403 `path outside allowed roots`; `/api/browse/mkdir` 403 same | type `/`; click New folder | inline error "outside the folders this dashboard shares. Ask the host to pin it.", "Back to home" button, raw string absent; same text for mkdir |
| F6 | folder_refused toast | state-transition | L1 | automated | message handler mounted | dispatch `folder_refused{path:"/",reason:"outside_allowed_roots"}` | one error toast containing `/` and "Ask the host to pin it" |
| F7 | recovery page refusal rendering | state-transition | L1 | automated | `buildRecoveryHtml(...)` loaded in jsdom; `fetch` mocked to 403 with remedy body | click Retry start | element with `role="alert"` shows remedy text; both buttons remain enabled |
| F8 | terminal cap end-to-end | state-transition | L3 | automated | docker harness with `terminals.maxConcurrent: 2` in config | open 2 terminal tabs, click "+", close one tab, click "+" | after 3rd click: notice visible, still 2 tabs; after close + click: 2 tabs again and notice gone |
| F9 | remote picker end-to-end | state-transition | L3 | automated | harness browser context sending `x-forwarded-for: 203.0.113.9` (authenticated), path picker open | type `/`; navigate to home | `/` → B2 refusal text; at home → hint shown, no `..` row |
| F11 | browse API typed refusal | EP | L1 | automated | `fetch` mocked: 403 `{error:"path outside allowed roots"}`, 403 `{error:"network_not_allowed",hint}`, 500 `{error:"x"}` | `browseDirectory("/")`, `createDirectory("/tmp","n")` | first → throws error with `code:"path_outside_allowed_roots"` (both helpers); second → `NetworkNotAllowedError` (browse, unchanged); third → plain `Error("x")` |
| F10 | visual fidelity vs mockup | visual/subjective | — | manual-only | notices A2/A3, picker B1/B2, recovery C2, dark + light | human compares to `mockups/index.html` | [judgment: matches mockup, no layout break at 375 px] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | unreadable root dropped | fault-injection (abort) | L1 | automated | pinned dir realpath throws EACCES / deleted | remote browse `$HOME/Project` | 200 (other roots still apply); no 500 |
| X2 | root source throws | fault-injection (abort) | L1 | automated | `listGrants` throws | remote browse a grant-only dir; remote browse `$HOME/Project` | grant-only dir → 403 (fail closed); home path → 200; one warn line |
| X3 | PTY spawn failure not counted | fault-injection (abort) | L1 | automated | node-pty spawn throws after cap check | `spawn` then count | entries count unchanged; next spawn at cap-1 succeeds |
| X4 | reaper vs already-exited PTY | race | L1 | automated | orphan PTY exits on its own in the same tick the reaper fires | sweep | no throw; exactly one tombstone; one `terminal_removed` |
| X5 | real tunnel refusal | fault-injection (network) | — | manual-only | real zrok share of the dashboard | over the tunnel: browse `/`; trigger recovery mode and POST retry | browse `/` → 403 refusal shown; recovery retry → 403 remedy callout |

---

## Coverage summary

- Requirements covered: server-capability-bounds 11/11, filesystem-browser 4/4 (browse, flags, mkdir, PathPicker), server-startup-recovery 3/3, terminal-emulator 1/1, inline-terminal 2/2, shared-protocol 2/2
- Scenarios by class: edge 38 · perf 1 · frontend 11 · error 5
- Scenarios by level: L1 51 · L2 0 · L3 2 · manual 2
- Scenarios by disposition: automated 53 · manual-only 2

## New infra needed

- F8: the docker harness must accept a `terminals.maxConcurrent` override in its seeded `config.json` (check `docker/test-up.sh` seeding; extend if absent).
- F9: confirm how the harness browser is classified. Through docker port mapping the peer may already be non-local (design D1 Docker note); if not, set `extraHTTPHeaders: {"x-forwarded-for": …}` on the context, and make sure the context is authenticated so `networkGuard` admits it.
