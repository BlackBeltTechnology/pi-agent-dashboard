---
name: apple-tools
description: Reach Apple PIM data (Calendar, Contacts, Reminders, Messages, Location, Maps, Weather) from a pi session via iMCP + pi-mcp-adapter on macOS. Use when the user asks to read/search their Apple Calendar, Contacts, Reminders, iMessages, current Location, Maps, or Weather. Does NOT cover Apple Mail — iMCP exposes no Mail service; use apple-mail-fast-export for email.
---

# apple-tools (iMCP)

Access Apple personal-information-management data on **macOS** through
[iMCP](https://github.com/mattt/iMCP), a menu-bar app that brokers the OS
permission grants, reached over MCP by `pi-mcp-adapter`.

## Reachable services (seven)

Calendar · Contacts · Location · Maps · Messages · Reminders · Weather

- **Messages** here means **iMessage / SMS** — it is NOT email.
- There is **no Mail service**. iMCP exposes no Apple Mail access.

## Mail is out of scope — redirect

If the user asks to read, search, or summarize **Apple Mail / email**:

- iMCP exposes **no Mail service**; do not attempt an iMCP/adapter tool call for Mail.
- Use the **`apple-mail-fast-export`** skill instead — it exports `.eml` files
  directly from the on-disk Apple Mail store.

"Messages" satisfying an email request is a category error: Messages is
iMessage/SMS only.

## Access pattern — search then invoke via the adapter

The agent reaches iMCP tools through **`pi-mcp-adapter`**, not by spawning the
server. Do **not** run `imcp-server` directly. Use the adapter's MCP tool
surface (search the available tools, then invoke).

## Provisioning check (run at load)

This skill runs the installer's `--check` traversal on load (one `sw_vers` plus
a few `stat` calls; short-circuits instantly on non-macOS). If iMCP is not
provisioned it reports the gap and names the fix:

```
pi-apple-tools-install
```

Terminal states mirror the CLI and the dashboard panel:
`UNSUPPORTED_PLATFORM`, `OS_VERSION_UNKNOWN`, `OS_TOO_OLD`, `NO_INSTALL_METHOD`,
`INSTALL_FAILED`, `CONFIG_UNPARSEABLE`, `CONFIG_WRITE_FAILED`,
`READY_PENDING_GRANTS`, `READY`.

If the state is anything other than `READY` / `READY_PENDING_GRANTS`, do NOT
attempt Apple-data tool calls — report the gap and the `pi-apple-tools-install`
command first.

## Permission grants are manual and out-of-band

The final step — granting Calendar/Contacts/… permissions — happens in the
**iMCP menu-bar app** and **cannot be automated** (Apple's TCC security model
has no API).

- The load-time check **cannot detect a revoked grant** ahead of a call.
- A permission-class failure at call time means the grant was **revoked or never
  given** → the fix is **menu-bar remediation**, NOT re-running the installer.
  Re-running `pi-apple-tools-install` will not restore a TCC grant.
