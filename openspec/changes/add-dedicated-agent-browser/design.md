## Context

See proposal.md for motivation. Current shape of `packages/browser-plugin` (verified 2026-10-17):

- Composition root builds one `AuditRing`, one `RelayManager`, one `BrowserRelayStatus` (`src/server/index.ts`).
- `RelayManager.connect(profileDirectory)` (`src/server/relay/relay-manager.ts:188-257`) is hard-wired to the extension path: enabled check + disable-epoch capture (`:189-197`), `canOpenChrome()` (503), profile lookup (409 `not-installed`), busy check honouring `allowMultipleInstancesPerProfile` (`:211-214`), guid + `inst-<hex>` minting (`:217-218`), `buildConnectUrl` + `openChrome`, 60 s handshake (`CONNECT_TIMEOUT_MS`, `:36`), then `cdpUrl: ws://127.0.0.1:<port>/ws/browser-cdp/<guid>` (`:252-256`).
- The only backend seam is `RelayLike` (`relay-manager.ts:60-70`); `FakeRelayInstance` (`relay/fake-relay-instance.ts`) implements it without a socket. `_createInstance` (`:311-330`) is the single real constructor.
- Network policy: the `/ws/browser-ext` and `/ws/browser-cdp` endpoints are loopback-only and admit no `Origin` on the CDP side (`src/server/ws-routes.ts`, spec "Relay endpoints are loopback-only", `openspec/specs/browser-relay/spec.md:32-44`). The REST `/api/browser/*` routes have no per-route loopback check (`src/server/routes.ts:186-262`); they pass the server's universal network guard (`packages/server/src/auth/localhost-guard.ts`), which admits local callers, the local token, trusted CIDRs and authenticated remote users.
- Deny-list and fence: `relay/deny-list.ts` (`ALWAYS_DENIED_METHODS :27-31`, `ACK_AND_DROP_METHODS :40`, `hostAllowed :75-80`), applied in `RelayInstance._refuseDenied` (`relay/relay-instance.ts:655-672`) with the profile's `allowedDomains`. It was sized for `chrome.debugger`, which already refuses browser-level domains and `chrome://` pages.
- Audit: `AuditRing` (`src/server/audit.ts:37-62`), kinds at `:22-35`. `detach` is appended only for the 30 s no-CDP-client timeout (`relay-instance.ts:363-368`). `_captureDetach` (`:418-429`) returns early unless the reason is `canceled_by_user`; the extension close path (`_captureTabRemoved :479-488` → `_closeExtension :495-497` → `_onExtensionClose :490-493` → `_finalize :843-856`) only calls `logger.info`. That is the spike's `extension-closed:All controlled tabs detached` line.
- Status: `GET /api/browser/status` → `{enabled, canOpenChrome}` (`routes.ts:189-192`); live `browser_relay_status` in `src/server/status.ts:104-123`; `GET /profiles` unions discovered profiles with every live instance's profile key (`routes.ts:133-146`). Client feed `useRelayStatusFeed` (`src/client/relay-store.ts:107-132`), mounted by `BrowserRelayFeed` (`shell-headless`).
- Chrome capability: `canOpenChrome` = system-open AND the default Chrome user-data dir exists (`src/server/capability.ts:49-56`); no binary lookup. The only launch argv is `open -na "Google Chrome" --args --profile-directory=…` / `chrome.exe` / `google-chrome` (`capability.ts:68-89`), spawned fire-and-forget (`src/server/connect.ts:80`).
- Config schema (`configSchema.json`): `enabled` (default false; manifest `defaultEnabled: false`), `defaultBrowser` (declared, never read; type only at `relay-manager.ts:55`), `allowMultipleInstancesPerProfile`, `browsers.<dir>.{token, zeroDialog, allowedDomains}`. Writes go through `PUT /api/browser/enabled` and `PUT /api/browser/profile` (`routes.ts:286-291` explains why `plugin_config_write` is avoided).
- Bridge tools: `browser_show_in_pane` (5 s per-session/instance rate limit, audits every call), `browser_await_human` (`src/bridge/index.ts:59`, `:80`).
- Host helpers: `isProcessAlive`, `processStartedAt`, `killProcessGroup` (`packages/shared/src/platform/process.ts:89`, `:132`, `:257`); `getDashboardConfigDir()` (`packages/shared/src/dashboard-paths.ts:110-112`). `spawnDetached` is not usable here: it forces stdio 1/2 to a log fd or `ignore` and offers no fds 3/4 (`openspec/specs/spawn-detached-output/spec.md`).
- `fix-browser-relay-pane-input` D2 disables the socket idle timeout per connect request because the server's `connectionTimeout` is 10 s (`packages/server/src/server.ts:1703`; template `packages/server/src/routes/git-routes.ts:485-491`).

