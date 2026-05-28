---
name: browser
description: >
  Browser automation via the `agent-browser` CLI. Use when the user needs to
  interact with websites or Electron desktop apps — navigating pages, filling
  forms, clicking buttons, taking screenshots, extracting data, testing web
  apps, automating browser actions, visual UI verification, responsive checks,
  hunting console errors, or driving the Pi Dashboard's Electron shell (main
  window, wizard window, doctor window, tray, native menus). Triggers include
  "open a website", "fill out a form", "click a button", "take a screenshot",
  "scrape data", "test this web app", "automate browser", "test responsive",
  "debug blank page", "automate Slack app", "control VS Code", "attach to
  Electron app", "screenshot Pi Dashboard", "drive the wizard window".
license: Apache-2.0
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
metadata:
  author: pi-dashboard
  version: "1.0"
  vendoredFrom: agent-browser
  vendoredVersion: "0.27.0"
---

# browser

Composite skill that gives the agent eyes and hands for any browser-driven
task — web pages or Electron desktop apps — via the `agent-browser` CLI.

Two recipes:

- **Web automation** — generic web pages plus Pi Dashboard-specific helpers
  (dashboard URL detection, responsive testing, console-error hunting).
  Reference: [`references/web.md`](references/web.md).
- **Electron automation** — drive any Chromium-based Electron app, including
  a worked example for the Pi Dashboard's own shell via `--debug-cdp`.
  Reference: [`references/electron.md`](references/electron.md).

## Step 0a — Preflight: `agent-browser` CLI must be installed

The skill does **not** bundle the CLI. Before doing anything else, verify it:

```bash
command -v agent-browser
```

If the command is **not** found, halt and tell the user:

> The `agent-browser` CLI is not installed. Install it as a pi extension so
> the `browser` tool is registered in your pi session too:
>
> ```
> pi install npm:pi-agent-browser
> ```
>
> Then re-invoke the skill.

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

## Step 1 — Read the matched recipe and execute

Read the reference file selected above, then follow its workflow. Both
references are self-contained; you do not need to read both.

## Notes

- **Vendoring**: `references/web.md` and `references/electron.md` are
  snapshots of upstream `agent-browser` skill content (`core` and
  `electron`) at CLI version 0.27.0. See [`UPSTREAM.md`](UPSTREAM.md) for
  refresh procedure and [`LICENSE`](LICENSE) for upstream attribution.
- **No CLI bundled**: agents installing the bridge extension get the
  skill text but not the CLI; install on demand per Step 0a.
- **User-local override**: if the user's project has its own
  `.pi/skills/browser/` skill, pi's local-wins precedence applies and
  this skill is shadowed — that's by design.
