# Native desktop control (agent-desktop) — install + macOS permissions

> AUTHORED for this repo (not vendored). Covers installing
> [`agent-desktop`](https://agent-browser.dev/desktop) and getting macOS
> Accessibility / Screen Recording to actually stick when pi runs under the
> Pi Dashboard. Web pages stay on `agent-browser` (`web.md`); Electron web
> contents stay on `electron.md`.

`agent-desktop` reads a native app's accessibility tree and returns JSON with
`@<snapshot>:eN` refs. Loop: snapshot (skeleton) → drill → act on ref → read
again to verify. No model inside; one JSON envelope per command.

## 1. Install + preflight

Ask the user before installing (global npm install = their choice):

```bash
npm install -g agent-desktop          # macOS / Windows / Linux
agent-desktop status | jq -c '.data.permissions | map_values(.state)'
agent-desktop skills get desktop      # upstream usage guide — load before driving apps
```

- npm may warn `install-scripts … not yet covered by allowScripts` and skip
  `postinstall`. The npm tarball already ships the native binaries; the CLI
  works without it. Reinstall with `--allow-scripts=agent-desktop` only if a
  binary is actually missing.
- Target: `{"accessibility":"granted","screen_recording":"granted"}`.
  `automation: "unknown"` is fine.

## 2. macOS: who must hold the permission?

TCC (the macOS privacy database) grants by **responsible process**, not by
the binary that calls the API. Under Pi Dashboard the chain is

```
pi-dashboard.app → bundled node → pi (nvm node) → bash → agent-desktop
```

and TCC charges every call to **`pi-dashboard.app`**
(`com.blackbelt-technology.pi-dashboard`) — even for sessions whose node
process has been reparented to `launchd` after a dashboard restart. Granting
Terminal, the bundled `node`, the nvm `node`, or the `agent-desktop` binary
does **nothing** for dashboard sessions. (Running pi from Terminal/iTerm
instead → that terminal app is responsible.)

So: grant **pi-dashboard** in System Settings → Privacy & Security →
**Accessibility** AND **Screen Recording**.

```bash
agent-desktop permissions --guide   # opens the right Settings pane
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

## 3. Diagnose — read TCC's verdict, don't guess

The toggle UI lies (entry present but off, or on but unverifiable). Check the
database and the daemon log:

```bash
# What is stored (auth_value 2 = allowed, 0 = denied/off). Readable without FDA.
sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" \
  "select service,client,auth_value,datetime(last_modified,'unixepoch','localtime')
   from access where client like '%pi-dashboard%' or client like '/%'"

# Who TCC thinks is responsible + why it said no
agent-desktop status >/dev/null 2>&1; sleep 2
log show --last 10s --info --debug \
  --predicate 'subsystem == "com.apple.TCC" AND process == "tccd"' --style compact \
  | grep -E 'AttributionChain|matchesCodeRequirement|Failed to match|AUTHREQ_RESULT' | cut -c1-400
```

Read it as:

| Log / DB evidence | Meaning | Fix |
|---|---|---|
| `responsible_path=/Applications/pi-dashboard.app/...` | dashboard app is the subject | grant pi-dashboard (§2) |
| `SecStaticCodeCheckValidity … status: -67050` + `Failed to match existing code requirement` | app is **unsigned** (`codesign -dv` → "code object is not signed at all"); stored grant can never verify → always denied | §4 |
| DB row `kTCCServiceAccessibility … pi-dashboard … 0` | entry exists but toggle is **off** (common after re-adding) | switch it on, recheck |
| no pi-dashboard row at all | never granted | add with `+` |

## 4. Fix: unsigned pi-dashboard.app

Release builds are not yet Developer-ID signed (OpenSpec change
`macos-notarization`). Until then, ad-hoc sign locally and re-grant:

```bash
codesign -dv /Applications/pi-dashboard.app 2>&1 | head -2      # "not signed at all"?
codesign --force --deep --sign - /Applications/pi-dashboard.app
codesign --verify --deep /Applications/pi-dashboard.app && echo SIGNED_OK
tccutil reset Accessibility  com.blackbelt-technology.pi-dashboard
tccutil reset ScreenCapture  com.blackbelt-technology.pi-dashboard
```

Then the user: quit + reopen pi-dashboard, enable it in **both** panes,
confirm. Re-run `agent-desktop status`.

- Ask before running — it modifies the installed app.
- Every dashboard update replaces the bundle → unsigned again → repeat §4.
- Restarting the app alone never fixes an unsigned-app denial.

## 5. Verify

```bash
agent-desktop status | jq -c '.data.permissions | map_values(.state)'   # both "granted"
agent-desktop list-windows --app Finder
agent-desktop snapshot --app Finder --window-id <id> --skeleton -i --compact | jq -c '{ok}'
```

`AMBIGUOUS_TARGET` = several windows match → pick one with `--window-id`
(from `list-windows`); not a permission problem.

## Pitfalls

- Don't add broad interpreters (nvm `node`) to Accessibility as a "try
  everything" step: it is useless under the dashboard (§2) and lets **any**
  node script control the desktop. Remove leftovers.
- `agent-desktop` only sees UIs that publish an accessibility tree; no pixel
  matching.
- Keep one surface per task; for Chromium/Electron web contents hand the
  DevTools port to `agent-browser` (see `electron.md`).