Chrome constraint: since M136 remote debugging is refused on the default user-data dir only; a non-default `--user-data-dir` is allowed.

## Goals / Non-Goals

**Goals:**
- A dashboard-owned Chrome the agent drives through the existing `/ws/browser-cdp/<guid>` proxy, with the relay's deny-list, fence and audit plus a stricter dedicated deny set.
- While the dashboard runs that Chrome, no CDP endpoint other than the proxy exists.
- One shared server contract (`POST /api/browser/dedicated/connect`) for the bridge tool and other plugins.
- Behaviour settings enforced server-side in one place (`browser_connect`).
- Extension-caused instance closes and detaches audited.

**Non-Goals:**
- CDP multiplexing (several clients on the dedicated Chrome).
- Protecting the profile directory from processes running as the same OS user (see Risks).
- Chromium, Edge, Flatpak/Snap Chrome or Chrome for Testing as the dedicated browser.
- Persisting open tabs across dashboard restarts.
- A per-tab "detached by another extension" viewer state; the spike showed an instance close, not a per-tab detach.

## Decisions

### D1. Transport: `--remote-debugging-pipe`, not a port

Chrome is spawned with stdio `['ignore','ignore','ignore','pipe','pipe']`: fd 3 = commands to Chrome, fd 4 = messages from Chrome, NUL-delimited JSON (the transport Playwright and Puppeteer use for local launches on all three OSes). stderr is ignored, never piped, so a full buffer can't block Chrome.

Why: a debug port on 127.0.0.1 is reachable by every local process, and Chrome advertises it in `DevToolsActivePort`. The agent could connect directly and skip the deny-list and the audit. With a pipe the server process is the only client while it runs Chrome.

Alternative rejected: random loopback port with re-attach after server restart. Survives `/api/restart`, but makes the fence advisory.

Consequence: Chrome's lifetime is bound to the server (D2). Sign-ins persist on disk; open tabs do not.

### D2. Process supervision and ownership

