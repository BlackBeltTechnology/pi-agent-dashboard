# DOX — packages/apple-tools

Files in this directory. One row per source file. See change: add-apple-tools-imcp-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. iMCP (Apple PIM) provisioning for pi via pi-mcp-adapter. macOS-only, no Mail. Install/provision/manual-grant, nine provisioning states. |
| `package.json` | pi-dashboard-plugin manifest. id `apple-tools`, priority 100. `requires: { piExtensions: ["pi-mcp-adapter"], paths: ["${imcpServerPath}"] }`. `configSchema` `./config.schema.json`. Claims `settings-section`→`AppleToolsSettings` (no `tab` — renders under the plugin's own row). `bin` `pi-apple-tools-install`. `pi.skills` `.pi/skills/apple-tools`. Declares `pi-mcp-adapter` as a dep (documentary; NOT bundled, does NOT satisfy the piExtensions probe). No postinstall. |
| `config.schema.json` | JSON Schema 7. `imcpServerPath` only (default canonical `/Applications` location — the key the `paths` requirement interpolates). `directTools`/`disabled` deliberately absent: they are adapter-owned and live on the `mcpServers.iMCP` entry in mcp.json. |
| `vitest.config.ts` | jsdom + react, shared setup-home globalSetup. |
| `tsconfig.json` | Extends tsconfig.base; jsx react-jsx; noEmit. |
| `.pi/skills/apple-tools/SKILL.md` | Agent skill. Seven reachable services; Mail exclusion + redirect to `apple-mail-fast-export`; Messages=iMessage/SMS; load-time `--check`; TCC revocation → menu-bar remediation. |
| `src/detect.ts` | Pure injectable probes: `parseVersion`/`compareVersions`/`meetsMinimum` (numeric, MIN_MACOS 15.3), `candidatePaths`/`discoverServer` (override-as-preference, ordered candidate list). Constants: IMCP_RELATIVE, IMCP_DOWNLOAD_URL, IMCP_BREW_CASK. |
| `src/install.ts` | `runInstaller(env, {check})` — the nine-state provisioning machine (write + write-suppressed check twin). `TerminalState` / `TERMINAL_STATES`, `InstallerEnv`, `InstallResult`. Post-brew re-discovery gate. Pure over injected env. |
| `src/mcp-config.ts` | Merge-only atomic config writers: `ensureMcpEntry` (mcpServers.iMCP.command), `ensureAdapterPackage` (settings.json packages[] append via `sourcesMatch`), `setServerDisabled` + `setDirectTools` + `readImcpEntry` (any mcp.json layer — global `~/.pi/agent/mcp.json` AND project `<cwd>/.pi/mcp.json`, both supported). Disable writes `true` / removes the key on enable; `directTools` removes on empty. Refuses malformed-but-parseable `mcpServers`/`packages` instead of coercing. `ConfigIO` injected. |
| `src/reconcile.ts` | `shouldReconcilePath` — server-side write-back guard (unset/default only, never over an operator override). `DEFAULT_IMCP_PATH`. |
| `src/doctor.ts` | `doctorProbe(env, packagePresent)` — read-only verdict from the shared checker; non-macOS never a remediation item. |
| `src/env.ts` | Real-environment `InstallerEnv` factory. The ONLY module that touches the real OS: `sw_vers`, brew via argv-array execFileSync (shared platform/exec wrapper), atomic writes hardened as `wx` + random temp name (symlink/TOCTOU), mode 0600 (rename carries mode onto the destination), fsync before rename, temp cleanup on failure. `createInstallerEnv`, BREW_TIMEOUT_MS. |
| `src/bin/install.ts` | `pi-apple-tools-install [--check] [--path <p>]` CLI. Writes exactly two files in write mode; never the server plugin store. |
| `src/server/index.ts` | Plugin server entry. `GET /api/apple-tools/status` (read-only, 10s TTL cache; reports state + adapter-owned `disabled`/`directTools` read from mcp.json). `plugin_action` handlers `run-installer` (refuses the brew branch — delegates the long network install to the CLI so the event loop never blocks), `set-disabled` (`scope: "global"\|"project"`; project cwd validated against `host.knownFolderCwds`), `set-direct-tools`. Path reconciliation via `updatePluginConfig` on the action path only. |
| `src/client/index.tsx` | `AppleToolsSettings` settings-section panel. Status readout, Run installer, path override, directTools, server disable toggle; no per-service toggles; non-macOS inert state. |
