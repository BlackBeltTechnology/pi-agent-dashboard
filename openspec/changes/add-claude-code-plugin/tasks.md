## 1. Plugin skeleton and manifests (TDD)

- [ ] 1.1 Write `scripts/__tests__/claude-plugin-structure.test.mjs`. It asserts the spec's installability rules:
  - `packages/claude-plugin/.claude-plugin/plugin.json` exists with `name: "pi-dashboard"` and the required fields;
  - its keys are a subset of the D9 allowlist (no `displayName`);
  - no top-level `bin/`, `.mcp.json` or `hooks/`;
  - `README.md` has ≥ 40 words outside code fences;
  - a `LICENSE` file or `license` field exists;
  - `.claude-plugin/marketplace.json` has a `description` and a `pi-dashboard` entry whose `source` resolves to `packages/claude-plugin`.

  Verify: `npx vitest run --project scripts claude-plugin-structure` fails (red).
- [ ] 1.2 Create `packages/claude-plugin/.claude-plugin/plugin.json` (`version` = the current root version; author BlackBelt Technology; license MIT), plus `README.md` (what it does, how to install, which surfaces it works on, what data it touches: localhost only) and `LICENSE` (copy of the repo license). Verify: test 1.1 passes for the plugin part.
- [ ] 1.3 Create the root `.claude-plugin/marketplace.json` (`name: "pi-agent-dashboard"`, owner, description, `plugins[0].source: "./packages/claude-plugin"`). Verify: test 1.1 is green, and `claude plugin validate packages/claude-plugin` and `claude plugin validate .` both pass locally.

## 2. `ensure-dashboard.sh` (TDD)

- [ ] 2.1 Write `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs`.
  - **Harness:**
    - runs `sh ensure-dashboard.sh` with a temp `DASHBOARD_HOME`;
    - uses a stub `PATH` dir whose `pi-dashboard`, `npm`, `npx`, `node` and `open` record their argv to a file (the `npm` stub can be configured to succeed and drop a `pi-dashboard` stub under a fake global prefix, or to fail with EACCES; the `node` stub reports a configurable version);
    - uses a stub `SHELL` for the login-shell lookup;
    - uses Node fixture HTTP servers on ephemeral ports.
  - **Cases (one per spec scenario):**
    - healthy `{ok:true}` → exit 0, `STATUS=already-running`, no launcher call;
    - hung server (accepts, never responds) → exit 3 `BUSY`, no launcher call;
    - foreign HTTP → exit 5 `PORT_CONFLICT`, no launcher call;
    - refused port + stub CLI that starts a fixture → exit 0 `STATUS=started`;
    - refused port, CLI only in the login shell → that CLI launched;
    - no CLI, `open` stub present (darwin only) → `open -b com.blackbelt-technology.pi-dashboard` called;
    - nothing installed, no consent → exit 4 `NOT_INSTALLED` (message names the install command and the ~1 GB size), npm/npx not called;
    - `DASHBOARD_ALLOW_INSTALL=1`, npm install succeeds → `npm install -g @blackbelt-technology/pi-agent-dashboard@latest --allow-remote=all` called, then the installed CLI `start --port <p>`; prints `INSTALL=global`; npx not called;
    - consent, npm install fails (EACCES) → `npx -y @blackbelt-technology/pi-agent-dashboard@latest start --port <p>` called; prints `INSTALL=npx-cache` and the non-durable warning;
    - consent, Node 20 → exit 1 naming 22.19, npm/npx not called;
    - consent, no npm resolvable → exit 1, nothing downloaded;
    - CLI found only under `$(npm prefix -g)/bin` (not on PATH) after a prior install → launched without consent;
    - every npm/npx invocation pins `@latest` (never `next` or an unpinned name);
    - `CLAUDE_CODE_IS_COWORK=1` → exit 2 `SANDBOX`, no probe;
    - `DASHBOARD_PORT=abc` → exit 1, no probe;
    - config.json port is honoured;
    - a launcher that never yields health → exit 1 naming the server log (inject a short `DASHBOARD_READY_TIMEOUT_S` test override).

  Verify: red.
