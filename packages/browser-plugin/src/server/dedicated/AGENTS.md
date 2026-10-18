# DOX — packages/browser-plugin/src/server/dedicated

Files in this directory. One row per source file. See change: add-dedicated-agent-browser.

Dashboard-owned Chrome (`@dedicated`): driven over `--remote-debugging-pipe` (fd3/fd4), no extension, no TCP debug port. `DedicatedChrome` supervises the process; `DedicatedInstance` (a `RelayLike`) bridges one agent CDP client to the pipe behind the deny set.

| File | Purpose |
|------|---------|
| `chrome-process.ts` | `DedicatedChrome` — spawns/supervises Chrome (`buildChromeArgs`, `CHROME_STDIO`, seeded prefs), owns pipe, data dir `<configDir>/agent-chrome` (0700), downloads dir, owner record. `ensureRunning` single-flight → `DedicatedChromeError` code `profile-in-use`\|`launch-failed`\|`owned-by-other-server`. `send`/`onMessage`/`onExit`/`stop` (`Browser.close`, 5 s grace, group kill)/`reset` (stopped only)/`sizeBytes` (cached 1/min)/`touch`/`lastUsed`. Own command ids ≥ `CHROME_INTERNAL_ID_BASE` (2e9), replies swallowed. Never deletes Chrome lock files. |
| `dedicated-deny.ts` | Dedicated deny set (D5), pure. `METHOD_CLASSIFICATION` classifies every `Browser`/`Target`/`Storage`/`Tethering`/`SystemInfo`/`Extensions` method (unit test reads protocol.d.ts; unclassified → DENIED). `dedicatedDenied`, `DEDICATED_DENIED_METHODS`, `DEDICATED_ACK_AND_DROP_METHODS`, `navigationUrlAllowed` (scheme allow-list), `isWebUiUrl`, `isBlankNavigation`, `checkOpenUrl` (https + allowed domains), `carriesCookies`/`scrubCookies` for forwarded `Network` events. |
| `dedicated-instance.ts` | `DedicatedInstance implements RelayLike` — one agent CDP client ↔ pipe. Server owns browser-level `Target.setAutoAttach {flatten, waitForDebuggerOnStart}`; proxy answers discovery/auto-attach/attach/detach itself, one session per visible target. Command order: session validity → hidden params → relay deny-list → dedicated deny set → ack-and-drop → proxy verbs → forward with rewritten id. Hidden targets never announced. `attachCdp(ws)`, `openHiddenTab`, `lastActivity`, `closeWithDetach(cause)`. `DEDICATED_PROFILE`=`@dedicated`, `DedicatedHolder`. |
| `hidden-targets.ts` | `HiddenTargets` — registry of server-owned sign-in tabs + derived popups (`openerId`) / frames (`parentFrameId`); one per `DedicatedChrome` (`bindChrome` clears on exit); create-hold (`pending>0`) queues Chrome events so a hidden tab is never announced. `openHiddenTab(chrome, hidden, url, opts)` standalone open when no instance is live. WebUI (`chrome:`) targets recomputed from URL, not stored. |
| `pipe-call.ts` | CDP-over-pipe plumbing. `nextCdpId()` ONE shared counter (always < `CHROME_INTERNAL_ID_BASE`, never reused across instances), `pipeCall(pipe, method, params, opts)` with `DEFAULT_PIPE_CALL_TIMEOUT_MS` 15 s → `PipeCallError`, `PipeLike`, `CdpError`. |
| `pipe-framing.ts` | NUL-delimited JSON framing for Chrome pipe. `encodeFrame(msg)`, `NulFrameDecoder` (byte-level; multi-byte UTF-8 split across chunks safe; chunk-list concat once per frame). |
| `process-identity.ts` | Dedicated Chrome identity by command line: needs `--remote-debugging-pipe` AND `--user-data-dir=<dir>`; helpers (`--type=…`) never the browser; foreign = same dir without pipe flag. `listProcesses` (POSIX `ps -axww`, win32 `Win32_Process`), `parsePsOutput`, `parseWin32Processes`, `hasUserDataDir`, `hasPipeFlag`, `isBrowserProcess`, `classifyProcesses`. Never a bare pid. |
| `tab-id-map.ts` | `TabIdMap` — numeric per-instance tab ids (from 1, never reused) ↔ CDP `targetId` strings. |
| `tap-adapter.ts` | `TapAdapter` — screencast-tap seam. Synthetic sync id `tap:<targetId>` → lazy server-owned flattened session (`Target.attachToTarget`); `onSessionEvent` re-addresses Chrome events; tap session never client-addressable. |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `chrome-process.test.ts` | `DedicatedChrome` supervision over fake spawn/pipe/process list/kill, real fs in temp HOME. #E4 #E5 #E6 #R3–#R6 #R9 #R10. |
| `dedicated-deny.test.ts` | Pure deny set: method classification vs protocol.d.ts, cookie scrubbing, predicates. #E7 #E10 #E11. |
| `dedicated-hidden.test.ts` | Hidden targets, proxy-served discovery and auto-attach. #F1–#F5. |
| `dedicated-instance.test.ts` | `DedicatedInstance` over `FakeChromePipe`. #E7–#E13 #F1–#F5. |
| `dedicated-real-chrome.integration.test.ts` | REAL Chrome behind the proxy + Playwright `connectOverCDP`: no listening TCP socket in process tree, page navigates, no leftover process after stop. Skips without Chrome / display / `ps`+`lsof`. #I2. |
| `dedicated-real-clients.integration.test.ts` | Playwright `connectOverCDP` + `agent-browser connect` handshake, create tab, navigate through the deny set over `FakeChromePipe`; agent-browser skipped when absent. #I1. |
| `dedicated-rig.ts` | Rig: `FakeChromePipe` + in-memory CDP client socket pair + recording `AuditRing`. |
| `dedicated-tap.test.ts` | `TabIdMap` + `TapAdapter` over server-owned sessions (task 3.4). |
| `fake-chrome-pipe.ts` | `FakeChromePipe` — scripted browser-level CDP endpoint (`PipeLike`): targets, flattened sessions, auto-attach pause, create/attach/detach/close; events before reply; async delivery, `flush()`. |
| `fake-chrome.ts` | Fake Chrome child for `DedicatedChrome` tests: fd3 captures NUL frames, fd4 emitter, scripted replies per method. |
| `pipe-framing.test.ts` | NUL framing: split/merged chunks, multi-byte UTF-8 across chunks. |
| `process-identity.test.ts` | Parsers, matchers, one test vs real spawned dummy processes. #R5 #R6. |
