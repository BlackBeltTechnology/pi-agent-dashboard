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
- **Bootstrap skill `pi-dashboard-bootstrap`**: a short `SKILL.md` that runs ONE script, `scripts/ensure-dashboard.sh`, as a single foreground Bash call. Prose steps with shell variables broke in the spike, because every Bash call is a fresh shell. The script is idempotent and prints `STATUS=<state>` and `BASE=<url>`.
  - **It never starts a second dashboard.** It probes `/api/health` up to 3× with a 5 s timeout and starts ONLY when the port refuses connections.
    - A port that is held but silent (an overloaded dashboard) → `BUSY`, no start.
    - A non-dashboard service on the port → `PORT_CONFLICT`, no start.
    - This keeps the plugin away from the CLI's stale-pid path, which deletes a busy server's `server.pid` and takes over its lock (see the related change below).
  - **Launch sources, in order:**
    1. the `pi-dashboard` CLI on PATH, then via a login shell (Dock-launched apps lack the shell PATH), then under the npm global prefix;
    2. the installed Electron app on macOS (`open -b com.blackbelt-technology.pi-dashboard`);
    3. **Install the latest release once, only after the user agrees**: `npm install -g @blackbelt-technology/pi-agent-dashboard@latest`, then `pi-dashboard start`.
       - This is a stable global install: one copy, a stable bridge path in pi's `settings.json`, upgraded by re-running the same command. `pi-dashboard` is then on PATH, so later sessions take step 1.
       - Only when the global install fails (for example EACCES on a root-owned prefix): `npx -y @blackbelt-technology/pi-agent-dashboard@latest start`, flagged to the user as **non-durable**.
       - Consent is required because the step downloads and runs about 1 GB of packages (measured 2026-10-12: 690 packages, 988 MB, ~58 s cold), needs Node ≥ 22.19 (prebuilt `node-pty`, no compiler), and must never run silently inside a sandbox.
       - Always pin `@latest`: the `next` dist-tag carries test builds.
  - Starts are detached (`pi-dashboard start` daemonizes). The script waits for readiness, bounded at 60 s.
  - **Sandbox detection:** in Cowork or a remote session the script stops with a message telling the user to use Claude Code on their machine.
- **Control skill `pi-dashboard`**: a plugin-authored, curl-first `SKILL.md`.
  - Derived files are copied byte-identical from `packages/extension/.pi/skills/pi-dashboard/`: `references/api-reference.md`, `references/recipes.md`, `scripts/dashboard-api.sh`.
  - The `dashboard-bus.ts` path (it needs workspace packages) and the pi-only `commands/` prompt templates are excluded.
  - Auth: bare loopback is admitted by default. On 401 / `local_proof_required` (strict mode), Claude asks the user to run `pi-dashboard token create --tier <tier>` and sends `Authorization: Bearer`. The plugin never mints, stores or echoes tokens.
- **Sync and parity**: `scripts/sync-claude-plugin.mjs` copies the derived files; a parity test fails when they drift from the source.
- **Version lockstep**: `scripts/sync-versions.js` stamps the repo version into `plugin.json`. Claude syncs a marketplace plugin only when its version changes, so the existing `release-cut` bump publishes plugin updates with no extra step.
- **Tests (TDD)**:
  - a structural test of the plugin layout and manifests;
  - a behaviour test of `ensure-dashboard.sh` against fixture servers (healthy / hung / foreign / refused), with stubbed launchers;
  - the parity test above.
  - The existing CI frontmatter guard already covers the new `SKILL.md` files.
- **Docs**: an FAQ entry ("How do I use pi-dashboard from Claude Code?"), a README install row, a surface-support statement, and DOX rows.

### Where it works (scope boundary)

| Surface | Result |
|---|---|
| Claude Code CLI and the desktop app's Code tab (including plugins synced from Customize > Plugins) | Full: Bash runs on the host |
| Cowork (cloud; the only mode on Pro/Max since 2026-10-06) | Skills load; Bash runs in Anthropic's sandbox. The script detects this and says so. Where detection misses, the install consent gate stops a silent sandbox install |
| claude.ai chat | Skills load; no shell |

### Later possibilities (out of scope; recorded for follow-up changes)

- **A1: MCP stdio shim.** A `.mcp.json` command server (`/bin/sh ${CLAUDE_PLUGIN_ROOT}/scripts/start.sh`, with its own Node lookup) that:
  - reuses `ensure-dashboard.sh`;
  - mints a tier-scoped token over loopback, cached per `CLAUDE_CODE_SESSION_ID`;
  - relays typed tools to `POST /mcp`;
  - declares a static tool list, because `.mcp.json` is read before hooks fire.

  Benefits: typed tools, enforced tier scoping, and no reliance on curl composition.
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
  - version lockstep.

### Modified Capabilities

- None. `pi-dashboard-skill` requirements are unchanged; the plugin derives from that skill.

## Impact

- **New:** `packages/claude-plugin/**`, `.claude-plugin/marketplace.json`, `scripts/sync-claude-plugin.mjs`, and tests under `scripts/__tests__/`.
- **Modified:** `scripts/sync-versions.js` (stamps `plugin.json`), plus docs: FAQ, README and DOX rows.
- **Read-only dependencies:** `packages/extension/.pi/skills/pi-dashboard/` (source of the derived files); the `pi-dashboard` CLI `start` / `token create` subcommands; `/api/health`; the REST routes.
- **No server, client or extension runtime change.** No new runtime dependency, no migration. Rollback means deleting `.claude-plugin/marketplace.json`: installed copies stop updating and users remove them.
- **Interaction with the active change `close-loopback-legacy-window`:** none. The plugin never sends `X-Pi-Local-Token`.

## Discipline Skills

- `security-hardening`: Claude runs host shell commands from the skill, and tokens arrive from the user. Tokens are never written to files or echoed. The download-and-install path requires explicit consent. The temporary `--allow-remote=all` is scoped to that one command. No secrets are shipped in the plugin.
- `doubt-driven-review`: the repo-root marketplace manifest becomes a public install surface, hard to retract once users add it.
