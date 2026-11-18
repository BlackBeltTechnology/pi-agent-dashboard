# agent-credential-files.ts — index

Import-free leaf. `PI_AGENT_SECRET_FILES` (`auth.json`, `mcp-auth.json`, `providers.json`, `system-one/auth.json`: credential guard hard-blocks), `PI_AGENT_ASK_READ_FILES` (`models.json`, `mcp.json`), `PI_AGENT_ASK_READ_DIRS` (`sessions`): path gate asks on read. Overlaps server `AGENT_CREDENTIAL_NAMES` (re-pointed at these). See change: harden-agent-tool-guards.
