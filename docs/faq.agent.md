# faq.md — index

Pull-only condensed map. Source: docs/faq.md. Question → key answer.

## Preview & build
- Preview PDF/video/AsciiDoc/YouTube — type `/view <target>` in composer. `/view @docs/spec.pdf` renders `<PreviewCard>` inline.
- Build Windows electron zip — Docker cross-build `.zip` only. `./packages/electron/scripts/build-installer.sh --windows` (`--arch arm64`).
  - Zip only (no Docker) — `electron-forge package --platform win32 --arch x64` then zip.

## Install
- Three install ways — A Electron desktop app (no prereqs, bundles Node), B pi package, C source dev.
- Install as pi package — Path B: `pi install npm:@blackbelt-technology/pi-agent-dashboard`.
- Install without Electron — direct npm; pi/openspec/tsx as regular npm deps.
- Install from source (dev) — Path C: clone, npm install, register pi package.
- Prerequisites — required for B+C only; A bundles everything.
- Start server manually — run `cli.ts` via `tsx`, foreground.
- Run as daemon — `pi-dashboard` CLI, background.
- Check daemon status — CLI subcommand or `/api/health`.
- Auto-start flow — bridge TCP-probes `piPort` each session start; spawns server detached when closed and `autoStart:true`.
- Retry server launch from Electron — `ensureServer()` fails → loading page "Cannot connect", exposes retry.
- Electron "Cannot connect" after fresh boot, banner-only server.log — `launchDashboardServer` fell back to `process.execPath` (Electron GUI). Fixed `fix-electron-server-launch-node-bin` via `pickNodeForServer()`.
- Tray "Server managed externally" — server on port not owned by this Electron. Ownership from `/api/health.launchSourceEffective` + `storedSpawnedPid`, `decideOwnership()`.
- Electron native-surface flows tested — Playwright-Electron `tests/e2e-electron/` launches real packaged app via `_electron`.

## Config
- Configure dashboard — edit `~/.pi/dashboard/config.json` or gear icon. Precedence CLI→env→file→defaults.
- Config file location — `~/.pi/dashboard/config.json`, auto-created.
- Expose on LAN — native binds `127.0.0.1`; set bind host (restart required).
- Pairing ≠ LAN access — plain-LAN = Network Guard/`bindHost`+trusted networks. QR pairing needs secure context (`crypto.subtle` Ed25519 undefined on plain-http non-localhost).
- Same PWA name on launcher — `/manifest.json` dynamic per request. Name `Pi-Dash · <source>`.
- OAuth for external access — add `auth.providers` block; localhost unguarded, external must auth.
- OAuth providers supported — `github`,`google`,`keycloak`,`oidc` (generic OIDC `issuerUrl`).
- zrok tunnel persistent URL — UI "Gateway", internal `tunnel`. `tunnel.provider:"zrok"`, enrol token, `tunnel.enabled:true`.
- Gateway providers — 4 behind `TunnelProvider` seam. Child (zrok/ngrok) vs Daemon (tailscale/zerotier). `tunnel.provider`+`tunnel.mode`.
- Add own HTTPS endpoint — Gateway UI "Add HTTPS URL" → `pairing.publicBaseUrls` via `PUT /api/config`. https/wss only.
- Link QR vs pairing QR — Pairing QR secure `{v,id,code,urls[]}` TLS-only; Link QR for no-TLS mesh/lan. Governed by `config.trustedNetworks`.
- zrok Bad Gateway + auto-recovery — long-lived `zrok share` stales on edge. Watchdog (default on) probes `/api/health` every 60s.
- Customize tool paths — edit `~/.pi/dashboard/tool-overrides.json` or Settings→General→Tools.
- Switch headless/tmux spawning — `"spawnStrategy":"tmux"|"headless"` in config.

## Development
- Typical dev workflow — 3 terminals: server `--dev`, Vite, pi with bridge.
- Set up dev environment — clone, install, register bridge extension.
- Build Electron app — see `docs/electron-build-methods.md`. Single command for current platform.
- Build Electron multi-platform — Docker cross-compile from macOS/Linux.
- Generate native icons — single npm script from master PNG.

