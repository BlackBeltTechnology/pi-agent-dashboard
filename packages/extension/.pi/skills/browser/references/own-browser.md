# Driving the user's own logged-in browser

Recipe for when the task needs the user's **real browser** — their cookies,
SSO sessions, work logins, installed extensions — rather than the clean
Chrome for Testing that `agent-browser` launches by default.

Not vendored from upstream. Authored for this repo; see
[`UPSTREAM.md`](../UPSTREAM.md).

## When this recipe applies

Use it when the target is behind a login the agent cannot perform: SSO /
2FA-gated apps, internal tools, a Gmail/Slack/Jira session the user is
already signed into.

Do **not** use it for ordinary automation. The default bundled browser
(`references/web.md`) is faster, disposable, and has more capability —
prefer it whenever login state is irrelevant.

## Why the obvious approaches fail

Try these first only if you want to confirm; all three are dead ends for a
real daily-driver profile:

| Approach | Outcome |
|---|---|
| `--remote-debugging-port` / `--cdp <port>` | **Chrome M136+ refuses it on a real user profile** — it would defeat Safe Storage HMAC isolation. |
| `--auto-connect` | Discovers Chrome via `DevToolsActivePort` files, which exist **only** when Chrome was launched with the debug flag. Normal sessions never create them. |
| `--profile Default` | Copies the profile to a temp dir. On macOS cookies are Keychain-protected and the copy cannot decrypt them → **you land logged out**. Upstream: [vercel-labs/agent-browser#1319](https://github.com/vercel-labs/agent-browser/issues/1319). |

The working path is a **different control plane**: an MV3 browser extension
plus a native-messaging host. The extension drives tabs through extension
APIs, so cookies and SSO come for free and no debug port is involved.

**Capability trade-off** — the extension path gives up CDP-class powers:
no `network route` interception, no isolated worlds, no `trace`/`profiler`.
If the task needs those, it needs the bundled browser.

## Strategy selection

| Need | Use |
|---|---|
| No login required | default bundled browser — `references/web.md` |
| Login the agent can perform itself | `auth save` + `auth login`, or `--session-name` |
| Auth captured once, replayed headless | `state save` / `--state <path>` |
| **Live SSO / 2FA / the user's actual session** | **Panerelay (this recipe)** |

## Setup — platform independent

Requires `agent-browser >= 0.33.0` (the `--provider <plugin name>`
interface). Verify first; everything else fails confusingly without it:

```bash
agent-browser --version
```

> **Consent gate — do not run the installer autonomously.** Per Step 0a of
> [`../SKILL.md`](../SKILL.md), installs are the user's explicit choice.
> This one installs a **native-messaging host** and asks for a browser
> extension with `debugger` + `nativeMessaging` + `scripting` permissions,
> so it warrants a deliberate yes. Present the command, state what it
> installs, and wait. Diagnostics (`doctor`, `check-panerelay.sh`) are
> read-only and safe to run unprompted.

The command to hand the user — **omit `--global-default`** so Panerelay
stays opt-in per command and never hijacks their other sessions:

```bash
npx --yes @panerelay/setup --agent-browser
```

This writes a native-messaging host, registers a `panerelay` plugin in
`~/.agent-browser/config.json`, and prints a Chrome Web Store link plus the
extension ID. Then, in the browser:

1. Install the extension from the Web Store link.
2. Open its **side panel** — the connection registers when the panel opens.

Extension installation requires a real user gesture. **The agent cannot do
this step**; hand it to the user and wait.

### Scope it to a dedicated profile (recommended)

The extension gets `debugger` + `nativeMessaging` + `scripting` on tabs it
is authorized for — on an authorized tab it can read and modify page
content and cookies, and pipe them to a local binary. Confine that blast
radius by installing it in a profile created for automation, leaving work
and personal profiles unreachable (they have no extension at all).

Weigh this against how new the dependency is before recommending it —
check `npm view @panerelay/setup` and the repo's age/stars. Say so plainly
rather than presenting it as a routine install.

Create the profile by launching the browser with a **new** profile
directory name:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --profile-directory="AgentAutomation" "https://example.com"

# Linux
google-chrome --profile-directory="AgentAutomation" "https://example.com"

# Windows (PowerShell)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --profile-directory="AgentAutomation" "https://example.com"
```

Chrome creates the profile on first use. Install the Panerelay extension
**only in that window**.

Then confirm containment — the native-host manifest must list exactly the
one extension ID, so no other extension can reach the host:

```bash
for D in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
         "$HOME/.config/google-chrome/NativeMessagingHosts"; do
  [ -d "$D" ] || continue
  grep -l panerelay "$D"/*.json 2>/dev/null | while read -r f; do
    echo "manifest: $f"; grep -A2 '"allowed_origins"' "$f"
  done
done
```

Expect exactly one `chrome-extension://<id>/` entry.

Manifest locations by OS:

| OS | Native-messaging manifest directory |
|---|---|
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` |
| Windows | registry `HKCU\Software\Google\Chrome\NativeMessagingHosts\` |

> Verified on macOS. Linux/Windows locations follow Chrome's documented
> native-messaging convention — confirm with
> `npx --yes @panerelay/setup doctor` on those platforms, which prints the
> resolved path it actually installed.

## Listing and selecting profiles

### List

```bash
agent-browser profiles
```

Self-discovering — it resolves the OS-specific Chrome data directory for
you, so prefer it over hardcoding paths. Output is `<directory>  (<label>)`:

```
Chrome profiles (/Users/me/Library/Application Support/Google/Chrome):

  Default      (Person 1)
  Profile 21   (someone@work.example)
  AgentAutomation
```

The left column is the **profile directory** — that is the token both
`--profile` and `--profile-directory` expect. The parenthesised label is
the display name and is *not* a valid selector.

### Select

Two different selectors, for two different mechanisms:

| Goal | Selector |
|---|---|
| Bundled browser, copied profile (**loses macOS logins**) | `agent-browser --profile "Profile 21" open <url>` |
| The user's own browser via Panerelay | *no flag* — the profile is whichever one has the extension installed |

With Panerelay there is no per-command profile switch: **the profile is
selected by where you installed the extension.** To automate a different
profile, install the extension in that profile too. To *stop* automating
one, remove the extension from it.

Profile names with spaces must be quoted. Launch flags (`--profile`,
`--headed`, `--cdp`) are daemon-**launch** options — they are ignored with
only a warning if a daemon is already running. Run `agent-browser close
--all` first when the flag matters.

## Verify the connection

Run the bundled check — no network, no npx:

```bash
bash scripts/check-panerelay.sh
```

Emits `key=value` lines and, on failure, a single `NEXT=` action:

```
AGENT_BROWSER=0.33.2
VERSION_OK=yes
PLUGIN=registered
GLOBAL_DEFAULT=no
NATIVE_HOST=/Users/me/.panerelay/bin/panerelay-native-host.cjs
EXTENSION=connected
TABS=2
READY=yes
```

Add `--deep` to also run `@panerelay/setup doctor` (needs npx + network).

### Prove which browser you are actually driving

The decisive test, because both paths otherwise look identical. The real
browser reports its own version; the bundled one reports `HeadlessChrome`
at whatever version `agent-browser` ships:

```bash
agent-browser --session panerelay-task --provider panerelay eval "navigator.userAgent"
#  "…Chrome/150.0.0.0 Safari/537.36"          ← the user's real browser

agent-browser eval "navigator.userAgent"
#  "…HeadlessChrome/149.0.0.0 Safari/537.36"  ← bundled Chrome for Testing
```

If both report `HeadlessChrome`, the `--provider panerelay` flag did not
take effect — re-check `PLUGIN=registered`.

## Use it

Every command takes the same flags; only the transport differs:

```bash
agent-browser --session panerelay-task --provider panerelay tab list
agent-browser --session panerelay-task --provider panerelay open https://internal.example.com
agent-browser --session panerelay-task --provider panerelay snapshot -i
```

Use a stable `--session` name so the browser attachment persists across
commands.

## Picking a browser when several are registered

The extension registers **once per running browser process**. With more than
one registered and ready, the plugin refuses to guess and fails the call.
Select explicitly:

```bash
PANERELAY_BROWSER_ID=6f3f7c23-8ad1-4764-8045-e5d6ce4b08f4 \
  agent-browser --session panerelay-task --provider panerelay tab list
```

Get the candidate IDs from `check-panerelay.sh`, which prints one
`BROWSER_ID=` line per registration. There is no way to tell them apart by
ID alone — try each; the right one lists your real tabs. The others
typically show only `about:blank` (an empty window) or fail with
`CDP error (Target.createTarget): No current window` (a registration whose
window is gone). Alternatively set a default in the side panel.

> **The error you will actually see is useless.** `agent-browser` collapses
> every plugin failure to `✗ Plugin 'panerelay' returned success=false` and
> discards the plugin's message. Recover the real one by speaking the
> protocol to the native host directly:
>
> ```bash
> echo '{"protocol":"agent-browser.plugin.v1","type":"browser.launch","capability":"browser.provider","request":{"sessionName":"probe"}}' \
>   | node ~/.panerelay/bin/panerelay-native-host.cjs --agent-browser-plugin
> ```
>
> `check-panerelay.sh` does this automatically on probe failure.

Note that `@panerelay/setup doctor` reports this state as a healthy
✅ `Extension — Connected through 3 browser processes`. Connected is not the
same as unambiguous: doctor can pass while every `--provider panerelay`
call fails.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Plugin 'panerelay' returned success=false` (no detail) | Generic wrapper for any plugin error. Query the native host directly (above) or run `check-panerelay.sh` to get the real message. Most often multiple ready browsers. |
| `Multiple Panerelay browsers are ready` | Several browser processes carry the extension. Set `PANERELAY_BROWSER_ID` — see the section above. |
| Still fails right after fixing the real cause | The session daemon **sticks to the browser it first resolved**. Re-run under a fresh `--session` name. Do **not** use `close --all` to clear it — it is not session-scoped and closes every session, including unrelated ones. |
| `CDP error (Target.createTarget): No current window` | That `PANERELAY_BROWSER_ID` names a registration whose window has closed. Pick another. |
| `Creating a new tab requires all-tabs authorization` | Panerelay defaults to **per-tab** consent. Open the side panel and authorize all tabs, or drive an already-authorized tab. Safe to grant inside a dedicated profile. |
| `Extension is not currently connected` | Extension not installed in the profile, or its side panel was never opened. Open the panel. |
| `--provider` rejected / unknown | CLI older than 0.33.0. `--provider <plugin name>` support is required. |
| Commands hit the wrong browser | The `--provider panerelay` flag was dropped. Confirm with the userAgent test above. |
| Works in one profile, not another | Expected — the extension is per-profile. Install it where you need it. |

## Rollback

```bash
npx --yes @panerelay/setup uninstall
```

Removes the native host and the plugin registration. Then remove the
extension from the browser profile, and delete the dedicated profile
directory if one was created for this.

## Related

- Default bundled-browser workflow: [`web.md`](web.md)
- Electron apps: [`electron.md`](electron.md)
- Connectivity test: [`../scripts/check-panerelay.sh`](../scripts/check-panerelay.sh)
