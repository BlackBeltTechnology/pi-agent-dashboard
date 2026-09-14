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
# → {"enabled":true,"canOpenChrome":true}
```

Use the dashboard port (`8000` by default; `PI_DASHBOARD_PORT` overrides).
Branch on the response:

| Response | Meaning | Do |
|---|---|---|
| `404` | Plugin not loaded / disabled | The relay is not usable; report it. Do **not** fall back to the bundled browser for a login-state task. |
| `{"enabled":false}` | Kill switch is off | Enable it (Step 1b) or ask the user to; a `connect` will `403` until then. |
| `{"canOpenChrome":false}` | Host has no desktop Chrome (container / headless / no `Google Chrome`) | The relay cannot open a profile; `connect` will `503`. Stop. |

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

## Step 3 — Connect

```bash
curl -s -X POST http://localhost:8000/api/browser/connect \
  -H 'content-type: application/json' \
  -d '{"profileDirectory":"Default"}'
```

Success returns `{"cdpUrl":"ws://127.0.0.1:<port>/ws/browser-cdp/<guid>","instanceId":"inst-…"}`.
**Keep the `instanceId`** — it is how you disconnect, and the only public handle
to this instance.

Branch on failure (the HTTP status is authoritative):

| Status | `reason` | Meaning | Do |
|---|---|---|---|
| `403` | — | Relay disabled | Enable first (Step 1b). |
| `409` | `not-installed` | Extension absent in that profile | Tell the user to install it in **that** profile; the store link is in Settings → Browser Relay. |
| `409` | `busy` | The profile already hosts a live instance (and the dashboard is configured to allow one) | Reuse the existing `instanceId` if it is yours, or `disconnect` it first. Do not retry blindly. |
| `503` | — | Host cannot open Chrome | Stop; do not fall back to the bundled browser for a login-state task. |
| `504` | — | The extension did not connect within 60 s | Almost always the user did not click **Allow**, or the pairing token mismatched (the dashboard deliberately cannot tell these apart). Ask the user to allow / re-check the token, then retry once. |

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
    `Network.getCookies` (cookie exfiltration), `Browser.setDownloadBehavior`.
  - navigation fence on `Page.navigate` / `Target.createTarget`: `file:`,
    `javascript:`, `data:`, `blob:`, and — when the profile has
    `allowedDomains` set — any host-less URL or a host outside the list.
  Treat `-32000` as a hard stop: report which call was denied, do not retry it
  in a loop, and do not try to reach the data another way.
- **One CDP client per instance.** A second `connect` to the same `cdpUrl` is
  closed with `Another CDP client already connected`. Use the `instanceId` you
  already hold.
- **DevTools wins.** If the user opens DevTools on a controlled tab, the relay
  reports that tab `detached` and answers its commands with
  `Target detached: devtools`; live-view input stops until DevTools closes.
- **Loopback only.** Both relay endpoints reject tunnel / non-loopback peers
  (checking `Host` and forwarding headers). A pi session that is not on the
  dashboard host cannot use this recipe.

## Diagnostics

- Settings → Browser Relay shows the audit trail (`GET /api/browser/audit`) —
  `denied` rows name the refused verb, `navigate` rows name the URL.
- `POST /api/browser/disconnect` then reconnect to clear a wedged instance.
- The dashboard's live-view tiles (`content-view`) mirror the same instance; if
  a tile shows `no-frames`, the tab simply has not repainted (idle or hidden),
  which is normal.
