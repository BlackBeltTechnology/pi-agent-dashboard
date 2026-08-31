---
name: browser
description: 'Browser automation via the `agent-browser` CLI. Use when the user needs to drive websites or Electron desktop apps — navigating, filling forms, clicking, screenshots, extracting data, testing web apps, visual UI checks, the Pi Dashboard''s Electron shell, or the user''s own logged-in browser (SSO/2FA sites). Triggers: "open a website", "take a screenshot", "test this web app", "use my own browser".'
license: Apache-2.0
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(npx @panerelay/setup:*)
metadata:
  author: pi-dashboard
  version: "1.1"
  vendoredFrom: agent-browser
  vendoredVersion: "0.27.0"
  verifiedAgainstCli: "0.33.2"
---

# browser

Composite skill that gives the agent eyes and hands for any browser-driven
task — web pages or Electron desktop apps — via the `agent-browser` CLI.

Three recipes:

- **Web automation** — generic web pages plus Pi Dashboard-specific helpers
  (dashboard URL detection, responsive testing, console-error hunting).
  Reference: [`references/web.md`](references/web.md).
- **Electron automation** — drive any Chromium-based Electron app, including
  a worked example for the Pi Dashboard's own shell via `--debug-cdp`.
  Reference: [`references/electron.md`](references/electron.md).
- **The user's own logged-in browser** — reach SSO/2FA-gated sites using the
  user's real cookies via an extension bridge (Panerelay), plus how to list
  and select Chrome profiles.
  Reference: [`references/own-browser.md`](references/own-browser.md).

## Step 0a — Preflight: `agent-browser` CLI must be installed

The skill does **not** bundle the CLI. Verify it through the dashboard tool
registry — recommend-only, nothing installs without an explicit `--install`:

```bash
pi-dashboard-ensure <extension-package-root>/package.json
```

`<extension-package-root>` is the package that ships this skill — three levels
above this SKILL.md's `.pi/skills/browser/` directory (in a global install:
`$(npm root -g)/@blackbelt-technology/pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard-extension`).
The manifest (`pi.tools`) declares `agent-browser` (resolve) and `chromium`
(pw-browser); the registry answers `present` / `recommended` / `blocked` per
tool.

- `agent-browser: present` → continue to Step 0b.
- `agent-browser: recommended` or `blocked` → halt and tell the user:

  > The `agent-browser` CLI is not installed. Install it as a pi extension so
  > the `browser` tool is registered in your pi session too:
  >
  > ```
  > pi install npm:pi-agent-browser
  > ```
  >
  > Then re-invoke the skill.

- `chromium` missing → mention the registry's Install hint
  (`npx playwright@1.62.1 install chromium`) only when the chosen recipe needs a
  CDP browser; the dropdown on the Settings → Tools row carries it.

Do **not** attempt `npm install`, `pi install`, or any other install command
on the user's behalf — they should make that choice explicitly.

## Step 0b — Auto-detect: route to the right recipe

After the preflight, decide which recipe applies. Run this 2-line probe:

```bash
if command -v lsof >/dev/null 2>&1; then
  CDP_LIVE=$(lsof -ti :9222 >/dev/null 2>&1 && echo yes || echo no)
else
  CDP_LIVE=$(nc -z 127.0.0.1 9222 2>/dev/null && echo yes || echo no)
fi
PD_RUNNING=$(pgrep -f "Pi Dashboard|pi-dashboard" >/dev/null 2>&1 && echo yes || echo no)
echo "CDP_LIVE=$CDP_LIVE PD_RUNNING=$PD_RUNNING"
```

Routing rule:

| `CDP_LIVE` | `PD_RUNNING` | Route to                  | Why                                         |
|------------|--------------|---------------------------|---------------------------------------------|
| yes        | yes          | `references/electron.md`  | Pi Dashboard Electron shell is attachable    |
| no         | yes          | `references/electron.md`  | Pi Dashboard is up but CDP off — `electron.md` shows the `--debug-cdp` launch instruction |
| any        | no           | `references/web.md`       | No Electron target running; default to web   |

**Override**: if the user's request is explicitly about a website (URL,
HTTPS host, "the dashboard at localhost:8000", etc.), route to
`references/web.md` regardless of what's running. Intent wins over capability.

**Override**: if the user's request is explicitly about an Electron app
that isn't Pi Dashboard (Slack, VS Code, Figma, …), route to
`references/electron.md` even when `PD_RUNNING=no` — that recipe covers
launching any Electron app with `--remote-debugging-port`.

**Override (login state)**: if the target needs the user's *existing*
session — "use my browser", "I'm already logged in", SSO/2FA, an internal
tool the agent cannot sign into — route to `references/own-browser.md`
regardless of the probe. The default bundled browser starts logged out and
cannot be made to inherit those logins; `--profile` copies the profile and
still loses macOS Keychain-encrypted cookies. Prefer the bundled browser
whenever login state is irrelevant — it is faster and more capable.

## Step 1 — Read the matched recipe and execute

Read the reference file selected above, then follow its workflow. Both
references are self-contained; you do not need to read both.

## Notes

- **Vendoring**: `references/web.md` and `references/electron.md` are
  snapshots of upstream `agent-browser` skill content (`core` and
  `electron`) at CLI version 0.27.0. See [`UPSTREAM.md`](UPSTREAM.md) for
  refresh procedure and [`LICENSE`](LICENSE) for upstream attribution.
  `references/own-browser.md` is **authored, not vendored** — an upstream
  refresh must not overwrite it.
- **Surfaces share one browser**: the `browser` MCP tool and
  `Bash: agent-browser …` drive the *same* daemon and *same* Chrome, with a
  shared active page. Probing with one mid-task can silently move the page
  out from under the other. Pick one surface per task; use
  `--session <name>` for genuinely isolated browsers.
- **Known wrapper bug**: the MCP tool's `eval` echoes the JS source instead
  of executing it (and mangles regex escapes) — still present with CLI
  0.33.2, so it is a `pi-agent-browser` wrapper defect, not a CLI one. Use
  `Bash: agent-browser eval …` instead.
- **No CLI bundled**: agents installing the bridge extension get the
  skill text but not the CLI; install on demand per Step 0a.
- **User-local override**: if the user's project has its own
  `.pi/skills/browser/` skill, pi's local-wins precedence applies and
  this skill is shadowed — that's by design.
