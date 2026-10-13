## Why

Claude users cannot drive pi-dashboard from Claude without manual setup: install the server, start it, then hand-craft a `claude mcp add` snippet. Claude now installs plugins once per account (Customize > Plugins) and syncs them into Claude Code. A skills-only plugin lets a Claude Code session on the user's machine bootstrap the dashboard and orchestrate pi sessions through the existing REST API. No new server code is needed.

Proven pattern: set-copilot (playbook from Tatár Gábor, 2026-10-03) runs a Claude Code session on the operator's machine that starts its own long-running web service through `npx … --detach` and drives it via a skill and a CLI. Its key field lesson applies here: a service started as a background tool call is killed by the harness (observed at 30 min and 2 h). The service must run detached, outside the tool call.

A throwaway spike (2026-10-12, `/tmp/cc-spike`, Claude Code 2.1.140) proved the shape end to end:
- validate passes;
- marketplace add and install work (local scope);
- a natural-language prompt picks the bootstrap skill;
- the server starts detached and survives the Claude process;
- re-running the bootstrap reports the server as already running;
- the simulated Cowork sandbox stops with a clear message.

Evidence and the findings that shaped this proposal are in design.md.

## What Changes

- **New Claude plugin** at `packages/claude-plugin/` (plugin name `pi-dashboard`; not an npm workspace: no `package.json`). It contains `.claude-plugin/plugin.json`, `skills/`, `README.md` and `LICENSE`.
  - **No** `bin/`: Cowork and claude.ai refuse to install a plugin that has one.
  - **No** `.mcp.json` and **no** hooks.
  - **No** `displayName`: Claude Code 2.1.140's validator rejects it, although the claude.com docs list it.
- **Marketplace manifest** at the repo root, `.claude-plugin/marketplace.json` → `./packages/claude-plugin`. Users add `BlackBeltTechnology/pi-agent-dashboard` from Customize > Plugins or with `/plugin marketplace add` (`--sparse .claude-plugin packages/claude-plugin` keeps the checkout small).
- **Bootstrap skill `pi-dashboard-bootstrap`**: a short `SKILL.md` that runs ONE POSIX script, `scripts/ensure-dashboard.sh [--install|--check]`, as a single foreground Bash call with an explicit 600 s tool timeout. Prose steps with shell variables broke in the spike, because every Bash call is a fresh shell. The script is idempotent: a re-run after a killed call reports `already-running`. It writes one `STATUS=` line for every outcome (plus `BASE=` / `INSTALL=`) and has fixed exit codes.
  - **It does not launch while anything holds the port.**
    - **Identity:** `/api/health` 200 with `"ok":true` and a numeric `"pid"` that matches the instance's lock metadata (or `server.pid` when there is none). Credentials are only ever sent to a verified dashboard; `--check` re-verifies in the same command as every credentialed call.
    - Held but silent → `busy`. Recovery mode → `recovery`. Any other answer → `port-conflict`. In all three cases nothing is launched.
    - **It launches only when the port refuses for ≥10 s and no live process is recorded** in the lock metadata or `server.pid`, and no record is unreadable. A recorded live process means the server is starting or restarting, so the script waits for it. This is exactly what keeps the CLI's stale-pid path (see Related changes) from deleting a booting server's `server.pid`.
    - **A dashboard of the same HOME on another port** is found through the lock metadata. It is reported with its own `BASE`, unless the user explicitly asked for a different port via the environment; then the script fails with guidance.
    - **Concurrent bootstraps** serialise on a per-port `mkdir` lock (holder pid; stale only when the holder is dead, or by age via `find -mmin`; never removed recursively), with a re-check after acquiring.
    - It never overrides `HOME`.
  - **Port resolution follows the shared resolver:** `PI_DASHBOARD_PORT` → `DASHBOARD_PORT` → config `port` → 8000. Unusable values (outside 1–65535) are ignored. Every CLI launch passes `--port <resolved>`.
  - **Launch sources, in order:**
    1. the `pi-dashboard` CLI: PATH, then known install directories (npm global prefix, highest nvm version, volta, Homebrew, `/usr/local`), then `$SHELL -lc` (never `-i`), then an existing npx-cache copy (non-durable);
    2. on macOS, the Electron app in the background (`open -g -b com.blackbelt-technology.pi-dashboard`), only when the port comes from config or the default;
    3. **with `--install`, which the agent passes only after the user agrees**: `npm install -g @blackbelt-technology/pi-agent-dashboard@latest`, then the installed CLI's `start`.
       - A stable global install: one copy, a stable pi-bridge path, upgraded by re-running. Later sessions take step 1.
       - A prerelease version (from a mis-tagged `latest`) is refused.
       - On install failure: a hint to configure a user-writable npm prefix (not `sudo`). Then the package is fetched into the npx cache with the override, and started with `npx --yes …@latest start` **without** it. This is reported as `INSTALL=npx-cache` (**non-durable**: it runs from `~/.npm/_npx` and registers the bridge there).
       - No server process ever inherits `npm_config_allow_remote`.
       - Consent is required because the install downloads about 1 GB (measured 2026-10-12: 690 packages, 988 MB, ~58 s cold), needs Node ≥ 22.19 (prebuilt `node-pty`, no compiler), and must never run silently inside a sandbox.
       - Always `@latest`: the `next` dist-tag carries test builds.
  - **Readiness wait** bounded at 60 s.
  - **Sandbox detection:** `CLAUDE_CODE_IS_COWORK` / `CLAUDE_CODE_REMOTE`, or a `CLAUDE_CONFIG_DIR` under `/sessions/` → `sandbox`; the agent tells the user to use Claude Code on their machine.
