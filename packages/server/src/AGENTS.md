# DOX — packages/server/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `browse.ts` | Directory-browse logic: `listDirectories` (readdir + tiered rank filter, cap 200, opt-in `.git`/`.pi` flag… → see `browse.ts.AGENTS.md` |
| `cli.ts` | `pi-dashboard` CLI entry. Exports `parseArgs` (subcommand + flags), `buildConfig` (CLI+env+file merge →… → see `cli.ts.AGENTS.md` |
| `commit-draft-relay.ts` | Correlates `POST /api/git/commit-draft` → bridge `git_commit_draft_result`. → see `commit-draft-relay.ts.AGENTS.md` |
| `config-api.ts` | Config REST helpers: `readConfigRedacted` (redacts `auth.secret`/`providers[].clientSecret` + tunnel provider… → see `config-api.ts.AGENTS.md` |
| `directory-service.ts` | Server-side directory-scoped ops. Exports `createDirectoryService`, `DirectoryService` interface,… → see `directory-service.ts.AGENTS.md` |
| `event-wiring.ts` | Wires pi-gateway events → browser-gateway + session manager. Exports `wireEvents`, `EventWiringDeps`. → see `event-wiring.ts.AGENTS.md` |
| `file-watch-manager.ts` | Narrow open-files watch. `setWatched(ws,sessionId,cwd,relPaths,onChange)` reconciles per (ws,session,path); `clearConnection(ws)` on disconnect, no fd leak. See change: split-editor-workspace. |
| `fix-pty-permissions.ts` | Runtime fix for node-pty spawn-helper exec bit. Exports `fixPtyPermissions` (no-op on Windows / already… → see `fix-pty-permissions.ts.AGENTS.md` |
| `home-lock.js` | Compiled JS of `home-lock.ts`. Per-HOME advisory lock ensuring one dashboard instance per… → see `home-lock.js.AGENTS.md` |
| `plugin-intent-cache.ts` | Server-side cache of most recent plugin intent per `(pluginId, sessionId, slot)`. → see `plugin-intent-cache.ts.AGENTS.md` |
| `resolve-path.ts` | Exports `safeRealpathSync(p)` — `fs.realpathSync` with original-path fallback on error. |
| `ripgrep-detection.ts` | One-time `rg` detection via ToolResolver. `detectRipgrep`/`resetRipgrepCache`. See change: split-editor-workspace. |
| `server.ts` | Dashboard HTTP + WebSocket server. Exports `ServerConfig`, `DashboardServer`, `createServer(config)`. → see `server.ts.AGENTS.md` |
| `system-open-capability.ts` | System file-open capability: `systemOpenCapability`, `buildOpenCommand`/`buildRevealCommand`/`runOpener` (`OpenerCommand`) — platform reveal/open shell-out for the `/view` system-open path. See change: open-view-command-in-editor-pane. |
