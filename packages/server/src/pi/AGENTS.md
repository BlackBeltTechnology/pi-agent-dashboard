# DOX — packages/server/src/pi

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `pi-core-checker.ts` | Discovers installed pi-ecosystem CORE packages (global `npm list -g` + `~/.pi-dashboard/node_modules`… → see `pi-core-checker.ts.AGENTS.md` |
| `pi-core-updater.ts` | Runs `npm install -g <pkg>@latest` (global) or `npm install <pkg>@latest` in `~/.pi-dashboard/` (managed) for… → see `pi-core-updater.ts.AGENTS.md` |
| `pi-dev-version-check.ts` | pi.dev version-check client. Queries `https://pi.dev/api/latest-version`; returns `{version, packageName?}`… → see `pi-dev-version-check.ts.AGENTS.md` |
| `pi-gateway.ts` | WebSocket server for bridge extension connections. Routes `ExtensionToServerMessage` → `SessionManager`;… → see `pi-gateway.ts.AGENTS.md` |
| `pi-resource-activation.ts` | Activation-state bridge to pi's own resolver. Loads pi via ToolRegistry; `resolveActivation(cwd, agentDir)`… → see `pi-resource-activation.ts.AGENTS.md` |
| `pi-resource-scanner.ts` | Discovers extensions, skills, prompts, agents from local `.pi/`, global `~/.pi/agent/`, and installed… → see `pi-resource-scanner.ts.AGENTS.md` |
| `pi-version-skew.ts` | Pi compatibility range reader. `readPiCompatibility` reads `piCompatibility` from… → see `pi-version-skew.ts.AGENTS.md` |
| `resource-activation-toggle.ts` | Writes the pi-standard settings form for a resource's ORIGIN (4 forms; project package delta needs… → see `resource-activation-toggle.ts.AGENTS.md` |
| `resource-entry-ownership.ts` | Machine-local record of the plain settings entries this dashboard wrote, at… → see `resource-entry-ownership.ts.AGENTS.md` |
| `resource-origin.ts` | Origin classification by longest-prefix path match + narrow mirrors of unexported pi semantics… → see `resource-origin.ts.AGENTS.md` |
| `resource-toggle-trust.ts` | Project-trust gate for the resource-activation write. `resolveToggleTrust` → proceed \| refused \| prompt… → see `resource-toggle-trust.ts.AGENTS.md` |
