# Driving the user's real Chrome via the Pi Dashboard browser relay

Recipe for when the task needs the user's **real, logged-in Chrome** — their
cookies, SSO sessions, work logins, installed extensions — and the pi session
is running **on the same host as the Pi Dashboard**. The relay pairs the
Playwright Chrome Extension with the dashboard and hands back a loopback CDP
URL that `agent-browser connect` can attach to directly.

Authored for this repo. Unlike `web.md` / `electron.md` this is **not**
vendored; see [`UPSTREAM.md`](../UPSTREAM.md).

> **Legacy note.** `references/own-browser.md` (Panerelay + native-messaging
> host) is the older path. Prefer **this** recipe whenever the pi session runs
> on the dashboard host — it needs no native-messaging host install and the
> dashboard already holds the pairing token. Keep `own-browser.md` for the case
> where the agent runs elsewhere and cannot reach a loopback dashboard.

## When this recipe applies

- The target is behind a login the agent cannot perform (SSO / 2FA / internal
  tool the user is already signed into), **and**
- the pi session runs on the **dashboard host** (the `cdpUrl` is loopback
  `ws://127.0.0.1:<port>/…`; a remote session cannot dial it).

Do **not** use it for ordinary automation — the bundled browser
(`references/web.md`) is faster and disposable.

> **Never fall back to the bundled browser for a login-state task.** It starts
> logged out and `--profile` copies the profile but loses Keychain-encrypted
> cookies (macOS) — you would silently land logged out. If the relay is
> unavailable, say so; do not "try anyway".

## Prerequisites (user-facing, one time)

1. Chrome + the **Playwright Chrome Extension** installed in the profile you
   will drive. `GET /api/browser/profiles` reports `installed` per profile.
2. For zero-dialog connects, a pairing token pasted in
   **Settings → Browser Relay** (write-only; it never comes back out). Without
   it the user gets Chrome's **Allow** prompt on each connect.

## Step 1 — Probe status

```bash
curl -s http://localhost:8000/api/browser/status
# → {"enabled":true,"canOpenChrome":true,"operatorHosts":true}
```

`operatorHosts: true` means this dashboard can also drive the browser on an
**operator's own computer** (see "Browser on the user's own computer" below).
Its absence means an older dashboard: never pass `host` to `connect` then.

Use the dashboard port (`8000` by default; `PI_DASHBOARD_PORT` overrides).
Branch on the response:

| Response | Meaning | Do |
|---|---|---|
| `404` | Plugin not loaded / disabled | The relay is not usable; report it. Do **not** fall back to the bundled browser for a login-state task. |
| `{"enabled":false}` | Kill switch is off | Enable it (Step 1b) or ask the user to; a `connect` will `403` until then. |
| `{"canOpenChrome":false}` | Host has no desktop Chrome (container / headless / no `Google Chrome`) | The relay cannot open a profile on the dashboard host; `connect` will `503`. Stop — unless `operatorHosts: true` and Step 2 lists an online operator host with the profile you need (use it, see below). |

### Step 1b — Enable the relay (only if `enabled:false`)

```bash
curl -s -X PUT http://localhost:8000/api/browser/enabled \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

The kill switch is safe to flip: turning it off closes every live instance
first (the response returns only after they are gone).

## Step 2 — Pick a profile

```bash
curl -s http://localhost:8000/api/browser/profiles
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

## Step 3 — Connect

```bash
curl -s -X POST http://localhost:8000/api/browser/connect \
  -H 'content-type: application/json' \
  -d '{"profileDirectory":"Default"}'
```

Success returns `{"cdpUrl":"ws://127.0.0.1:<port>/ws/browser-cdp/<guid>","instanceId":"inst-…"}`.
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
curl -s -X POST http://localhost:8000/api/browser/connect \
  -H 'content-type: application/json' \
  -d '{"profileDirectory":"Default","host":"<hostId from Step 2 operatorHosts[]>"}'
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
curl -s -X POST "http://localhost:8000/api/browser/disconnect?instanceId=<instanceId>"
```

Do this as soon as the task ends. A live instance holds a **tab group open in
the user's Chrome**; the dashboard also auto-closes it ~30 s after the CDP
client detaches or disconnects, but an explicit disconnect is faster.

## Behaviour you must expect

- **One tab group per instance.** The extension opens a dedicated, colour-coded
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

## Showing the page to the user, and handing over a login

Two pi tools (registered by the dashboard's browser plugin, only when you run
inside the dashboard) put your relay tab in the user's **editor pane**, next to
the chat. Both take the `instanceId` from Step 3; the dashboard knows *your*
session from the connection, so you never pass a session id.

- **`browser_show_in_pane {instanceId, tabId?}`** — open the tab in your
  session's pane. `tabId` defaults to the instance's most recent tab (never the
  extension's own page). One call per 5 s per instance (`rate-limited`
  otherwise). Errors name the cause: `disabled`, `unknown-instance`,
  `unknown-tab`, `no-tab`, `rate-limited`.
- **`browser_await_human {instanceId, reason}`** — for a step only the human
  can do (login, 2FA, CAPTCHA). It opens the tab, then **blocks** on a confirm
  prompt reading `reason`; the user acts in the pane (they can type and click
  there, also from a phone) and presses **Done ✓** (or answers in chat).
  Returns `done`, or `cancelled` (declined, timed out, no interactive UI —
  reason `no-ui`). After `done`, continue with your CDP client; after
  `cancelled`, do not pretend the login happened.

## Diagnostics

- Settings → Browser Relay shows the audit trail (`GET /api/browser/audit`) —
  `denied` rows name the refused verb, `navigate` rows name the URL.
- `POST /api/browser/disconnect` then reconnect to clear a wedged instance.
- The dashboard shows the same instance as editor-pane tabs
  (`browser:<instanceId>:<tabId>`, opened from the session-card badge menu or by
  `browser_show_in_pane`); if a tab shows the idle indicator (`no-frames`), the
  page simply has not repainted (idle or hidden), which is normal.
- Audit `open` rows record every `browser_show_in_pane` / `browser_await_human`
  call, accepted or refused; `dropped` rows record ack-and-drop verbs.
