# pi-dashboard — Claude plugin

Lets Claude Code on your own machine start the local
[pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard) and then
list, prompt, abort and spawn pi sessions through the dashboard's REST API, and get notified
when a pi session asks a question or changes status. The plugin is three skills and two shell
scripts. It has no server, no MCP server and no hooks.

## Install

In Claude Code:

```
/plugin marketplace add BlackBeltTechnology/pi-agent-dashboard --sparse .claude-plugin packages/claude-plugin
/plugin install pi-dashboard@pi-agent-dashboard
```

In claude.ai, Customize > Plugins: add the marketplace `BlackBeltTechnology/pi-agent-dashboard`,
or upload `pi-dashboard-claude-plugin-<version>.zip` from the latest GitHub Release.

## Install with a prompt

Paste this into Claude Code (CLI or the desktop Code tab). Claude installs the plugin with the
`claude plugin` CLI from its shell. It does not work in Chat or Cowork, which have no shell on your
machine; upload the zip there instead.

~~~~markdown
Install the `pi-dashboard` Claude Code plugin for me, at user scope. Use your shell
for each step, show me the output, and stop to tell me if a step fails.

1. Check the Claude Code version: `claude --version`. If it is older than 2.1.300,
   tell me and ask if you should run `npm i -g @anthropic-ai/claude-code@latest`
   before going on. Older versions may reject the marketplace manifest.

2. Add the marketplace (a sparse checkout of the GitHub repo):
   `claude plugin marketplace add BlackBeltTechnology/pi-agent-dashboard --sparse .claude-plugin packages/claude-plugin`
   If it says the marketplace already exists, run
   `claude plugin marketplace update pi-agent-dashboard` instead.

3. Install the plugin:
   `claude plugin install pi-dashboard@pi-agent-dashboard --scope user`

4. Check the install: `claude plugin list`. `pi-dashboard` must be listed and enabled.

5. Fallback, only if step 2 or 3 fails (for example `Unrecognized key` in the
   manifest): download the release zip and load it for one session only.
   ```
   mkdir -p ~/.claude/local-plugins/pi-dashboard
   gh release download --repo BlackBeltTechnology/pi-agent-dashboard \
     -p 'pi-dashboard-claude-plugin-*.zip' -D /tmp --clobber
   unzip -o /tmp/pi-dashboard-claude-plugin-*.zip -d ~/.claude/local-plugins/pi-dashboard
   ```
   Then tell me to start Claude with
   `claude --plugin-dir ~/.claude/local-plugins/pi-dashboard`.

Rules:
- Do not install the pi-dashboard server or app itself. The plugin's
  `pi-dashboard-bootstrap` skill asks me about that later.
- Do not create, print or store any tokens.
- When done, tell me to restart Claude Code. Then I can try:
  "Check the pi dashboard and list my sessions."
~~~~

## What it does

| Skill | Purpose |
|---|---|
| `pi-dashboard-bootstrap` | Runs `ensure-dashboard.sh` once, in the foreground. It reports whether the dashboard is up, starts it detached when it is down, and prints the `BASE` URL. It never starts a second instance. |
| `pi-dashboard-control` | Drives the running dashboard with curl against `BASE`: health, sessions, prompt, abort, spawn. |
| `pi-dashboard-watch` | Follows `GET BASE/api/events/stream` with `watch-events.sh`, run under Claude Code's Monitor tool: one notification per question opened or closed, status change, or session added or removed. |

If no `pi-dashboard` command or app is installed, Claude asks before running a one-time global
install of the latest release (about 1 GB, about a minute; it adds the `pi-dashboard` command and
the pi bridge). Decline it when the session runs in Cowork or on the web.

## Where it works

| Surface | Result |
|---|---|
| Claude Code CLI, desktop Code tab | Full: the shell runs on your machine |
| Cowork (cloud) | Skills load, but the shell runs in Anthropic's sandbox. The script answers `sandbox` |
| claude.ai chat | Skills load; there is no shell |

## Data and credentials

Everything stays on localhost. The plugin never creates, stores or prints credentials. When the
dashboard demands a token (strict mode), Claude asks you to run
`pi-dashboard token create --label claude-code --tier control`.

## Files

`.claude-plugin/plugin.json` is stamped with the repository version at release time.
`skills/pi-dashboard-control/references/api-reference.md` is derived from the extension's
reference by `node scripts/sync-claude-plugin.mjs`; do not edit it by hand.