- Argv: `<chrome> --user-data-dir=<dir> --remote-debugging-pipe --disable-sync --no-first-run --no-default-browser-check about:blank`. No `--enable-automation`, no `--headless`.
- Preferences seeded before every launch (merged into `<dir>/Default/Preferences`): `credentials_enable_service: false`, `profile.password_manager_enabled: false`, `signin.allowed: false`, `autofill.profile_enabled: false`. Website sign-in (cookies) still works; Chrome never stores or autofills a password the user typed in the hidden sign-in tab.
- Spawned as its own process group (`detached: true`, not `unref`'d while the pipe is open), stopped with `killProcessGroup` so helper processes go too, matching the group-kill convention (`openspec/specs/command-executor/spec.md`, `headless-spawn`).
- Binary resolution (`capability.ts`): darwin `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then `~/Applications/…`; win32 `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LOCALAPPDATA%` `\Google\Chrome\Application\chrome.exe`; linux `google-chrome`, `google-chrome-stable` on `PATH`. Flatpak/Snap Chrome is not found and reports `no-chrome`; documented.
- Availability: binary found (`no-chrome`) and system-open capability (`no-display`). Independent of `canOpenChrome`, which also requires the default Chrome data dir to exist.
- Process identity: a process is "the dedicated Chrome" only when its command line carries both `--remote-debugging-pipe` and `--user-data-dir=<dedicated dir>` (POSIX: `ps -o args`; win32: `Win32_Process.CommandLine` via PowerShell). Never a bare pid: `processStartedAt` returns `null` on win32 (`packages/shared/src/platform/process.ts`), and pids are reused.
- Owner record `<dir>/.dashboard-owner.json` (mode 0600): `{serverPid, serverStartedAt, serverCmd}`. Several servers (dev, production, worktree, Electron) share `getDashboardConfigDir()`, so a launch checks it first:
  - a dedicated Chrome is running and its owner server is alive → 409 `{reason: "owned-by-other-server"}`;
  - a dedicated Chrome is running and its owner is dead (or no record) → orphan: kill it by identity, then launch;
  - a Chrome on the directory without `--remote-debugging-pipe` (user or agent started it) → 503 `{reason: "profile-in-use"}`;
  - otherwise launch. Chrome's process-singleton handles a stale `SingletonLock`; the server never deletes lock files.
- Launch readiness: the launch resolves on the first reply to `Browser.getVersion` over the pipe. Pipe EOF or process exit first → `profile-in-use` when Chrome handed off to a running instance, else `launch-failed`; no reply within 15 s → `launch-failed` and the process group is killed. The single-flight promise is cleared on every outcome.
- Unexpected exit (user closes the last window, Cmd-Q, crash): pipe EOF / `exit` closes the live instance with `detach` `closed:chrome-exited`, clears the owner record and the single-flight promise, state → `stopped`.
- Launch is single-flight: concurrent `dedicated/connect` and `dedicated/open` share one pending launch promise.
- Graceful shutdown (plugin stop, `enabled:false`, `dedicated/stop`): `Browser.close` over the pipe, wait up to 5 s, then `killProcessGroup`. `Browser.close` lets Chrome flush its cookie store; an abrupt kill (crash, SIGKILL) may lose a sign-in made seconds earlier.
- Downloads: right after launch the server itself sends `Browser.setDownloadBehavior {behavior: "allow", downloadPath: <config dir>/agent-chrome-downloads}` on its own session, so downloads never land in `~/Downloads`. Clients cannot change it (D5).

### D3. Data dir

`getDashboardConfigDir()/agent-chrome` (`~/.pi/dashboard/agent-chrome`), mode 0700, fixed (moving it strands sign-ins). States derived from disk and process: `not-created` (dir absent), `stopped`, `starting`, `running`. Reset deletes the directory only while stopped; `sizeBytes` and `lastUsed` are invalidated by reset and stop. `lastUsed` = time of the last client CDP command or `dedicated/open`.

### D4. Backend seam: `DedicatedInstance implements RelayLike`

`RelayManager.connectDedicated({client?})` beside `connect()`; the extension path at `relay-manager.ts:188-257` is unchanged (keeps the `fix-browser-relay-pane-input` diff isolated). Steps:
1. enabled check (403) and disable-epoch capture, as `connect()` does;
2. availability (503 with reason);
3. busy: a live dedicated instance → 409 `{reason: "busy", instanceId, holder}` where `holder` is the holder's `sessionId` (from `browser_connect`) or `client` label (REST body), regardless of `allowMultipleInstancesPerProfile`;
4. ensure Chrome is running (D2, single-flight); re-check the epoch after the await and after registration, closing what was started when it changed;
5. mint guid + `instanceId` as `:217-218`, register under profile key `@dedicated`, start a 30 s no-client timer (closes the instance with `detach` `no-cdp-client`; Chrome stays);
6. return `{cdpUrl, instanceId}` without a handshake.

`DedicatedInstance` bridges one client socket to the pipe:
- client → Chrome: the relay deny-list (`deniedMethod` with effective allowed domains) and then the dedicated deny set (D5); allowed messages are forwarded with ids rewritten into a per-instance range so server-owned commands never collide.
- Chrome → client: responses routed back by rewritten id; events forwarded.
- Hidden targets: server-owned targets (sign-in tabs from `dedicated/open`, the tap's own sessions) form a hidden set, extended transitively to targets whose `openerId` is hidden (popups) and to child targets of hidden pages. Rule: any client method whose params name a hidden `targetId` or `sessionId` is refused with a CDP error; any result or event naming one is filtered. Hidden tabs are also excluded from `browser_relay_status` and from viewer subscribe (refused, `viewer-subscribe-refused`).
- Discovery and auto-attach are served by the proxy, not forwarded: the server keeps its own browser-level `Target.setDiscoverTargets` + `Target.setAutoAttach {flatten:true, waitForDebuggerOnStart:true}`. For each new page target it decides hidden-or-not, resumes hidden ones with `Runtime.runIfWaitingForDebugger` on its own session, and for visible ones (when the client enabled auto-attach) attaches a client session and honours the client's `waitForDebuggerOnStart`. Discovery announcements to the client follow the relay's rules (each visible page once, `targetDestroyed` once, no child sessions as targets).
- Audit rows (`navigate`, `createTarget`, `denied`, `dropped`) use the relay helpers so they have the same shape.
- Numeric tab ids are mapped from `targetId` per instance (status, pane paths and the tap use numbers).
- Screencast tap adapter implements `sessionIdForTab` / `sendToTab` (`relay-instance.ts:237-243`) over server-owned flattened sessions, so `browser_show_in_pane` and the editor pane work.
- On client close: close the targets this client created, close the instance; Chrome keeps running.

Alternative rejected: hand out Chrome's own `ws://` URL. Incompatible with D1.

### D5. Deny sets

Effective allowed domains = per-profile `browsers.<dir>.allowedDomains` when non-empty, else global `allowedDomains`; the dedicated profile uses the global list. `PUT /api/browser/profile` refuses `@`-prefixed keys.

Dedicated-only additions, because the pipe is browser-level with no extension in between:
- URL allow-list on `Page.navigate` / `Target.createTarget`: only `https:`, `http:` and exactly `about:blank` (Chrome rewrites `about:settings` and similar to `chrome://`);
- WebUI targets (`chrome:`, `chrome-untrusted:`, `devtools:`, `chrome-extension:` URLs) join the hidden set, re-checked on `Target.targetInfoChanged`;
- forwarded `Network` events lose `Cookie` / `Set-Cookie` headers and the cookie fields of `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo`, which otherwise carry HttpOnly values past the cookie-read deny;
- denied methods: `Target.attachToBrowserTarget`, `Target.exposeDevToolsProtocol`, `Browser.close`, `Browser.crash`, `Browser.crashGpuProcess`, `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions`, every `Extensions.*` and `Tethering.*`, cookie writes/clears (`Network.setCookie`, `Network.setCookies`, `Network.deleteCookies`, `Network.clearBrowserCookies`, `Storage.setCookies`, `Storage.clearCookies`), every `Storage.clearData*`, and `Fetch.*` / `Network.*` on the browser-level session;
- classification: a table covers every method of `Browser`, `Target`, `Storage`, `Tethering`, `SystemInfo`, `Extensions` listed as `CommandParameters` keys in `playwright-core/types/protocol.d.ts` (playwright-core 1.62.1, already installed; `node_modules/playwright-core/types/protocol.d.ts:23500`) (allowed / proxy-handled / denied); unclassified methods of those domains are denied, and a unit test walks the protocol JSON so a protocol bump fails until the new methods are classified;
- acknowledged and dropped: `Page.setDownloadBehavior` (like `Browser.setDownloadBehavior`).

A contract test runs Playwright `connectOverCDP` and `agent-browser connect` through the proxy to prove the handshake still succeeds with these sets. Effective allowed domains and the scheme blocks also apply to `dedicated/open {url}`, which only accepts `https:` (400 otherwise).

### D6. `browser_connect {target?}` and the selection policy

New bridge tool backed by a server pi-request handler, which takes the calling session from its connection (as `browser_show_in_pane` does).

Config (added to `configSchema.json`, written by `PUT /api/browser/settings`):
- `defaultBrowser`: `"@dedicated"` (default) | `"@headless"` | a `profileDirectory`. The `@` prefix is reserved; a pre-existing profileDirectory value keeps its meaning. This is a subset of the named-browser registry in `docs/research/browser-provider-registry.md`: `@dedicated` ≙ the registry's `automation` (`dedicated-cdp`).
- `realProfile`: the Chrome profile for the "my Chrome profile" step; written whenever the user picks a profile, kept when the default changes back to dedicated.
- `onUnavailable`: `"ask"` (default) | `"next"` | `"stop"`.
- `idleDisconnectMinutes`: 0, 5, 30 (default) or 120.
- `allowMultipleInstancesPerProfile`: existing key, now written by the same route.
- `openLiveViewOnConnect`: boolean, default `true`.
- `allowedDomains`: string[], default `[]`.

Resolution: the first target is the `target` argument, else `defaultBrowser`. For `"next"`, the attempts are the unique sequence: first target, `@dedicated`, `realProfile`, `@headless`, with entries already tried removed. A profile target that is unset or not installed is skipped with a recorded reason.

| first target | realProfile | `next` attempts |
|---|---|---|
| `@dedicated` | unset | `@dedicated`, `@headless` |
| `@dedicated` | `P` | `@dedicated`, `P`, `@headless` |
| `P` | `P` | `P`, `@dedicated`, `@headless` |
| `@headless` | any | `@headless` |

Results:
- connected: `{browser: "dedicated" | "profile", profileDirectory?, instanceId, cdpUrl, liveView: boolean, attempts}`;
- headless: `{browser: "headless", attempts}`, no `cdpUrl`;
- `"ask"` on failure: `{unavailable: {target, reason}, options: [{target, label, available, reason?}], attempts}`;
- `"stop"` on failure: `{unavailable: {target, reason}, stopped: true, attempts}`.

`browser_connect` never routes to Panerelay; the skill handles that when the dashboard browser is unavailable. When the live dedicated instance's holder is the calling session (lost `cdpUrl`, compaction), the tool closes it and connects a new one; `cdpUrl`s are never looked up or re-sent. `POST /api/browser/disconnect?instanceId=` also closes the dedicated instance. The REST routes do not apply the policy.

### D7. Live view on connect

With `openLiveViewOnConnect`, the instance remembers the calling session and, on its first agent-created tab, opens `browser:<instanceId>:<tabId>` for that session through the `browser_show_in_pane` open path. The auto-open is exempt from the 5 s rate limit (like `browser_await_human` opens) and audits `open` with detail `auto`. The result's `liveView: true` tells the skill not to call `browser_show_in_pane` for that tab.

### D8. Idle disconnect

`lastActivity` is stamped by client-originated CDP commands (not events or responses), by viewer input, and is held while a `browser_await_human` for the instance is pending. A 60 s sweep closes instances idle longer than `idleDisconnectMinutes` (0 = off), with `detach` detail `idle`. The sweep skips when the plugin is disabled (the kill switch closes everything itself) and re-checks each instance is still registered before closing. Relay instances close through `RelayManager.disconnect(instanceId)`; the dedicated instance closes per D4's client-close rule.

### D9. Audit

- `_finalize` (`relay-instance.ts:843-856`) appends `detach` with detail `closed:<reason>` when the reason starts with `extension-closed:`, before `onClosed`.
- `_captureDetach` (`:418-429`) appends `detach` with detail `devtools` for `canceled_by_user` (behaviour otherwise unchanged) and `extension:<reason>` for any other reported reason except `target_closed` (a normal tab close). Only the audit changes; viewer state and command errors stay as today.
- Audit `detail` admits fixed cause tokens besides URLs and method names, and URLs lose their query string and fragment (OAuth `code=`, `authuser=`, tokens) for every profile; existing audit tests are updated.

### D10. Password-manager detection

`profiles.ts` checks each profile's `Extensions/` for a fixed id table and reports `passwordManagers: string[]`. Ids verified on the dev host 2026-10-17: LastPass `hdokiejnpimakedhajhdlcegeplioahd`, iCloud Passwords `pejdijmoenmkgeppbflobdenhhabjlaj`. Other ids are added only after verification against their Web Store listing.

### D11. Routes, status and network policy

- New REST routes behind the same universal guard as the existing `/api/browser/*` routes (authenticated remote dashboards can press "Open to sign in", "Stop", "Reset"): `POST /api/browser/dedicated/connect {client?}`, `POST /api/browser/dedicated/open {url?}`, `POST /api/browser/dedicated/stop`, `POST /api/browser/dedicated/reset` (409 unless stopped), `PUT /api/browser/settings`. The returned `cdpUrl` is only usable from loopback because `/ws/browser-cdp` stays loopback-only.
- `dedicated/connect` and `dedicated/open` may wait for a cold Chrome start; they apply `fix-browser-relay-pane-input` D2's per-request socket-timeout handling (lands first).
- `GET /api/browser/status` gains `dedicated: {available, reason?, state, dataDir, downloadsDir, sizeBytes?, lastUsed?, instanceId?, holder?}`. Consumers probe `status.enabled && status.dedicated.available`. While disabled, every `/api/browser/*` write except `PUT enabled` is 403 (the existing kill-switch rule), so the settings group and panel actions render read-only.
- `browser_relay_status.instances[]` includes the dedicated instance as `@dedicated` (hidden tabs excluded); the badge and pane need no new subscription (`relayTabsOf` / `hasRelayTabs`, `relay-store.ts:39`, `:50`). `GET /profiles` drops `@`-prefixed keys from its instance union.

### D12. Settings UI

Follows `mockups/index.html`. Installed profiles render as today (expanded rows, all existing `data-testid`s kept) with the password-manager pill and warning; uninstalled profiles move behind one disclosure with their store links; the disabled `Connect` for uninstalled rows is retired and its unit assertion updated. Synthetic rows (a live instance whose profile is not on disk) render with the installed rows. Dedicated UI is driven only by `status.dedicated`; the `canOpenChrome` notice applies to the profile list only.

### D13. Skill routing

`SKILL.md` login-state override and `references/dashboard-relay.md` switch to `browser_connect` first; the REST fallback uses the body form `{profileDirectory}`. For a login wall in the dedicated profile, the agent opens the sign-in URL with `POST /api/browser/dedicated/open {url}` (a hidden tab, so the password never reaches the agent), asks the user with `ask_user` to sign in there, then reloads its own tab. A `headless` result for a login task is a stop, not a fallback. A Chrome-profile instance that closes after a page with a password field is diagnosed from the audit (`closed:` / `extension:`). The reference to `references/challenge.md` stays.

## Risks / Trade-offs

- [Same-OS-user processes can read `~/.pi/dashboard/agent-chrome` (cookie store) or start Chrome on it with a debug port while the dashboard's Chrome is stopped] → accepted residual risk, as for every browser profile on the machine; the deny-list is a guardrail for the agent's CDP use, not a boundary against code running as the user. Stated in the skill and the panel.
- [Google sign-in refuses a debugger-attached browser] → no `--enable-automation`, headed window, sign-in in a hidden server-owned tab. Verified manually on macOS before the skill routes to dedicated by default (task gate).
- [`/api/restart` closes Chrome mid-task] → panel copy says open tabs close; `add-gmail-auto-setup` resumes idempotently.
- [Two dashboards on one host] → owner record; the second gets `owned-by-other-server`.
- [Idle sweep during a long human checkpoint] → client commands count as activity; `add-gmail-auto-setup` polls page state while it waits, which keeps the instance alive; `browser_await_human` holds it explicitly.
- [Chrome pipe transport on Windows] → Playwright's `chromium.launch` uses `--remote-debugging-pipe` on all platforms (unverified in-repo); task 10.2 is a merge gate.
- [CDP id rewriting or hidden-set bugs leak server-owned tabs] → unit tests over every `Target.*` path, plus the Playwright contract test.
- [Pipe framing on Windows/Linux] → same framing Playwright uses; Windows and Linux smoke tasks.
- [Tabs the user opens by hand in the dedicated window are visible to the agent] → panel copy says so; WebUI pages stay hidden (D5).
- [The extension relay forwards the same cookie-bearing `Network` events] → out of scope here; follow-up to apply the D5 stripping to relay instances.
- [Downloaded secrets (e.g. an OAuth client JSON) sit in `agent-chrome-downloads`] → consumers import and delete; the skill forbids the agent from reading that directory unless its task names the file.

## Migration Plan

- Config additions are optional with defaults; no migration. An existing `defaultBrowser` profileDirectory keeps working.
- Rollback: reverting leaves `~/.pi/dashboard/agent-chrome` on disk; it is inert.

## Open Questions

- Whether Chrome exits on its own when the pipe closes after a server crash, per OS. D2's orphan handling covers both outcomes.