- [ ] 2.2 Implement `packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh` per design D2–D5:
  - POSIX `sh`; stdout only `STATUS=` / `BASE=`, diagnostics on stderr;
  - curl probe 3 × 5 s, starting only on curl exit 7;
  - launch order CLI → login-shell CLI → npm-global-prefix CLI → `open -b` → consented install (gated by `DASHBOARD_ALLOW_INSTALL=1`: prerequisite check, `npm install -g …@latest --allow-remote=all`, resolve the installed CLI, start; npx `…@latest start` only if the install fails);
  - passes `--port` (and `--pi-port` when `DASHBOARD_PI_PORT` is set) to every launcher;
  - readiness wait of 60 s (overridable for tests only).

  Start from `openspec/changes/add-claude-code-plugin/spike/ensure-dashboard.sh`. Verify: test 2.1 green, and `sh -n` passes.
- [ ] 2.3 Write `packages/claude-plugin/skills/pi-dashboard-bootstrap/SKILL.md`:
  - frontmatter `description` with the triggers: pi dashboard, pi sessions, start/open the dashboard, connection refused;
  - one imperative command, `sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"`, as a single foreground call, never in the background;
  - per-exit-code instructions, including asking for consent on exit 4 ("install the latest pi-dashboard release globally with npm, ~1 GB, about a minute; adds the `pi-dashboard` command and the pi bridge") and re-running with `DASHBOARD_ALLOW_INSTALL=1`; relaying the non-durable warning on `INSTALL=npx-cache`; no workarounds on exit 2;
  - use the literal `BASE` URL afterwards.

  Verify: `node scripts/check-skill-frontmatter.mjs` reports no error for it.

## 3. Control skill derived from the extension skill (TDD)

- [ ] 3.1 Write `scripts/__tests__/claude-plugin-parity.test.mjs`.
  - Asserts that `references/api-reference.md`, `references/recipes.md` and `scripts/dashboard-api.sh` under `packages/claude-plugin/skills/pi-dashboard/` are byte-identical to `packages/extension/.pi/skills/pi-dashboard/`.
  - The failure message names `node scripts/sync-claude-plugin.mjs`.
  - Also asserts that the plugin `SKILL.md` contains no `dashboard-bus` reference and that no `commands/` directory exists.

  Verify: red.
- [ ] 3.2 Implement `scripts/sync-claude-plugin.mjs`: copy the three files and preserve the executable bit on `dashboard-api.sh`. Verify: after running it, test 3.1 is green for the byte checks.
- [ ] 3.3 Write the plugin `skills/pi-dashboard/SKILL.md`. It is curl-first and covers:
  - get `BASE` from the bootstrap skill first;
  - the common read and command calls (`GET /api/sessions`, `GET /api/health`, `POST /api/session/:id/prompt|abort`, `POST /api/session/spawn`), with pointers to `references/`;
  - an explicit statement that REST is the command path inside Claude;
  - the token rules from the spec (on 401 / `local_proof_required`: ask for `pi-dashboard token create --label claude-code --tier <tier>`, Bearer header only, never written or echoed).

  Verify: test 3.1 green; frontmatter guard clean.
- [ ] 3.4 Confirm that every REST route the plugin `SKILL.md` names is registered on the server: a grep or a `printRoutes` check in the parity test against `packages/server/src/routes/`. Verify: the test asserts each named route exists.

## 4. Version lockstep