- **Control skill `pi-dashboard-control`** (renamed to avoid clashing with the extension's `pi-dashboard` skill): a plugin-authored, curl-first `SKILL.md` plus one derived reference.
  - `references/api-reference.md` is the extension skill's file with its "WebSocket bus verbs" section removed.
  - Not shipped: `dashboard-api.sh` (it sends tokens as a cookie, not Bearer), `recipes.md` and `dashboard-bus.ts` (both bus-centric), and `commands/` (pi templates).
  - **Auth:** bare loopback is admitted by default. On 401, or 403 with `local_proof_required` (strict mode), Claude asks the user to run `pi-dashboard token create --label claude-code --tier control`.
    - Preferred: the user saves an `Authorization: Bearer …` header file and Claude sends `curl -H @file`, so the token stays out of the conversation.
    - Fallback: a pasted token, sent only as a Bearer header.
    - The plugin never mints, writes or echoes tokens.
- **Sync and parity**: `scripts/sync-claude-plugin.mjs` derives the reference; a parity test fails on drift; a route test checks that every endpoint the skill names exists.
- **Version lockstep**:
  - `scripts/sync-versions.js` gains a `plugin.json` stamp.
  - The dispatched release commits it with `git add -A`. The local `release-cut` step 6 is extended to stage it; today it stages only `packages/*/package.json`.
  - On the tag-push flow, a `publish.yml` preflight reads the **tagged** `plugin.json` (before any sync rewrites it) and fails on a mismatch. The local `release-cut` checks equality before creating the tag.
  - Claude syncs a marketplace plugin when its version changes.
- **Downloadable plugin package**: the release's `github-release` job zips `packages/claude-plugin/` (manifest at the zip root) as `pi-dashboard-claude-plugin-<version>.zip` with `scripts/build-claude-plugin-zip.mjs` and attaches it to the GitHub Release. This is the file for claude.ai Customize > Plugins > Upload plugin, and a download for users who cannot use the marketplace. The build fails when the zipped manifest version differs from the release version.
- **Tests (TDD)**: structure, `ensure-dashboard.sh` behaviour (fixture servers and stubbed launchers), parity, routes, version, and the Node-floor constant. The existing CI frontmatter guard covers the new `SKILL.md` files.
- **Docs**: an FAQ entry ("How do I use pi-dashboard from Claude Code?"), a README install row, a surface-support statement, and DOX rows.

### Where it works (scope boundary)

| Surface | Result |
|---|---|
| Claude Code CLI and the desktop app's Code tab (including plugins synced from Customize > Plugins) | Full: Bash runs on the host |
| Cowork (cloud; the only mode on Pro/Max since 2026-10-06) | Skills load; Bash runs in Anthropic's sandbox. The script reports `sandbox`. Where detection misses, it stops at `not-installed` and the user is asked before any install |
| claude.ai chat | Skills load; no shell |

### Later possibilities (out of scope; recorded for follow-up changes)

- **A1: MCP stdio shim.** A `.mcp.json` command server (`/bin/sh ${CLAUDE_PLUGIN_ROOT}/scripts/start.sh`, with its own Node lookup) that:
  - reuses `ensure-dashboard.sh`;
  - mints a tier-scoped token over loopback, cached per `CLAUDE_CODE_SESSION_ID`;
  - relays typed tools to `POST /mcp`;
  - declares a static tool list, because `.mcp.json` is read before hooks fire.

  Benefits: typed tools, enforced tier scoping, and no reliance on curl composition. Minting tokens would amend this change's "Token handling stays with the user" requirement.
- **B: Desktop extension (`.mcpb`) reachable from cloud Cowork.** Anthropic's admin docs imply that a cloud session reaches local MCP servers through the open Desktop app. Unverified; needs a one-hour `whereami` test. If it works, it is the only route by which Cowork itself can start the dashboard.
- **C: Remote connector through the tunnel.** Register the zrok URL `/mcp` as a Cowork connector. It cannot start the server. It is blocked on OAuth for `/mcp`.
- **Claude Code as an observed agent**: a hook-based bridge so Claude Code sessions appear in the dashboard. A separate product direction.

### Related changes

- `fix-npm12-remote-tarball-install` (stub). npm 12 defaults to `allow-remote=none` and refuses the server's `xlsx` dependency, a cdn.sheetjs.com tarball, with `EALLOWREMOTE`. This breaks every `npm install -g` / `npx` install of 0.9.0, not only the plugin's. Until that lands, the plugin passes `--allow-remote=all` on its own install command only. Removing that flag is a task in the fix change.

- `harden-dashboard-start-detection` (stub). This change works around the CLI flaws instead of depending on them; that change fixes them in the CLI. The spike exposed four:
  - `cmdStart` ignores a healthy dashboard when `server.pid` is missing;
  - it reports "started" when the start actually lost to the lock;
  - `isServerRunning` deletes `server.pid` after a single 2 s health timeout;
  - `status` ignores `--port`.

## Capabilities

### New Capabilities

- `claude-code-plugin`: the Claude plugin package and marketplace manifest. Covers:
  - installability constraints;
  - the bootstrap contract: single invocation, running-instance detection, launch-source order, consented install of the latest release (global npm, npx fallback), detached start, readiness wait, sandbox refusal;
  - the control skill's derivation from the extension skill;
  - auth handling;
  - version lockstep;
  - the plugin zip attached to each GitHub Release.

### Modified Capabilities

- None. `pi-dashboard-skill` requirements are unchanged. The plugin's control skill is a separate capability with its own auth rules (Bearer tokens supplied by the user); it derives only `api-reference.md` from that skill.

## Impact

- **New:** `packages/claude-plugin/**`, `.claude-plugin/marketplace.json`, `scripts/sync-claude-plugin.mjs`, and tests under `scripts/__tests__/`.
- **Modified (CI/release, not runtime):** `.github/workflows/publish.yml` (plugin-version preflight; `github-release` zips and attaches the plugin); new `scripts/build-claude-plugin-zip.mjs`; `.pi/skills/release-cut/SKILL.md` (step 6 staging, manual `claude plugin validate`).
- **Modified:** `scripts/sync-versions.js` (stamps `plugin.json`), plus docs: FAQ, README and DOX rows.
- **Read-only dependencies:** `packages/extension/.pi/skills/pi-dashboard/` (source of the derived files); the `pi-dashboard` CLI `start` / `token create` subcommands; `/api/health`; the REST routes.
- **No server, client or extension runtime change.** No new runtime dependency, no migration. Rollback means deleting `.claude-plugin/marketplace.json`: installed copies stop updating and users remove them.
- **Interaction with the active change `close-loopback-legacy-window`:** none. The plugin never sends `X-Pi-Local-Token`.

## Discipline Skills

- `security-hardening`: Claude runs host shell commands from the skill, and tokens arrive from the user. Tokens are never written to files or echoed. The download-and-install path requires explicit consent. The temporary `--allow-remote=all` is scoped to that one command. No secrets are shipped in the plugin.
- `doubt-driven-review`: the repo-root marketplace manifest becomes a public install surface, hard to retract once users add it.
