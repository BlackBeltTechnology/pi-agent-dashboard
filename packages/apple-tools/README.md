# @blackbelt-technology/pi-dashboard-apple-tools

Provision and surface **iMCP** — Apple PIM (Calendar, Contacts, Reminders,
Messages, Location, Maps, Weather) — for a pi session on **macOS**, reached
through [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter).

> **macOS only. No Apple Mail.** iMCP exposes no Mail service; "Messages" is
> iMessage/SMS, not email. For email use the `apple-mail-fast-export` skill.

## What it does

Three moving parts must line up before a single Apple tool call works:

1. **iMCP.app installed** — `brew install --cask mattt/tap/iMCP`
2. **`pi-mcp-adapter` loaded** — an entry in `~/.pi/agent/settings.json` `packages[]`
3. **`mcp.json` entry present** — `mcpServers.iMCP.command` in `~/.pi/agent/mcp.json`
4. **TCC grants** — **manual**, in the iMCP menu-bar app (Apple's security model
   has no API; this step cannot be automated)

Steps 1–3 are automated by this package. Step 4 is a documented manual click.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-apple-tools
```

Installing the package does nothing on its own (no `postinstall`). Provisioning
is **opt-in**:

```bash
pi-apple-tools-install          # provision (writes mcp.json + settings.json)
pi-apple-tools-install --check  # report the state without changing anything
```

## Provisioning states

A closed nine-member enum, identical across the CLI, the dashboard panel, and
the `doctor` probe:

`UNSUPPORTED_PLATFORM` · `OS_VERSION_UNKNOWN` · `OS_TOO_OLD` ·
`NO_INSTALL_METHOD` · `INSTALL_FAILED` · `CONFIG_UNPARSEABLE` ·
`CONFIG_WRITE_FAILED` · `READY_PENDING_GRANTS` · `READY`

`READY_PENDING_GRANTS` means everything is wired but you still need to grant
permissions in the iMCP menu-bar app. Minimum macOS: **15.3**.

## Manual grant step

After `READY_PENDING_GRANTS`, open the **iMCP menu-bar app** and grant each Apple
service you need. Grants can be **revoked out of band** at any time and cannot be
detected ahead of a call — a permission-class failure means **menu-bar
remediation**, not re-running the installer.

## Dashboard panel

The plugin contributes a settings section under its own row in the Plugins tab:
status readout, **Run installer**, `imcp-server` path override, `directTools`
selection, and a server enable/disable toggle (writes a `disabled` override to
the project-local `.pi/mcp.json`). It has **no per-service toggles** — those are
menu-bar only.
