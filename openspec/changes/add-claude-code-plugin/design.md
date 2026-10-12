## Context

See proposal.md for the motivation. The facts that shape the design:

- **Claude surfaces differ** (claude.com/docs/plugins/platform-support):
  - Skills load everywhere.
  - A top-level `bin/` makes Cowork and claude.ai refuse the whole plugin.
  - Command MCP servers run only in Claude Code and in local Cowork.
  - On Pro/Max, Cowork has been cloud-only since 2026-10-06: Bash runs in Anthropic's sandbox.
- **Claude Code runs each Bash tool call in a fresh shell**, and the harness kills long-held background tool calls (set-copilot lesson #1). The dashboard must be daemonized by its own CLI.
- **The dashboard CLI**:
  - `pi-dashboard start` daemonizes: detached, with `server.pid` and lock meta (`packages/server/src/cli.ts:392-440`).
  - Its "already running" check needs a live `server.pid` (`spawn-process/server-pid.ts:65-80`). It deletes that file after a single 2 s health miss (`server-pid.ts:74-78`).
  - It treats only a *foreign* port holder as a conflict (`cli.ts:401-406`). These are the flaws `harden-dashboard-start-detection` fixes.
- **Instance records** live under `$HOME/.pi/dashboard/`, not the canonical home.
  - The lock path is deliberately `$HOME`-honouring (`packages/server/src/lifecycle/home-lock.ts:143-155`). This diverges from the `instance-coordination` "HOME canonicalization" text; that spec drift is pre-existing.
  - The lock metadata is written on lock acquisition. `server.pid` is written only **after** `listen` (`packages/server/src/server.ts:~4059-4060`). Before listening, the metadata is the only record of a live process.
  - The metadata is authoritative over `server.pid` (`instance-coordination` "Server PID file remains advisory").
- **`/api/restart`** kills the old daemon (SIGTERM, then SIGKILL after ~3 s), waits ≤5 s for the port, and spawns, with no lock wait (`packages/server/src/spawn-process/restart-helper.ts:185-214`). This also diverges from the `instance-coordination` "Restart handoff" text.
- **Port usability:** the code accepts integers 1–65535 (`packages/shared/src/config.ts:1177-1180`). The bridge spec's `Number(v) > 0` text is stale; the script follows the code.
- **Dashboard identity** in the CLI: HTTP 200 with `ok === true` and a numeric `pid` (`packages/shared/src/server-identity.ts:112-119`). Recovery mode answers `/api/health` with `{"ok":false,"mode":"recovery"}` (`packages/server/src/lifecycle/recovery-server.ts:332-340`).
- **Auth**: bare loopback is admitted. Under `requireLocalProof` strict mode, a bare-loopback mutation gets **403** with `reason: "local_proof_required"` (`packages/server/src/auth/localhost-guard.ts:350-358`). Paired-device tokens from `pi-dashboard token create` are Bearer tokens.
- **The extension skill's `dashboard-api.sh`** sends `DASHBOARD_TOKEN` as the `pi_dash_token` cookie (`packages/extension/.pi/skills/pi-dashboard/scripts/dashboard-api.sh:64-65`), not as Bearer. Its `api-reference.md` opens with a "WebSocket bus verbs" section that prefers `dashboard-bus.ts` (`references/api-reference.md:9-19`). `recipes.md` is bus-centric.
- **Release has two paths** (`.github/workflows/publish.yml:3-12`):
  - **Dispatched:** the `tag-and-push` job runs `sync-versions.js` (`:174`) and commits with `git add -A` (`:222-223`).
  - **Local `release-cut` tag push:** step 5 runs `sync-versions.js`, but step 6 stages only `CHANGELOG.md package.json pnpm-lock.yaml packages/*/package.json` (`.pi/skills/release-cut/SKILL.md:197`).
  - The `publish` job's own `sync-versions.js` run (`:281`) never commits.
- **The CLI's `start`** reads `--port`, else `PI_DASHBOARD_PORT` (`packages/server/src/cli.ts:191`). The shared resolver used by the bridge adds `DASHBOARD_PORT` and ignores unusable values (`packages/shared/src/config.ts:1173-1186`; `openspec/specs/bridge-auto-start-lifecycle/spec.md` "Auto-start resolves ports with environment precedence").

### Spike evidence (2026-10-12, Claude Code 2.1.140, `/tmp/cc-spike`)

| Check | Result |
|---|---|
| `claude plugin validate` (plugin + marketplace) | Pass after removing `displayName` (rejected: "Unrecognized key"). Verified accepted: `name`, `version`, `description`, `author`, `license`, `homepage`, `repository`, `keywords` |
| Marketplace add + install, `--scope local` | Pass. Inventory: 2 skills, 0 agents/hooks/MCP; ~158 always-on tokens; ~2.1k on invoke |
| NL prompt "Is my pi dashboard running? …" | Bootstrap skill chosen unprompted; server detached and survived the Claude exit; control skill listed sessions via curl |
| Healthy / hung (`SIGSTOP`) / foreign / refused, using the checked-in `spike/ensure-dashboard.sh` (curl-exit-code classification; it predates the identity, pid-file and lock rules below) | `already-running` / `BUSY` / `PORT_CONFLICT` / started; no launcher call except on refused |
| v1 prose skill with shell variables | **Failed**: `PORT` lost between calls → `start --port ""` → port 8000 → D2 |
| CLI `start` against a hung instance | No second listener (EADDRINUSE), but `server.pid` was deleted and the lock meta rewritten to a dead pid → D3 |
| Cold `npx …@latest` (npm 12.0.2) | `EALLOWREMOTE` (`xlsx` CDN tarball); with `npm_config_allow_remote=all`: 58 s, 988 MB, 690 packages; prebuilt `node-pty`; bridge registered inside `~/.npm/_npx/<hash>` → D4 |

## Goals / Non-Goals

**Goals:**
- Starting from zero, "Claude, start my pi dashboard" works in Claude Code on the host. The only manual step is consenting to a one-time install of the latest release.
- The plugin never launches while anything holds the port, never overrides `HOME`, and never touches a running instance's `server.pid` or lock.
- The plugin stays a handful of text files: a manifest, two skills, one script and one derived reference.

**Non-Goals:**
- Working in cloud Cowork. The plugin must refuse there.
- Typed MCP tools or tier enforcement (A1).
- Fixing the CLI start flaws (`harden-dashboard-start-detection`). This design works around them.
- Changing the extension's `pi-dashboard` skill or its `pi-dashboard-skill` requirements. The plugin's control skill is a separate capability with its own auth rules.

## Decisions

### D1: Skills-only plugin (A0), not an MCP shim or hooks

- **Chosen:** two skills plus one shell script.
- **Alternative: an MCP stdio shim (A1).** Typed tools and tier scoping, at several times the code: Node discovery for Dock-launched apps, token minting and caching, a relay, and a static tool list because `.mcp.json` is read before hooks.
- **Alternative: a SessionStart hook.** It would auto-start the dashboard in unrelated sessions, and is an extra component to audit.
- **Rationale:** set-copilot proves the skill + detached-CLI shape in production.
- **Note on existing spec drift (not changed here):** `server-process-management` "Start fails" says 5 s; the code waits 30 s (`cli.ts:428`). The timing budget in D2 uses the code value.

### D2: One POSIX script with a line protocol and one explicit tool timeout

- **Script:** `skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh`, invoked as `sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh" [--install]`.
- **stdout:** exactly one `STATUS=` line for every outcome, plus `BASE=` / `INSTALL=` on success. Every launcher (`pi-dashboard start` prints to stdout, `cli.ts:396,431`; npm; npx) runs with `1>&2`, so stdout stays parseable. Exit codes 0–5 per the spec.
- **`--check`:** verify-only mode (no lock, no launch). Every credentialed call is chained after it (D8).
- **Test-only timing overrides:** `PIDB_TEST_REFUSAL_S`, `PIDB_TEST_RECORD_POLL_S`, `PIDB_TEST_LIVE_POLL_S`, `PIDB_TEST_READY_S` and `PIDB_TEST_LOCK_WAIT_S` shorten the 10/10/60/60/170 s windows so L1 tests run fast. They are honoured only when `PIDB_TEST=1` is set. The skill never sets them, and one test (X4) runs the real 10 s window.
- **Timeout:** one budget, 600 s for every run (the Bash tool maximum). Worst case ≈ 330 s: lock wait 170 s + refusal window 10 s + cold install ~60 s + CLI start ≤32 s (`cli.ts:428`) + readiness 60 s. Because the script is idempotent, a killed run is re-run and reports `already-running`.
- **Consent is an argument (`--install`), not an environment variable.** An exported variable would silently consent for every later run.
- **Alternative: prose steps in `SKILL.md`.** Failed in the spike.
- **Alternative: a Node script.** Node isn't guaranteed before install; `sh` and `curl` are.

### D3: Launch only on sustained refusal with no live recorded process; verify identity by pid

- **Classification extends the CLI's identity check** (`server-identity.ts:112-119`):
  - **verified dashboard** = 200 + `"ok":true` + `"pid":<digits>`, **and** that pid equals the lock metadata's pid. `server.pid` is used only when the metadata is absent. Both are read from `$HOME/.pi/dashboard/` (Context).
  - An `ok` body with no matching record → poll the records for 10 s (the metadata write and a restart's re-acquisition race with the probe), then **port-conflict**. Credentials never go to it. The pid match matters because the control skill later sends user credentials to this port; an unrelated local service answering `{"ok":true,"pid":N}` is classified **port-conflict**, never trusted.
  - **recovery** = `"ok":false` + `"mode":"recovery"`. This is a deliberate extension: the CLI calls it a conflict.
  - curl exit 7 → **refused**; timeout or reset → **busy**; any other answer → **port-conflict**.
  - Implemented with tight string matches on compact JSON; the pid files are read with `sed`/`grep` and the pid checked with `kill -0`.
- **No launch while a process is recorded alive, or while a record is unknown.**
  - A live pid in `server.pid` or the lock metadata means a server is starting, restarting or stuck. The script polls for a verified dashboard for up to 60 s, never launches, and reports `busy` if none appears.
  - Unparseable or partly written metadata is **unknown**, not absent (the server itself treats corrupt metadata as stealable, `instance-coordination` "Metadata sidecar robustness"; the plugin must not race that steal). Same handling.
  - This removes the hazard where `pi-dashboard start` meets a live-but-silent pid and deletes `server.pid` (`server-pid.ts:65-80`): the CLI is only ever invoked when no live pid is recorded.
- **Sustained refusal ≥10 s, plus the live-pid rule.** `/api/restart` kills the old daemon, waits ≤5 s for the port, then spawns (Context).
  - While the old process lives, it is recorded alive → the script waits.
  - In the gap after it dies and before the new server writes its metadata, no live pid is recorded. A launch there is a clean start racing the restart's spawn on a free port; the home lock lets exactly one win. It never meets the live-but-silent pid that makes `start` delete `server.pid`.
  - So the window bounds wasted launches; it is not what guarantees safety.
- **Other port, same HOME.** The home lock admits one dashboard per HOME, so a launch would only attach or fail (`openspec/specs/home-lock-single-instance/spec.md`).
  - Port from config or the default → classify the metadata's `httpPort` and report it.
  - Port from an explicit environment variable → `failed`, naming the running port. The user asked for a specific port; they are not silently redirected (`server-process-management` "Lock metadata for a different port does not prove ownership").
- **Bootstrap lock:** an atomic `mkdir "$HOME/.pi/dashboard/claude-bootstrap-<port>.lock"` (with `${HOME:?}` guards), then a `holder` file with the pid.
  - Stale when the holder pid is dead (`kill -0`); when the holder file is missing and the lock is >1 min old (covers a crash between `mkdir` and the holder write; a fresh missing holder counts as live); or when the lock is >11 min old (> the 600 s budget). Ages use `find <lock> -maxdepth 0 -mmin +N`, verified on macOS, GNU and BSD `find`; no `stat`.
  - Pid reuse can make a dead holder look alive until the 11 min cap; the waiter then reports `busy` and the user re-runs. Accepted, simpler than `autostart-lock.ts`'s start-time check (E6).
  - Waiters poll every 2 s for up to 170 s, then report `busy`.
  - Release and break: `rm -f "$L/holder"; rmdir "$L"`. **Never `rm -rf`.** Released by `trap … EXIT INT TERM`. The break is two-step; this is the same residual window `packages/extension/src/autostart-lock.ts:1-40` accepts.
- **Why not reuse the bridge's `autostart-<port>.lock`:** it is a JSON record with pid and start-time staleness rules owned by TypeScript (`autostart-lock.ts`). Writing it from `sh` would couple two implementations of one format.
- **Residual race** with a concurrent bridge auto-start against a truly free port: both are clean starts. The home lock makes one attach; a loser that binds fails and exits (`autostart-lock.ts` header).
- **Alternative: rely on `pi-dashboard start`'s own check.** It deletes a busy server's pid file (Context). Rejected.

### D4: Launch sources, and a consented install of the latest release

- **Order:**
  1. `pi-dashboard` on PATH → in known install directories → via `"${SHELL:-/bin/zsh}" -lc` → the newest existing npx-cache copy.
     - Known directories: `$(npm prefix -g)/bin`, the highest-versioned `~/.nvm/versions/node/*/bin` (`sort -V`), `~/.volta/bin`, `/opt/homebrew/bin`, `/usr/local/bin`.
     - The scan precedes the login shell because `-lc` does not read `~/.zshrc`, where nvm is usually initialised; a reviewer reproduced that with `env -i`.
     - The login shell never uses `-i`, per the repo rule in `openspec/specs/dashboard-server/spec.md` ("Login-shell tool-detection fallback MUST NOT spawn an interactive shell", SIGTSTP). `SHELL` unset → `/bin/zsh`, the repo convention.
     - The last output line that is an absolute path to an executable with basename `pi-dashboard` wins, so login-shell noise is never executed.
     - The npx-cache candidate (`~/.npm/_npx/*/node_modules/.bin/pi-dashboard`, newest, skipping any whose `@blackbelt-technology/pi-agent-dashboard/package.json` version contains `-`) stops an earlier non-durable fallback from re-asking and stacking another ~1 GB each session. It is reported as non-durable.
     - nvm "highest version" uses `sort -V` (verified on this macOS's `sort`); the fallback is a numeric field sort, `sort -t. -k1,1n -k2,2n -k3,3n` after stripping `v`.
  - **A launcher that fails stops the run** (`STATUS=failed`); later sources are not tried. Otherwise a failing CLI would fall through to an unwanted install question.
  - **Every CLI launch passes `--port <resolved>`**, because the CLI itself reads only `--port` / `PI_DASHBOARD_PORT` (Context).
  2. macOS only, and only when the port came from config or the default (the app resolves its own port from config): `open -g -b com.blackbelt-technology.pi-dashboard`. `-g` keeps the app in the background. Bundle id from `packages/electron/forge.config.ts:67`; `CFBundleIdentifier` verified on an installed app. Verified: `open -g -b <missing>` exits 1, so a non-zero exit means not installed.
  3. `--install`:
     - check that npm resolves and Node is in the server's usable set: `engines.node` `>=22.19.0 <27` minus v24.1–v24.2 (`openspec/specs/doctor-diagnostic/spec.md` "System Node detection matches the server accept-set", gate `isUsableNodeVersion`, `packages/shared/src/node-version.ts:150`). A test pins the script's constants to `package.json` `engines.node` and to the shared gate;
     - `npm_config_allow_remote=all npm install -g @blackbelt-technology/pi-agent-dashboard@latest` (the variable set on that command only);
     - resolve the installed CLI: PATH, then `$(npm prefix -g)/bin/pi-dashboard`, then `$(npm prefix -g)/pi-dashboard` (Windows layout);
     - read the installed version from `$(npm prefix -g)/lib/node_modules/@blackbelt-technology/pi-agent-dashboard/package.json` and refuse a prerelease (`-` in the version), so a mis-tagged `latest` never runs;
     - start it with `--port`, without the npm variable.
     - On install failure: a hint that leads with configuring a user-writable npm prefix (`npm config set prefix ~/.npm-global` + PATH). `sudo` is not recommended: it leaves root-owned npm state and a prefix the script cannot see.
     - Then the npx fallback in two steps:
       1. `npm_config_allow_remote=all npm exec --yes --package=@blackbelt-technology/pi-agent-dashboard@latest -- node -e 0` fetches into the npx cache;
       2. `npx --yes @blackbelt-technology/pi-agent-dashboard@latest start --port <p>` starts it **without** the variable. The server spawns npm itself (`packages/server/src/pi/pi-core-updater.ts`, `runtime-overlay/runtime-stager.ts:199`), so it must not inherit the override.

       Reported as `INSTALL=npx-cache` (non-durable).
- **Why install once instead of plain npx** (measured): the npx-started server runs from `~/.npm/_npx/<hash>/` and registers that path as the pi bridge in `~/.pi/agent/settings.json`.
  - A cache clean breaks every pi session.
  - Each release adds about 1 GB in a new hash folder.
  - Warm npx still costs ~19 s per call.

  A global install is one copy at a stable path; later runs take source 1 with no network call.
- **`npm_config_allow_remote=all` as an environment variable**, not a flag: older npm ignores unknown env config. It is set only on the fetch/install commands, never on a command that becomes the server. It loosens the guard for that command's whole dependency tree, including lifecycle scripts (see Risks), and is removed by `fix-npm12-remote-tarball-install`.
- **Always `@latest`.** The `next` dist-tag carries test builds (`0.0.0-test-darwin-x64.3` observed).

### D5: Sandbox detection by environment only

- A non-empty `CLAUDE_CODE_IS_COWORK` or `CLAUDE_CODE_REMOTE`, or `CLAUDE_CONFIG_DIR` beginning with `/sessions/` → `STATUS=sandbox`, exit 2, before any probe.
  - The names come from field reports (claude-code issue #40495 for the Cowork `/sessions/…/mnt/.claude` config dir). Both variable names appear in the Claude Code 2.1.140 binary; neither is a documented contract.
  - Verified 2026-10-12: a local Claude Code 2.1.140 CLI session sets only `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_EFFORT` and `CLAUDECODE`; no sandbox marker.
  - The desktop Code tab is unverified. A manual check gates announcing the plugin, because a false positive there would refuse a supported surface.
- **Backstop:** a sandbox has no local CLI or app, so a missed detection ends at `STATUS=not-installed`. The user sees an explicit install question naming "the machine running this session", with a "decline in Cowork / web" line, never a silent install.
- **Alternative: heuristics** (`/sessions/` in cwd, Linux on arm64). Fragile, with false positives for real Linux users.

### D6: Plugin location and form

- **Chosen:** `packages/claude-plugin/` with no `package.json`. It is not a workspace.
- Directory walkers tolerate a `packages/*` entry without `package.json`: `sync-versions.js` (skips such directories), `scripts/verify-lockfile-versions.mjs:41-48` (ENOENT), `scripts/nightly-verdaccio-publish.mjs:72`. `packages/dist/` is an existing precedent.
- **Marketplace:** root `.claude-plugin/marketplace.json`, name `pi-agent-dashboard`, with a description, `source: "./packages/claude-plugin"`. Claude Code users can add it with `--sparse .claude-plugin packages/claude-plugin` (syntax confirmed in `claude plugin marketplace add --help`).
- **Alternative: a separate repository.** Kept as the fallback if Cowork's "Add marketplace" cannot handle this repository's size.

### D7: Control skill `pi-dashboard-control`: hand-authored `SKILL.md` + one derived reference

- **Ships:** `SKILL.md` (curl with `BASE`) and `references/api-reference.md`.
- **Excluded:** `dashboard-api.sh` (cookie auth, bash), `recipes.md` (bus-centric), `dashboard-bus.ts` (workspace packages), `commands/` (pi templates).
- **Derived reference:** `scripts/sync-claude-plugin.mjs` writes the source `api-reference.md` with the `## WebSocket bus verbs` section removed (heading through the next `---` rule). It **fails** if that heading is absent, so a renamed source section cannot silently produce a no-op.
  - The parity test applies the same transform and compares byte for byte.
  - A separate **negative test** scans every shipped plugin file for forbidden tokens (`dashboard-bus`, `bus-client`, `dashboard-api.sh`, `WebSocket bus`, `commands/dashboard-`). The transform and its check are therefore not circular.
- **`SKILL.md` content:** health, sessions, prompt, abort and spawn calls; an explicit statement that REST is the command path; and the token rules (D8).
- The skill is named `pi-dashboard-control`, not `pi-dashboard`, to avoid a name clash with the extension skill in the kb and in agent prompts.
- A test asserts that every method + path `SKILL.md` names is registered by the server (route registration calls under `packages/server/src/`).
- Both new skill descriptions stay within the repository's 400-character budget (`scripts/check-skill-frontmatter.mjs:47`).

### D8: Tokens stay with the user; a header file keeps them out of the transcript

- **Trigger:** 401, or 403 with `reason: local_proof_required`.
- **Ask:** `pi-dashboard token create --label claude-code --tier control`. `control` covers prompt, spawn and abort; `operate` only on explicit request.
- **Preferred:** the user saves `Authorization: Bearer <token>` in a file they create (`chmod 600`) and gives its path; the agent uses `curl -H @<path>`. `curl -H @file` verified with curl 8.7.1 (macOS); it was introduced in curl 7.55 per curl's changelog, unverified here. The agent never creates the file and never uses `-v` / `--trace` on authenticated calls.
- **Fallback:** the user pastes the token; it is sent only as a Bearer header and never echoed or written. The token then exists in the conversation history (trade-off, stated in the skill).
- **Verified before every credentialed call:** `sh <script> --check && curl -H @<file> …` in one command. A port re-bound by another process after the bootstrap fails `--check`, so the credentials are not sent.
- The plugin never writes credentials. A1 would mint tokens, so if A1 is built it must amend this requirement.

### D9: Version stamping and CI checks

- **Stamp:** `scripts/sync-versions.js` writes the root version into `packages/claude-plugin/.claude-plugin/plugin.json`.
  - Dispatched path: committed by `git add -A`.
  - Local path: `release-cut` step 6 gains `packages/claude-plugin/.claude-plugin/plugin.json` in its `git add`.
- **Guards:**
  - a CI test asserts `plugin.json` version = root version on every PR;
  - **tag-push flow:** a preflight step in `publish.yml`, before its `sync-versions.js` run (`:281`) rewrites the working copy, reads `git show "$GITHUB_REF_NAME:packages/claude-plugin/.claude-plugin/plugin.json"` and fails on a mismatch with the tag version, before any publish;
  - **dispatched flow:** `tag-and-push` stamps and commits in one job (`:174, :222-223`), so it is consistent by construction;
  - **local `release-cut`:** step 6 stages `plugin.json`, its "No other files" diff check (`SKILL.md:190-192`) is updated, and a new step runs the version-equality test before `git tag`, so a stale tag is caught before it exists;
  - the `release-cut` checklist gains a manual `claude plugin validate packages/claude-plugin` step when the Claude CLI is available. This catches validator schema changes that the CI deny-list cannot.
- **Structural test** (`scripts/__tests__/claude-plugin-structure.test.mjs`) asserts:
  - required manifest keys are present and `displayName` is absent. This is a deny-list, not an allow-list, so new optional keys don't break CI;
  - no `bin/`, `.mcp.json` or `hooks/`;
  - README ≥ 40 words;
  - marketplace `name`, `description` and a resolvable `source`.
- **`claude plugin validate`** stays a manual check: CI has no Claude CLI.
- **Frontmatter:** `check-skill-frontmatter.mjs` covers git-tracked `SKILL.md` files, which includes staged ones (`git ls-files`).

## Risks / Trade-offs

- **[Cowork "Add marketplace" may not cope with a ~158 MiB / 18k-file monorepo]** → post-merge QA. Fallback: a CI mirror into a small dedicated repo (D6).
- **[The model improvises]** (e.g. `&`, or skips the timeout) → short imperative `SKILL.md` and an idempotent script. The spike passed with a small model. A1 removes the residual risk.
- **[The script cannot prove human consent]** `--install` can be typed by the agent. Mitigations: the skill's mandatory question, and Claude Code's Bash permission prompt, which shows `--install` in default permission mode. Residual risk accepted.
- **[`npm_config_allow_remote=all` covers the whole install tree]** Accepted for our own published package until `fix-npm12-remote-tarball-install` lands.
- **[A false `busy` on a slow-booting or loaded server]** Harmless: the message says the dashboard may still be starting, retry in a minute, then check the server log if it persists. A false "down" is the outcome the design prevents.
- **[A residual race with a concurrent bridge auto-start]** → server-side backstop (D3).
- **[Restart gap longer than 10 s with no pid recorded]** A pathological restart could still be judged down → a launch → the CLI starts against a free port (clean start; the home lock arbitrates). It never meets the live-but-silent pid that corrupts state.
- **[`CLAUDE_CODE_REMOTE` set in the local Code tab]** (unverified) would refuse a supported surface → QA task; the fix would be to drop that marker.
- **[A token pasted into chat stays in the conversation history]** → the header-file path is preferred (D8).
- **[Electron first-run wizard]** can exceed the 60 s wait; the `failed` message tells the user to finish the app's setup.
- **[Plugin updates ship only with releases; every release bumps the plugin version]** The user gets a silent re-sync even when the content is unchanged. Accepted.
- **[Sandbox env names undocumented]** → D5 backstop.
- **[A global install changes the machine]** It adds the `pi-dashboard` binary and the pi bridge, the same as the documented FAQ install path. The consent message says so; `PI_DASHBOARD_BRIDGE=off` remains the per-process opt-out.

## Migration Plan

1. Merge. The marketplace becomes discoverable at `BlackBeltTechnology/pi-agent-dashboard`.
2. The first release stamps `plugin.json`.
3. Post-merge QA (manual tasks).
4. If the Cowork marketplace install fails on repo size → mirror-repo fallback (CI job + README URL). Plugin contents are unchanged.
5. Rollback: delete `.claude-plugin/marketplace.json`.

## Open Questions

- The exact cloud-Cowork environment marker. The D5 backstop covers the gap; QA records the observed marker.