## Release & publishing
- Cut new release — `npm version` + tag push fires `publish.yml`.
- Why didn't I get an update — 4 historical modes fixed by `fix-electron-auto-update-pipeline` (drafts excluded from /releases/latest → prod tags publish automatically).
- Installer for feature branch without release — CI dispatch workflow, no tag.
- Why PR didn't run install smoke matrix — `gate-publish-on-smoke-and-tests` removed smoke from push/PR. PR runs only `ci` (lint+test+build, Node 22, ~3min).
- npm Trusted Publishers setup — OIDC token exchange replaces `NPM_TOKEN`, per-package one-time on npmjs.com.
- Lockstep versioning — every workspace `package.json` same version. `scripts/sync-versions.js` exits 1 on drift.
- Must manually publish new plugin's first version — Trusted Publisher OIDC needs ≥1 published version.
- Seed new plugin 0.0.1 or lockstep — both valid, invariant preserved.
- Prepare plugin package.json for publish — remove `private`, add `publishConfig`+`license`, declare workspace deps.
- Add plugin to publish workflow — edit `publish.yml`, append to `PACKAGES=(...)` bash array.
- Configure Trusted Publisher for new plugin — one-time per-package after first publish.
- Plugin dependencies vs monorepo hoist — npm consumers don't hoist; plugin must declare every `@blackbelt-technology/*` import.
- Dry-run publish — `npm publish --dry-run`.
- SemVer rules — feature→minor, fix→patch, breaking→major.
- CHANGELOG format — end-user language, bullets under `## [Unreleased]` Added/Changed/Fixed.
- sync-versions.js — rewrites inter-package dep specifiers on version bump (`npm version` doesn't).
- Manually fix failed GitHub Release — edit draft before publishing.
- Rollback a release — delete tag local+remote, revert bump commit, re-push.

## Components & internals
- What bridge extension does — global pi extension, every session, forwards events, relays commands. WS port 9999.
- Three main components — bridge extension + server + web client, two WS gateways. Shared types `packages/shared/src/`.
- Event flow pi→browser — 5 steps: pi event → bridge → server buffer → broadcast → React.
- PromptBus routing — unified prompt-routing in bridge; `ctx.ui.*` fan out to adapters, first-response wins.
- Typing during agent turn — message queues; bridge `PromptQueue` per session; `QueuePanel.tsx`.
- Unread state machine — `Session.unread:boolean`; flips on attention event while unviewed; `isUnreadTrigger()`.
- Extension UI system (management-modal + decorators) — pull-based data-declared UIs, no React/SDK. Phase1+Phase2.
- Plugin architecture + slot system — two-tier: first-party plugins (React `packages/<name>-plugin/`) + third-party descriptor-only.
- Add new session-card subcard — mirror MEMORY/FLOWS, 5 edits. Start `slot-types.ts` `SlotId`.
- Detect + spawn session types — two-tier: user config → platform availability → single pure selector.
- CLI session shows headless robot icon — stale `source:"dashboard"` in sidecar. Fix `dashboard-source-decision.ts` (`fix-dashboard-spawn-correlation-by-token`).

## Windows
- Install on Windows (Setup.exe) — Path 1, download Setup.exe/.zip from Releases.
- Setup.exe vs .zip — Setup.exe per-user NSIS installer; .zip extract-and-run.
- Offline/air-gapped Windows — Release builds ship npm cacache `resources/offline-packages/`.
- Windows-specific prerequisites — Path 2 only. Avoid nvm-windows with non-ASCII username.
- /ctx-stats works some sessions not others — Pi 0.74 ExtensionAPI no `dispatchCommand`; bridge can't reach `session.prompt`.
- Resume fail "RPC keeper exited within crash window (code 1)" — keeper inherits Electron PATH missing `Resources/server/node_modules/.bin/`; bare `spawn("pi")`.
- Session stuck after Stop/Shutdown — pre-fix `killBySessionId` SIGTERM only; hung pi ignored. Restart clears.
- Gemini starts, never responds, no error — "Gemini doesn't work with subagents". NOT auth.
- Windows spawn fails 'spawn npm ENOENT' — old build before `29af651`; Windows npm is npm.cmd, spawn needs `.cmd`.
- Enable long paths Windows — `LongPathsEnabled` reg + `git config core.longpaths true` (260-char limit).
- Install from tarballs (Path 2) — advanced, install all 4 tarballs in one command.
- Key Windows directory paths — config/logs/sessions/tool overrides reference.
- Troubleshoot 'Windows pi spawn requires node.exe' — found pi.cmd not `dist/index.js`. Rescan/override/restart.
- Upgrade on Windows — preserves config+sessions both paths.
- Fix white screen on VMs — VMware GPU no accel; auto-detect VM disable GPU. `main.ts::detectVM()`.
- Doctor diagnostic in Electron — menu→Doctor, 12 checks, launch test.
- server.log 0 bytes after clean launch — pre-fix `spawnDetached` routed only stderr to logFd.
- Bundling server differs from npm install — npm pkg unavailable at release; bundle source+deps, wizard installs only pi/openspec/tsx.
- Native modules fail bundled cross-platform — `node-pty` platform prebuilds; two-phase bundling.
- `__dirname` undefined in packaged Electron — Vite ESM bundle; use `fileURLToPath(import.meta.url)`.
- Ensure bridge extension loads packaged — not bundled by default; bundle+auto-register into pi package list.
- Headless spawns fail Windows 'command not found' — `.cmd` needs `shell:true`; quote paths with spaces.
- Vite config for Electron main+preload — two configs, externalize all Node builtins.
- Electron doesn't find pi/openspec — GUI minimal PATH; login shell fallback `$SHELL -lc "which"`.
- Update Node versions (nvm/fnm) — persisted paths stale; server re-detects on start.
- Tool paths persisted across restarts — `config.json#toolPaths` pi/openspec/node/tsx/bridge/serverCli.
- tmux sessions fail to find tools — tmux inherits launcher env; server prepends PATH via shell export.
- AppImage affects tool paths — mounts temp `/tmp/.mount_PIxxxxxx/`, changes each launch; don't persist serverCli/bridge.
- Standalone vs power-user mode — standalone bundles+prefers app copies; power-user prefers system.
- Bridge resolves server CLI entry — Chain 2 TUI uses `process.execPath` + relative from extension dir.
- `where npm` returns nothing on Windows — bundled Node lacked npm.cmd/npx.cmd shims pre-`embed-managed-node-runtime`.

## Misc troubleshooting
- See why session spawn failed — banner in folder card (code/hint/preflight/stderr). Settings→General→Recent Spawn Failures.
- Old `~/.pi-dashboard/` after upgrade — left untouched. `detectLegacyManagedDir({homedir})` (`legacy-managed-dir.ts`).
- `pi-dashboard start` ERR_MODULE_NOT_FOUND in dev checkout — .bin pointed at cli.ts (no TS loader). Fix: `packages/server/bin/pi-dashboard.mjs` resolves jiti.
- `/api/flows-anthropic-bridge/status` "no sessions reporting" — pi reads `packages[]` not `dashboardPluginBridges`. 0.5.4+ dual-writes; `reconcilePluginBridgePackages`.
- Abort slow on parallel flows — pi-flows <0.2.x `Promise.all` didn't race AbortSignal. Fixed 0.2.0+ `raceWithAbort`.
- Hide reasoning/token bar/tool output — Settings▸General▸Chat display. Per-session ⚙ View popover.
- Roles UI — Settings→General→Roles (moved from model dropdown 0.5.4). `packages/roles-plugin/`.
- Doctor shows server "Not running" while dashboard works — old `probeServer` `execSync curl` self-request.
- /ctx-stats /ctx-doctor green "completed" pill only — extensions branch `ctx.hasUI`; rpc had hasUI false. Fix flips `ctx.hasUI=true` after patch.
- openspec-archive scans `find /` in worktree — agent improvisation; worktree lacks `.pi/skills/openspec-*/`.
- +Worktree dialog does nothing for sibling worktrees — fresh worktree lacks node_modules; bridge TS path unresolved. Dashboard-repo-only.
- Change OpenSpec workflow profile — Settings→Advanced→OpenSpec Workflow Profile. Writes `~/.config/openspec/config.json` global.

## Install tool (bash/git/gh/node/zrok)
- Install bash — runs `!`/`!!` shell commands. macOS pre-installed /bin/bash.
- Install git — reads branch/worktree, clones. macOS Xcode CLT `xcode-select --install`.
- Install gh — worktree `pr` action calls gh.
- Install node — spawns pi + build scripts; npx ships with node.
- Install zrok — opens persistent public tunnel.

## Windows git/worktree extras
- Electron "Bundled server already present" but changes absent — content-freshness gate (`fix-stale-bundled-server-cache`).
- Switch bundled/host git on Windows — Settings→general "Git & Bash source" Auto/Host/Bundled. New sessions only.
- Windows installer includes git copy — Windows lacks system git+bash; embeds dugite-native (git 2.53.0+sh) ~110MB. macOS/Linux unchanged.
- Auto-initialize worktrees on spawn — Settings→Sessions "Initialize on worktree" (default off). Trusted `worktreeInit` hook.
- Local macOS DMG old `macos-alias`/`volume.node` error gone — obsolete since `fix-local-electron-dmg-build`; built by electron-builder dmg.
- Feedback during worktree init — status chip `⚙ Initializing… · {elapsed}` + progress bar (`friendlier-worktree-init`).

## Runtime problems & quirks
- `openspec change new` fails "unknown command" — order is `openspec new change <name>`, then `openspec validate`.
- Automation run stuck "running", no result.md — correlate run→session by `automationRun.runId` stamp, not cwd-FIFO.
- Unrelated files leak into commit (shared worktree) — `git reset && git add <files> && git commit` atomically in ONE Bash call.
- `npx vitest run` aborts "[test-isolation] HOME equals real user home" — run `HOME=$(mktemp -d) npx vitest run`.
- `npx playwright install chromium` times out — pin @playwright/test to version whose chromium+headless_shell revision already cached.
- Folder routes break on Unicode cwd — btoa/atob throw; use TextEncoder/TextDecoder in folder-encoding.ts (+ mirrored automation-plugin copy).
- openspec-* skills missing in worktree, apply stalls — init gated on `test ! -d node_modules`; fix `npx openspec init --tools pi --force`.
- agent-browser MCP `eval` echoes JS source — use agent-browser CLI directly, dump output to file, read it.
- jsdom can't render mermaid (CSSStyleSheet not defined) — use real browser (agent-browser mockup server) harness.
- pi session "stuck in thinking" / only "memory savings" — not dashboard bug; set flushOnCompact/flushOnShutdown/reviewEnabled:false in `~/.pi/agent/hermes-memory-config.json`.
