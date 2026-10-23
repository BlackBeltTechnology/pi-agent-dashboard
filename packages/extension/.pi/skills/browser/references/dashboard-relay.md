# Driving a logged-in browser via the Pi Dashboard

Recipe for when the task needs a **logged-in browser** — cookies, SSO sessions,
work logins — and the pi session is running **on the same host as the Pi
Dashboard**. The dashboard hands back a loopback CDP URL that
`agent-browser connect` attaches to directly. Two browsers sit behind it:

- **Dedicated profile** (default) — a Chrome the dashboard starts for the
  agent, with its own data directory. The user signs in once; the logins
  persist.
- **Chrome profile** — one of the user's real Chrome profiles, driven through
  the Playwright Chrome Extension (tab group per instance).

Authored for this repo. Unlike `web.md` / `electron.md` this is **not**
vendored; see [`UPSTREAM.md`](../UPSTREAM.md).

> **Legacy note.** `references/own-browser.md` (Panerelay + native-messaging
> host) is the older path. `browser_connect` **never** routes to Panerelay. Use
> `own-browser.md` only when the dashboard browser is unavailable (dashboard
> down, `GET /api/browser/status` is `404`, `enabled:false`, or neither the
> dedicated profile nor `canOpenChrome` is available) **and** that provider
> reports ready; otherwise halt with a clear message.

## When this recipe applies

- The target is behind a login the agent cannot perform (SSO / 2FA / internal
  tool the user is already signed into), **and**
- the pi session runs on the **dashboard host** (the `cdpUrl` is loopback
  `ws://127.0.0.1:<port>/…`; a remote session cannot dial it).

Do **not** use it for ordinary automation — the bundled browser
(`references/web.md`) is faster and disposable.

> **Never fall back to the bundled browser for a login-state task.** It starts
> logged out and `--profile` copies the profile but loses Keychain-encrypted
> cookies (macOS) — you would silently land logged out. If no logged-in browser
> is available, say so; do not "try anyway".

## Primary recipe — `browser_connect`

1. Call `browser_connect {}`. When the user names a browser, pass
   `{target}`: `"@dedicated"`, `"@headless"`, or a `profileDirectory`.
   The dashboard's `defaultBrowser` setting decides the first target when you
   pass none.
2. Read the result:

| Result | Do |
|---|---|
| `{browser: "dedicated" \| "profile", cdpUrl, instanceId, liveView}` | Run `agent-browser connect <cdpUrl>` and follow [`web.md`](web.md). Keep `cdpUrl` and `instanceId` for the whole task — there is no lookup endpoint. When `liveView` is `true`, do **not** call `browser_show_in_pane` for the first tab. |
| `{browser: "headless"}` and the task needs login state | **Stop.** Tell the user no logged-in browser is available. A headless result is a stop for a login task, never a fallback. Without login state, use the bundled `agent-browser` ([`web.md`](web.md)). |
| `{unavailable, options}` | Ask the user with `ask_user` which `options[].target` to use, then call `browser_connect {target}` again. Connect nothing before the answer. |
| `{unavailable, stopped: true}` | Stop and report `unavailable.reason`. |

3. **Report the browser used** (`browser`, and `profileDirectory` for a
   profile) to the user.
4. Lost `cdpUrl` (compaction)? Call `browser_connect` again; it closes the
   instance your session holds and connects a new one.

`browser_connect` never uses Panerelay. Denied CDP verbs fail loud (see
"Behaviour you must expect") and are **never** retried with a different
browser.

## Fallback recipe — REST, for sessions without `browser_connect`

Same dashboard, via `pi-dashboard api` (a bare `curl` is refused on these routes under the strict
`requireLocalProof` default; the CLI sends local proof). Use the dashboard port (`8000` by default;
`PI_DASHBOARD_PORT` overrides; or pass `--port <n>`). The REST routes do **not** apply the
`defaultBrowser` / `onUnavailable` policy: you choose.

1. Probe status (Step 1).
2. When `enabled` and `dedicated.available` are both true, get a CDP URL with
   `POST /api/browser/dedicated/connect`; otherwise list profiles (Step 2) and
   use `POST /api/browser/connect` with the body form `{profileDirectory}`
   (Step 3).
3. Run `agent-browser connect <cdpUrl>` (Step 4); disconnect when done
   (Step 5).

```bash
pi-dashboard api POST /api/browser/dedicated/connect
# → {"cdpUrl":"ws://127.0.0.1:<port>/ws/browser-cdp/<guid>?ticket=<single-use>","instanceId":"inst-…"}
```

