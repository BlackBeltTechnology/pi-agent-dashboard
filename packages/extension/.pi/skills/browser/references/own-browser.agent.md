# own-browser.md — own logged-in browser index

Pull-only condensed map. Source: packages/extension/.pi/skills/browser/references/own-browser.md. Recipe: drive user's real browser (cookies, SSO, extensions) via Panerelay MV3 extension + native-messaging host. Not vendored; see `../UPSTREAM.md`.

Legacy path: prefer Pi Dashboard browser relay `dashboard-relay.md` when pi runs on dashboard host. Use this only when agent cannot reach loopback dashboard.

## When to use
- Target behind login agent cannot perform: SSO/2FA, internal tools, existing Gmail/Slack/Jira session.
- Not for ordinary automation → default bundled browser `references/web.md`.

## Dead ends (do not retry)
- `--remote-debugging-port` / `--cdp <port>`: Chrome M136+ refuses on real profile (Safe Storage HMAC).
- `--auto-connect`: needs `DevToolsActivePort`; absent in normal sessions.
- `--profile Default`: temp copy; macOS Keychain cookies undecryptable → logged out. Upstream vercel-labs/agent-browser#1319.

## Trade-off
- Extension path loses CDP: no `network route`, no isolated worlds, no `trace`/`profiler`. Need those → bundled browser.

## Strategy table
- No login → `references/web.md`.
- Agent-performable login → `auth save` + `auth login`, or `--session-name`.
- Auth replay headless → `state save` / `--state <path>`.
- Live SSO/2FA/user session → Panerelay.

## Setup
- Require `agent-browser >= 0.33.0` (`--provider <plugin name>`). Check: `agent-browser --version`.
- Consent gate: do NOT run installer autonomously (Step 0a of `../SKILL.md`). Diagnostics `doctor`, `check-panerelay.sh` read-only, safe.
- Install command for user: `npx --yes @panerelay/setup --agent-browser` (omit `--global-default`). Writes native host, registers `panerelay` in `~/.agent-browser/config.json`.
- User steps: install extension from Web Store; open side panel (connection registers on open). Agent cannot do this.
- Dedicated profile recommended: `--profile-directory="AgentAutomation"`. macOS path `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Linux `google-chrome`; Windows `chrome.exe`.
- Extension perms: `debugger`, `nativeMessaging`, `scripting`. Install only in that profile.
- Check `npm view @panerelay/setup` + repo age/stars before recommending; say dependency is new.
- Containment check: native-host manifest `allowed_origins` = exactly one `chrome-extension://<id>/`.
- Manifest dirs: macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; Linux `~/.config/google-chrome/NativeMessagingHosts/`; Windows `HKCU\Software\Google\Chrome\NativeMessagingHosts\`.
- Linux/Windows paths unverified (verified macOS). Confirm: `npx --yes @panerelay/setup doctor`.

## Profiles
- List: `agent-browser profiles` (left col = profile dir; label not valid selector).
- Bundled copied profile: `agent-browser --profile "Profile 21" open <url>` (loses macOS logins).
- Panerelay: no per-command profile flag; profile = where extension installed.
- Launch flags (`--profile`, `--headed`, `--cdp`) ignored if daemon running → `agent-browser close --all` first.

## Verify
- `bash scripts/check-panerelay.sh` → `key=value`: `AGENT_BROWSER`, `VERSION_OK`, `PLUGIN=registered`, `GLOBAL_DEFAULT`, `NATIVE_HOST`, `EXTENSION=connected`, `TABS`, `READY`; failure emits `NEXT=`.
- `--deep` adds `@panerelay/setup doctor` (npx + network).
- Identity test: `agent-browser --session panerelay-task --provider panerelay eval "navigator.userAgent"` → real Chrome version; bundled → `HeadlessChrome`. Both HeadlessChrome → `PLUGIN=registered` check.

## Use
- `agent-browser --session panerelay-task --provider panerelay <tab list|open <url>|snapshot -i>`. Stable `--session` name keeps attachment.

## Multiple browsers
- Extension registers per browser process. Multiple ready → call fails.
- Select: `PANERELAY_BROWSER_ID=<id> agent-browser --session ... --provider panerelay tab list`. IDs from `check-panerelay.sh` (`BROWSER_ID=` lines). Try each; real one lists tabs.
- Wrong ones: `about:blank` only, or `CDP error (Target.createTarget): No current window`.
- Alt: default set in side panel.
- Error `Plugin 'panerelay' returned success=false` hides real message. Probe native host directly: `echo '{"protocol":"agent-browser.plugin.v1","type":"browser.launch","capability":"browser.provider","request":{"sessionName":"probe"}}' | node ~/.panerelay/bin/panerelay-native-host.cjs --agent-browser-plugin`.
- `@panerelay/setup doctor` shows ✅ connected even when provider calls fail.

## Troubleshooting
- `Multiple Panerelay browsers are ready` → set `PANERELAY_BROWSER_ID`.
- Still fails after fix → daemon sticks to first browser; retry under fresh `--session`. Do NOT `close --all` (closes unrelated sessions). Challenge → `challenge.md`.
- `No current window` → `PANERELAY_BROWSER_ID` window closed; pick another.
- `Creating a new tab requires all-tabs authorization` → side panel: authorize all tabs (per-tab default).
- `Extension is not currently connected` → install in profile / open side panel.
- `--provider` rejected → CLI < 0.33.0.
- Wrong browser → `--provider panerelay` dropped; run userAgent test.
- Works in one profile only → expected; extension per-profile.

## Rollback
- `npx --yes @panerelay/setup uninstall`; then remove extension and delete dedicated profile dir.

## Related
- `web.md` (default browser), `electron.md`, `../scripts/check-panerelay.sh`.
