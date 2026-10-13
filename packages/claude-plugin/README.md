# pi-dashboard — Claude plugin

Lets Claude Code on your own machine start the local
[pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard) and then
list, prompt, abort and spawn pi sessions through the dashboard's REST API. The plugin is
two skills and one shell script. It has no server, no MCP server and no hooks.

## Install

In Claude Code:

```
/plugin marketplace add BlackBeltTechnology/pi-agent-dashboard --sparse .claude-plugin packages/claude-plugin
/plugin install pi-dashboard@pi-agent-dashboard
```

In claude.ai, Customize > Plugins: add the marketplace `BlackBeltTechnology/pi-agent-dashboard`,
or upload `pi-dashboard-claude-plugin-<version>.zip` from the latest GitHub Release.

## What it does

| Skill | Purpose |
|---|---|
| `pi-dashboard-bootstrap` | Runs `ensure-dashboard.sh` once, in the foreground. It reports whether the dashboard is up, starts it detached when it is down, and prints the `BASE` URL. It never starts a second instance. |
| `pi-dashboard-control` | Drives the running dashboard with curl against `BASE`: health, sessions, prompt, abort, spawn. |

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