The REST routes for the dedicated profile are
`POST /api/browser/dedicated/{connect,open,stop,reset}`. As an agent you call
only `connect` and `open`; `stop` and `reset` belong to the user in Settings.

## Prerequisites (user-facing, one time)

- **Dedicated profile**: none. Chrome starts on demand; the user signs in once
  (see "Login wall in the dedicated profile").
- **Chrome profile**: Chrome + the **Playwright Chrome Extension** installed in
  the profile you will drive (`GET /api/browser/profiles` reports `installed`
  per profile). For zero-dialog connects, a pairing token pasted in
  **Settings → Browser Relay** (write-only; it never comes back out). Without
  it the user gets Chrome's **Allow** prompt on each connect.

## Step 1 — Probe status

```bash
pi-dashboard api GET /api/browser/status
# → {"enabled":true,"canOpenChrome":true,"operatorHosts":true,
#    "dedicated":{"available":true,"state":"stopped",…}}
```

`dedicated.available` (with `enabled`) is the dedicated-profile probe.
`operatorHosts: true` means this dashboard can also drive the browser on an
**operator's own computer** (see "Browser on the user's own computer" below).
Its absence means an older dashboard: never pass `host` to `connect` then.

Branch on the response:

| Response | Meaning | Do |
|---|---|---|
| `404` | Plugin not loaded / disabled | The relay is not usable; report it. Do **not** fall back to the bundled browser for a login-state task. |
| `{"enabled":false}` | Kill switch is off | Enable it (Step 1b) or ask the user to; a `connect` will `403` until then. |
| `{"canOpenChrome":false}` | Host has no desktop Chrome (container / headless / no `Google Chrome`) | A Chrome profile cannot open on the dashboard host; `connect` will `503`. Use the dedicated profile when `dedicated.available`; otherwise stop — unless `operatorHosts: true` and Step 2 lists an online operator host with the profile you need (use it, see below). |

### Step 1b — Enable the relay (only if `enabled:false`)

```bash
pi-dashboard api PUT /api/browser/enabled \
  --data '{"enabled":true}'
```

The kill switch is safe to flip: turning it off closes every live instance
first (the response returns only after they are gone).

## Step 2 — Pick a profile

```bash
pi-dashboard api GET /api/browser/profiles
```

Rows are keyed by `profileDirectory`. Pick one with `"installed":true`; match a
`label` / `email` when the user named an account. A row's `instances` lists any
live connection already holding that profile.

When Step 1 reported `operatorHosts: true`, the response also carries
`operatorHosts[]`: one entry per **online** operator computer —
`{hostId, label, platform, online, canOpenChrome, profiles[]}` with the same
profile rows (`profileDirectory`, `label`, `email`, `installed`, `instances`).
The top-level `profiles` map is always the dashboard host's Chrome; operator
profiles never appear in it.

## Step 3 — Connect to a Chrome profile

```bash
pi-dashboard api POST /api/browser/connect \
  --data '{"profileDirectory":"Default"}'
```

Success returns `{"cdpUrl":"ws://127.0.0.1:<port>/ws/browser-cdp/<guid>?ticket=<single-use>","instanceId":"inst-…"}`.
The `?ticket=` is a one-time credential (valid 60 s, spent by the first dial): pass the **whole** `cdpUrl`
to `agent-browser connect` unchanged, and never log or share it. A client that drops cannot re-dial the same
URL — call `connect` again for a fresh one.
**Keep the `instanceId`** — it is how you disconnect, and the only public handle
to this instance.

Branch on failure (the HTTP status is authoritative; for an operator `host`
see the extra reasons in the next section):

| Status | `reason` | Meaning | Do |
|---|---|---|---|
| `403` | — | Relay disabled | Enable first (Step 1b). |
| `409` | `not-installed` | Extension absent in that profile | Tell the user to install it in **that** profile; the store link is in Settings → Browser Relay. |
| `409` | `busy` | The profile already hosts a live instance (and the dashboard is configured to allow one) | Reuse the existing `instanceId` if it is yours, or `disconnect` it first. Do not retry blindly. |
| `503` | — | Host cannot open Chrome | Stop; do not fall back to the bundled browser for a login-state task. |
| `504` | — | The extension did not connect within 60 s | Almost always the user did not click **Allow**, or the pairing token mismatched (the dashboard deliberately cannot tell these apart). Ask the user to allow / re-check the token, then retry once. |

## Browser on the user's own computer (operator host)

`connect` targets the **dashboard host** unless the body names an operator
`hostId`:

```bash
pi-dashboard api POST /api/browser/connect \
  --data '{"profileDirectory":"Default","host":"<hostId from Step 2 operatorHosts[]>"}'
```