- [ ] 4.1 Add a test in `scripts/__tests__/` asserting that the `plugin.json` `version` equals the root `package.json` `version`. Verify: green right after 1.2. Then confirm it goes red when the root version alone is changed in a temp copy, or via a dependency-injected fixture following the `sync-versions-spec.js` pattern.
- [ ] 4.2 Extend `scripts/sync-versions.js` to stamp the root version into `packages/claude-plugin/.claude-plugin/plugin.json`, reporting the change like its other rewrites. Verify: a `sync-versions` test or fixture shows the stamp, and running the script on a clean tree leaves no diff.
- [ ] 4.3 Add one line to `.pi/skills/release-cut/SKILL.md` step 5 noting that the plugin version is stamped by `sync-versions.js`. Verify: grep shows the note.

## 5. Docs and DOX

- [ ] 5.1 Add `packages/claude-plugin/AGENTS.md` with rows for `.claude-plugin/plugin.json`, `README.md`, `LICENSE`, the bootstrap skill and its script, and the control skill and its derived files. Add rows for the new scripts and tests to `scripts/AGENTS.md` and `scripts/__tests__/AGENTS.md`, and a row for `.claude-plugin/marketplace.json` in the root non-source area per the repo DOX convention. Verify: the `dox-byte-gate` and DOX lint scripts pass.
- [ ] 5.2 Delegate to DocScribe, in caveman style:
  - a `docs/faq.md` entry "How do I use pi-dashboard from Claude Code / Claude Desktop?": install via marketplace, the surface table, the consent gate, BUSY/PORT_CONFLICT meanings, strict-mode tokens;
  - a README install-paths row.

  Verify: entries present; `node scripts/check-conventions.mjs` clean.

## 6. Integration check (local, isolated instance)

- [ ] 6.1 Run the headless end-to-end check against an isolated instance (temp HOME, ports 18555/18556; never 8000):
  ```
  DASHBOARD_HOME=<tmp> DASHBOARD_PORT=18555 DASHBOARD_PI_PORT=18556 claude -p "Is my pi dashboard running? …" --plugin-dir packages/claude-plugin --allowedTools "Bash Skill Read"
  ```
  Verify:
  - the transcript shows a single `ensure-dashboard.sh` call and then a curl to `/api/sessions`;
  - `lsof -iTCP:8000` is unchanged;
  - `HOME=<tmp> pi-dashboard stop --port 18555 --pi-port 18556` cleans up.
- [ ] 6.2 Run `npm test` for the `scripts` project plus `node scripts/check-skill-frontmatter.mjs`. Verify: all green.

## 7. QA (manual, post-merge; may be marked done and tested later)

- [ ] 7.1 Claude Code: run `/plugin marketplace add BlackBeltTechnology/pi-agent-dashboard --sparse .claude-plugin packages/claude-plugin`, then `/plugin install pi-dashboard@pi-agent-dashboard`. Verify: install succeeds; "start my pi dashboard" works with the dashboard down and with it already up.
- [ ] 7.2 Customize > Plugins > Add marketplace (same repo). Verify: the install succeeds and the plugin appears as a synced plugin in Claude Code after `/reload-plugins`. If the install fails on repo size, open the mirror-repo fallback (design D6 / Migration step 4).
- [ ] 7.3 Cloud Cowork task "start my pi dashboard". Verify: either the `SANDBOX` message, or `NOT_INSTALLED` with a consent question; no silent install. Record the environment marker observed (closes the design Open Question).
- [ ] 7.3a Fresh machine without pi-dashboard (or a temp HOME plus a temp npm prefix via `npm_config_prefix`): consent → global install of `@latest` → started. Verify: `INSTALL=global`; `~/.pi/agent/settings.json` bridge path points into the global prefix, not `~/.npm/_npx`; a second session starts without asking.
- [ ] 7.4 Electron-only machine (no CLI on PATH, app installed). Verify: the app opens and `STATUS=started` is reported.
- [ ] 7.5 Windows Claude Code with the CLI installed. Verify: the bootstrap runs under the provided shell and reports `BASE`.
- [ ] 7.6 Strict mode (`requireLocalProof: true`): ask Claude to send a prompt to a session. Verify: Claude asks for a `token create` token, uses the Bearer header, and the token does not appear in files.
