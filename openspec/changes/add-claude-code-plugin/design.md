## Context

See proposal.md for the motivation. The facts that shape the design:

- **Claude surfaces differ** (claude.com/docs/plugins/platform-support):
  - Skills load everywhere.
  - A top-level `bin/` makes Cowork and claude.ai refuse the whole plugin.
  - Local (command) MCP servers run only in Claude Code and in local Cowork.
  - On Pro/Max, Cowork has been cloud-only since 2026-10-06: Bash runs in Anthropic's sandbox, so nothing on the user's machine is reachable.
- **Claude Code runs each Bash tool call in a fresh shell.** Shell variables do not survive between calls.
- **The harness kills long-running background tool calls** (set-copilot lesson #1: 30 min / 2 h). The dashboard must be daemonized by its own CLI, not held by a tool call.
- **Existing building blocks:**
  - `pi-dashboard start` daemonizes: detached, `server.pid`, lock meta, 30 s health wait.
  - `/api/health` is auth-exempt.
  - Bare loopback is admitted, or observe-only under `requireLocalProof` strict mode.
  - `pi-dashboard token create --tier` mints bearer tokens.
  - The extension skill `packages/extension/.pi/skills/pi-dashboard/` documents the REST API.

### Spike evidence (2026-10-12, Claude Code 2.1.140, `/tmp/cc-spike`)

| Check | Result |
|---|---|
| `claude plugin validate` (plugin + marketplace) | Pass after removing `displayName` (rejected: "Unrecognized key") |
| `--plugin-dir` load | Skills registered as `pi-dashboard:pi-dashboard-bootstrap` and `pi-dashboard:pi-dashboard` |
| Marketplace add + install, `--scope local` | Pass. Inventory: 2 skills, 0 agents/hooks/MCP; always-on cost ~158 tokens; control skill ~2.1k tokens on invoke |
| NL prompt "Is my pi dashboard running? …" | Bootstrap skill chosen unprompted; server started detached; survived the Claude exit; control skill listed sessions via curl |
| Re-run against a healthy instance | `STATUS=already-running`, no launcher call |
| `CLAUDE_CODE_IS_COWORK=1` | Exit 2; the agent relayed the sandbox message, no workaround |
| v1 skill: prose steps with shell variables | **Failed.** `PORT` was lost between calls, so `start --port ""` fell back to 8000 → led to D2 |
| Hung instance (`SIGSTOP`), CLI start | No second server (EADDRINUSE). But the live instance's `server.pid` was deleted and its lock meta was overwritten with the dead child's pid → led to D3 |
| Hung / foreign / healthy, after D3 | `BUSY` / `PORT_CONFLICT` / `already-running`; launcher never called; `server.pid` intact |

## Goals / Non-Goals

**Goals:**
- Starting from zero, "Claude, start my pi dashboard" works in Claude Code on the host, with no manual step except consenting to a one-time install of the latest release.
- The plugin stays a handful of text files. The server is never bundled; it comes from the npm registry at its latest release.
- Zero risk of a second dashboard instance and zero damage to a running instance's ownership records.
- One source of truth for the REST API documentation.

**Non-Goals:**
- Making the plugin work in cloud Cowork. It must refuse clearly instead.
- Typed MCP tools or tier enforcement (A1).
- Fixing the CLI start-detection flaws: that is `harden-dashboard-start-detection`. This design works around them.

## Decisions

### D1: Skills-only plugin (A0), not an MCP shim

- **Chosen:** two skills plus one shell script.
- **Alternative: an MCP stdio shim (A1).** Typed tools and tier scoping, but it needs:
  - Node discovery for Dock-launched apps;
  - token minting and caching;
  - a relay;
  - a static tool list, because `.mcp.json` is read before hooks.

  That is several times the code, for the same surfaces.
- **Alternative: a SessionStart hook that auto-starts the server.** It would start the dashboard in every Claude Code session, even unrelated ones; cloud Cowork reportedly doesn't fire hooks reliably; and it adds a component to audit.
- **Rationale:** set-copilot proves the skill + detached-CLI shape in production. A1 stays a recorded follow-up.

### D2: All bootstrap logic in one script with a line protocol

- **Chosen:** `skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh`.
  - POSIX `sh`, invoked as `sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"`.
  - Stdout carries only `STATUS=` / `BASE=`; diagnostics go to stderr.
  - Exit codes: 0 ready, 1 failure, 2 sandbox, 3 busy, 4 not installed (consent needed), 5 port conflict.
- **Alternative: step-by-step prose in `SKILL.md`.** Failed in the spike: per-call shells lose variables, and models paraphrase commands.
- **Alternative: a Node script.** No Node is guaranteed on PATH for Dock-launched Claude Desktop, while `sh` and `curl` exist on macOS and Linux.
- **Windows (assumption, unverified):** Claude Code on Windows provides a POSIX shell (Git Bash) for its Bash tool, so `sh` and `curl` are expected. Verified in QA task 7.5. The Electron `open -b` branch is macOS-only by design.

### D3: Detection by curl exit code; start only on "connection refused"

- **Chosen:**
  - Probe `curl -s -m 5 <BASE>/api/health` up to 3 times.
  - Body containing `"ok"` → already running.
  - Any other HTTP body → port conflict.
  - curl exit 7 (refused) → may start.
  - Anything else after 3 tries (timeout, reset) → `BUSY`, no start.
- **Alternative: rely on `pi-dashboard start`'s own check.** The spike showed it treats one 2 s health timeout as a stale pid. It deletes `server.pid`, and the child takes over the lock before failing on EADDRINUSE. On a heavily loaded dashboard (the condition the `unwedge-dashboard-event-loop` skill describes) that corrupts the live server's ownership records.
- **Alternative: a TCP-only probe** (`nc -z`). It can't tell a dashboard from a foreign service, and `nc` flags differ across platforms.
- **Rationale:** "refused" is the one unambiguous "nothing is listening" signal. Every other state preserves the running process. Worst case for the user: a `BUSY` message pointing at the server log.

### D4: Launch-source order and consented install of the latest release

- **Order:**
  1. `command -v pi-dashboard`;
  2. `"$SHELL" -lc 'command -v pi-dashboard'` (nvm/volta PATH for Dock-launched apps; same idea as the server's login-shell fallback in `docs/service-bootstrap.md`). The first output line that starts with `/` is taken, which tolerates login-shell noise;
  3. macOS `open -b com.blackbelt-technology.pi-dashboard` (bundle id from `packages/electron/forge.config.ts`). The Electron app owns its own server, so it is preferred over a fresh install when it is installed;
  4. with `DASHBOARD_ALLOW_INSTALL=1`: `npm install -g @blackbelt-technology/pi-agent-dashboard@latest`, then the installed CLI's `start`. Only if that install fails: `npx -y …@latest start`, reported as `INSTALL=npx-cache`.
- **Why install once instead of plain npx** (measured 2026-10-12, npm 12.0.2, empty cache):
  - npx works: `@latest` resolved to 0.9.0; ~58 s cold, ~19 s warm (it re-checks `@latest` against the registry on every call); 988 MB / 690 packages.
  - But the detached server runs out of `~/.npm/_npx/<hash>/`, and it registers **that** path as the pi bridge in `~/.pi/agent/settings.json`.
    - `npm cache clean`, or npm evicting old npx folders, removes a running server's files and every pi session's bridge.
    - Each new release lands in a new hash folder: another ~1 GB, and the bridge path moves.
  - A global install gives one copy at a stable path, upgraded in place by the same command. `pi-dashboard` lands on PATH, so later sessions take source 1 with no consent and no network call.
  - npx stays as the fallback for a non-writable global prefix (EACCES on a system Node). The user is told it is not durable.
- **Resolving the CLI after install:** `command -v pi-dashboard`, else `"$(npm prefix -g)/bin/pi-dashboard"` (POSIX), else `"$(npm prefix -g)/pi-dashboard"` (Windows npm layout). `npm` itself is resolved like the CLI: PATH, then the login shell.
- **Prerequisite check before downloading:** npm present, Node ≥ 22.19 (`engines: >=22.19.0 <27`). `node-pty` 1.2.0-beta.13 ships prebuilds for darwin/linux/win32 × x64/arm64, so **no C++ toolchain** is needed.
- **The install is gated because:**
  - it downloads and executes ~1 GB of packages;
  - it takes about a minute;
  - in an undetected sandbox it would install the dashboard into a throwaway VM. The consent question turns a silent wrong action into a visible one.
- **npm 12 `EALLOWREMOTE`:** 0.9.0 depends on `xlsx` via a cdn.sheetjs.com tarball URL. npm 12 defaults to `allow-remote=none`, so the install fails. Until `fix-npm12-remote-tarball-install` lands, the script passes `--allow-remote=all` on its own install command only, never via global config. Older npm versions warn on the unknown flag and ignore it.
- **Always `@latest`:** the `next` dist-tag carries test builds (`0.0.0-test-darwin-x64.3` observed).
- **Alternative: npx without asking.** Rejected for the reasons above.
- **Alternative: plain npx as the primary source.** Rejected for durability (see the measurements above).

### D5: Sandbox detection by environment only

- **Chosen:** a non-empty `CLAUDE_CODE_IS_COWORK` or `CLAUDE_CODE_REMOTE` → exit 2. Both names come from public field reports and Claude Code issues. Neither is a documented contract.
- **Backstop:** D4's install consent gate. A sandbox has no local CLI or app, so a missed detection ends at `NOT_INSTALLED` and a user question, never at a silent install.
- **Alternative: heuristics** (`/sessions/` in cwd, Linux on arm64). Fragile, with false positives on real Linux users.

### D6: Plugin location and form

- **Chosen:** `packages/claude-plugin/` with no `package.json`.
  - It is not a workspace, so there are no pnpm, publish or lockstep-version obligations.
  - `packages/dist/` already exists without a `package.json`, and `sync-versions.js` skips such directories.
- **Marketplace at the repo root** with `source: "./packages/claude-plugin"`.
- **Alternative: a separate repository.** A clean, small marketplace, but a second release flow and drift from the API docs. Kept as the fallback if Cowork's "Add marketplace" cannot handle this repository's size (see Risks).

### D7: Derived control skill (copy + parity test), hand-authored `SKILL.md`

- **Copied byte-identically by `scripts/sync-claude-plugin.mjs`:**
  - `references/api-reference.md`
  - `references/recipes.md`
  - `scripts/dashboard-api.sh`

  A vitest parity test fails on drift and names the sync command.
- **Hand-authored plugin `SKILL.md`:**
  - curl-first; points at `BASE` from the bootstrap;
  - no `dashboard-bus.ts` (it needs workspace packages);
  - no `commands/` (pi prompt templates);
  - carries the token rules (spec: Token handling).
- **Alternative: generate `SKILL.md` from the extension skill by rewriting sections.** Brittle text surgery for a ~100-line file.
- **Alternative: symlinks.** Plugin installs copy directories, so symlinks risk dangling on Windows and in zip uploads.
- **Note:** `api-reference.md` says command verbs "preferably" use the bus, but "the REST endpoints below remain". The plugin `SKILL.md` states explicitly that REST is the path inside Claude.

### D8: Version stamping inside `sync-versions.js`

- **Chosen:** `scripts/sync-versions.js` (already run by `release-cut` step 5 and by CI) also writes the root version into `packages/claude-plugin/.claude-plugin/plugin.json`.
- A test asserts that `plugin.json` `version` equals the root `package.json` version, so CI catches a hand-edit or a missed sync.
- **Alternative: a separate plugin version bumped by hand.** Easy to forget, and Claude never syncs an unchanged version.

### D9: Validation in CI without the Claude CLI

- **Chosen:** a structural vitest (`scripts/__tests__/claude-plugin-structure.test.mjs`) asserts the spec's installability rules:
  - manifest keys are a subset of the keys verified as accepted by `claude plugin validate` 2.1.140 (`name`, `version`, `description`, `author`, `license`, `homepage`, `repository`, `keywords`; `displayName` verified rejected);
  - no `bin/`, `.mcp.json` or `hooks/`;
  - README ≥ 40 words;
  - the marketplace source resolves.
- `claude plugin validate` stays a local or manual check: CI has no Claude CLI or auth.
- The existing `check-skill-frontmatter.mjs` (which walks git-tracked `SKILL.md` files) covers frontmatter automatically.

## Risks / Trade-offs

- **[Cowork's "Add marketplace" may not cope with a ~158 MiB / 18k-file monorepo.]** Claude Code supports `--sparse`; the Cowork UI's behaviour is unknown.
  - Mitigation: post-merge QA task.
  - Fallback: CI mirrors `packages/claude-plugin/` and `.claude-plugin/` into a small dedicated repo (D6 alternative). Users still install with one marketplace URL.
- **[The model ignores the skill and improvises]** (for example, starts the server with `&`).
  - Mitigation: a short, imperative `SKILL.md`; a single command; an explicit "never background" line. The spike passed with a small model (glm-5 via the `haiku` alias).
  - Residual risk: accepted; A1 removes it.
- **[`/api/health` slow on a loaded server → user sees `BUSY` instead of the URL.]** Acceptable: a false "busy" is harmless, a false "down" is not. The message points to the log and the unwedge skill.
- **[`--allow-remote=all` loosens npm's remote-tarball guard for that one install]** It is scoped to a single command against our own package's dependency tree, and removed by `fix-npm12-remote-tarball-install`.
- **[A global install changes the user's machine]** It adds a `pi-dashboard` binary and registers the bridge in `~/.pi/agent/settings.json`, the same as the documented FAQ install path. The consent prompt says so; `PI_DASHBOARD_BRIDGE=off` remains the per-process opt-out.
- **[Electron first-run wizard]** can exceed the 60 s readiness wait. The timeout message tells the user to finish the app's setup and ask again.
- **[Sandbox env names undocumented]** → D5 backstop (consent gate).
- **[Plugin updates ship only with releases]** (version lockstep). Acceptable: the skill content tracks the API, which changes with releases anyway.
- **[kb indexes the duplicated reference files twice]** The kb already collapses duplicates (`+N dup`); no action.
- **[A public install surface]** The marketplace URL is hard to retract. The plugin carries no secrets and no executables beyond two shell scripts users can read; rollback means deleting the manifest.

## Migration Plan

1. Merge. The marketplace becomes discoverable at `BlackBeltTechnology/pi-agent-dashboard`.
2. The first release after merge stamps `plugin.json` with the release version.
3. Post-merge QA (tasks section 7): Claude Code marketplace install from GitHub with `--sparse`; Customize > Plugins install; cloud Cowork sandbox message.
4. If the Cowork marketplace install fails on repo size, switch to the mirror-repo fallback: a CI job plus a README URL change. No change to the plugin contents.
5. Rollback: delete `.claude-plugin/marketplace.json`. Optionally bump to a release whose skill tells users that the plugin is retired.

## Open Questions

- The exact cloud-Cowork environment marker. D5 plus the consent gate cover the gap; the answer can come from QA without changing the design.