Rules:

- Pass `host` **only when** `GET /api/browser/status` reported
  `operatorHosts: true`. Without it, do not pass `host`, and tell the user that
  this dashboard cannot drive the browser on their computer.
- When the user asks for the browser on **their own computer** (their laptop,
  not the dashboard host), pass `host` if exactly one online operator host lists
  that profile with `installed: true`. With several candidates, ask which one;
  with none, say so — do not fall back to the dashboard host's Chrome.
- The success response is the same (`cdpUrl`, `instanceId`); continue with Step 4.
  The operator sees a consent prompt on their computer on the first connect.

Operator-host failures (HTTP status is authoritative):

| Status | `reason` | Meaning | Do |
|---|---|---|---|
| `404` | `unknown-host` | That `hostId` is not online (offline, renamed or never registered) | Re-read Step 2 `operatorHosts[]`; if it is gone, report that the user's computer is not connected to the dashboard. |
| `409` | `host-busy` | The operator host is already busy with a connect | Wait briefly and retry once. |
| `403` | `operator-denied` | The user declined the prompt on their computer | Report that the user declined and **halt**. Never retry, never fall back to the dashboard host's Chrome. |
| `504` | `consent-timeout` | The user did not answer the prompt on their computer in time | Ask the user to be at their computer, then retry once. |
| `503` | `no-chrome` | The operator computer has no desktop Chrome | Stop; report it. |
| `503` | `host-gone` | The operator's dashboard window closed or reconnected mid-connect (the instance ends with it) | Re-read Step 2; reconnect once the host is back online. |

An operator instance ends whenever that window's dashboard connection ends
(window closed, reload, server switched, network lost) — treat `host-gone` as a
normal end of the task, not a bug to retry in a loop.

## Step 4 — Attach the CDP client

```bash
agent-browser connect "<cdpUrl from Step 3>"
```

Then follow [`web.md`](web.md)'s workflow (`snapshot`, `click`, `type`, …). The
relay behaves like any CDP endpoint for the allowed surface.

## Step 5 — Disconnect when done

```bash
pi-dashboard api POST "/api/browser/disconnect?instanceId=<instanceId>"
```

Do this as soon as the task ends (it closes the dedicated instance too). A live instance holds a **tab group open in
the user's Chrome**; the dashboard also auto-closes it ~30 s after the CDP
client detaches or disconnects, but an explicit disconnect is faster.

## Behaviour you must expect

- **One tab group per Chrome-profile instance.** The extension opens a dedicated, colour-coded
  Chrome tab group and drives only those tabs. Do not touch the user's other
  tabs; closing the last controlled tab ends the instance.
- **Policy denials are LOUD, not silent.** The relay denies a fixed set of CDP
  verbs and unsafe navigation. A denial is a CDP error `-32000` whose message
  reads `Denied by dashboard relay policy: <method>`:
  - always denied: `Storage.getCookies`, `Network.getAllCookies`,
    `Network.getCookies` (cookie exfiltration).
  - navigation fence on `Page.navigate` / `Target.createTarget`: `file:`,
    `javascript:`, `vbscript:`, `data:`, `blob:`, and — when the profile has
    `allowedDomains` set — any host-less URL or a host outside the list.
  Treat `-32000` as a hard stop: report which call was denied, do not retry it
  in a loop, and do not try to reach the data another way.
- **`Browser.setDownloadBehavior` is acknowledged and dropped (ack-and-drop).**
  Playwright `connectOverCDP` sends it during its handshake and aborts on an
  error, so the relay answers success but never forwards it: the profile's
  download behavior is **never** changed by you. Do not rely on download paths.
- **One CDP client per instance.** A second `connect` to the same `cdpUrl` is
  closed with `Another CDP client already connected`. Use the `instanceId` you
  already hold.
- **DevTools wins.** If the user opens DevTools on a controlled tab, the relay
  reports that tab `detached` and answers its commands with
  `Target detached: devtools`; live-view input stops until DevTools closes.
- **Loopback only.** Both relay endpoints reject tunnel / non-loopback peers
  (checking `Host` and forwarding headers). A pi session that is not on the
  dashboard host cannot use this recipe. This holds for an operator `host` too:
  the `cdpUrl` is still served by the dashboard, so the pi session must still
  run on the dashboard host.

## Showing the page to the user, and handing over a step

Two pi tools (registered by the dashboard's browser plugin, only when you run
inside the dashboard) put your tab in the user's **editor pane**, next to the
chat. Both take the `instanceId` from the connect result; the dashboard knows
*your* session from the connection, so you never pass a session id.

- **`browser_show_in_pane {instanceId, tabId?}`** — open the tab in your
  session's pane. `tabId` defaults to the instance's most recent tab (never the
  extension's own page). One call per 5 s per instance (`rate-limited`
  otherwise). Errors name the cause: `disabled`, `unknown-instance`,
  `unknown-tab`, `no-tab`, `rate-limited`. Skip it for the first tab when
  `browser_connect` returned `liveView: true`.
- **`browser_await_human {instanceId, reason}`** — for a step only the human
  can do. It opens the tab, then **blocks** on a confirm prompt reading
  `reason`; the user acts in the pane (they can type and click there, also from
  a phone) and presses **Done ✓** (or answers in chat). Returns `done`, or
  `cancelled` (declined, timed out, no interactive UI — reason `no-ui`). After
  `done`, continue with your CDP client; after `cancelled`, do not pretend the
  step happened.

**Scope of `browser_await_human`:**

- **Chrome profile**: use it for any human step — login, 2FA, consent,
  CAPTCHA. Continue only on `done`, then re-snapshot the same tab.
- **Dedicated profile**: use it only for **non-sign-in** steps (consent,
  challenge, CAPTCHA). A sign-in goes through `dedicated/open` + `ask_user`
  (next section) — never ask the user to type credentials in your tab.

### Login wall in the dedicated profile

When a page driven through the dedicated profile needs the user to sign in:

1. Open the sign-in page with `POST /api/browser/dedicated/open {url}`, in a
   **hidden** tab the agent cannot see:
   ```bash
   pi-dashboard api POST /api/browser/dedicated/open \
     --data '{"url":"https://example.com/login"}'
   ```
   Only `https:` URLs are accepted (`400` otherwise). The user can also press
   **Open to sign in** in Settings → Browser Relay.
2. Ask the user with `ask_user` to sign in in that window, and wait for the
   answer. The password never reaches you: do not read the hidden tab, do not
   ask for credentials.
3. After the answer, **reload your own tab** and re-snapshot. Still a login
   wall → report it; do not loop.

### Chrome profile closes on a password page

A Chrome-profile instance that closes after a page with a password field is
almost always a password-manager extension (LastPass, iCloud Passwords)
detaching the debugger. Diagnose it from the audit (`GET /api/browser/audit`):

```bash
pi-dashboard api GET /api/browser/audit
```

A `detach` entry for that `instanceId` with detail `closed:<reason>` (the
extension closed the connection) or `extension:<reason>` (another extension
took the tab) confirms it. `devtools` means the user opened DevTools instead.
Then explain the password-manager limit to the user and suggest the **dedicated
profile** for sign-ins. Do **not** retry the same page in that profile.

## Dedicated profile — limits and hard rules

- **One session at a time.** The dedicated profile has a single holder; a
  second `browser_connect` / `dedicated/connect` reports the live instance
  (409 `busy`). Ask the user whether to disconnect it or use another browser.
  Chrome profiles isolate by tab group instead.
- **Same-user limit.** The dedicated profile is **not** protected from other
  programs running as the same OS user. Do not store anything there you would
  not want those programs to read.
- **Never touch its directories.** The agent MUST NOT read, copy, or launch a
  browser on the dedicated profile directory (`~/.pi/dashboard/agent-chrome`).
  It MUST NOT read the dedicated downloads directory
  (`~/.pi/dashboard/agent-chrome-downloads`) unless its task names a file
  there. Reach the browser only through the CDP URL.
- **Downloads** are pinned to that downloads directory by the dashboard;
  `Browser.setDownloadBehavior` from you is acknowledged and dropped.
- **Idle disconnect.** The instance closes after the configured idle time
  (default 30 min), not while a `browser_await_human` is pending. Reconnect
  with `browser_connect`.

## Diagnostics

- Settings → Browser Relay shows the audit trail (`GET /api/browser/audit`) —
  `denied` rows name the refused verb, `navigate` rows name the URL (without
  query string or fragment), `detach` rows carry the cause (`closed:`,
  `extension:`, `devtools`, `idle`).
- `POST /api/browser/disconnect` then reconnect to clear a wedged instance.
- The dashboard shows the same instance as editor-pane tabs
  (`browser:<instanceId>:<tabId>`, opened from the session-card badge menu or by
  `browser_show_in_pane`); if a tab shows the idle indicator (`no-frames`), the
  page simply has not repainted (idle or hidden), which is normal.
- Audit `open` rows record every `browser_show_in_pane` / `browser_await_human`
  call, accepted or refused; `dropped` rows record ack-and-drop verbs.
