## 1. Plugin skeleton and manifests

- [x] 1.1 Write `scripts/__tests__/claude-plugin-structure.test.mjs` (exemplar `scripts/__tests__/skill-frontmatter.test.mjs`) asserting the plugin layout. Triple: plugin tree + `plugin.json` · structure test · required keys present, no `displayName`, no `bin/`/`.mcp.json`/`hooks/`, README ≥ 40 words outside fences, a LICENSE. Verify red first (test-plan #E1)
- [x] 1.2 Add to the structure test the marketplace check (exemplar as 1.1). Triple: root `.claude-plugin/marketplace.json` · structure test · `name` = `pi-agent-dashboard`, non-empty `description`, a `pi-dashboard` entry whose `source` resolves to `packages/claude-plugin` (test-plan #E2)
- [x] 1.3 Create `packages/claude-plugin/.claude-plugin/plugin.json` (version = the root version), `README.md` (what it does, how to install, the surfaces table, localhost-only data) and `LICENSE`. Create the root `.claude-plugin/marketplace.json`. Verify: E1 and E2 green, and `claude plugin validate packages/claude-plugin` and `claude plugin validate .` pass locally

## 2. Bootstrap script `ensure-dashboard.sh` (TDD)

All tests in this section live in `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs`.
- **Harness exemplar:** `scripts/__tests__/rebuild-scripts-gate.test.mjs` (`spawnSync` with an injected env).
- **Harness conventions:** the test-plan "Harness conventions" section: temp `HOME` record fixtures, stub `pi-dashboard`/`npm`/`npx`/`node`/`open`/`uname` that log argv+env, Node fixture servers, and `PIDB_TEST=1` timing overrides.

- [x] 2.1 Build the shared harness helpers: fixture-server modes `dashboard`/`wrong-pid`/`no-pid`/`recovery`/`foreign-html`/`hung`/`refused`, the stub-bin writer, the live/dead pid helpers, and the record writers. Verify: a smoke test can start and stop each fixture mode
- [x] 2.2 Test the already-up path. Triple: fixture `dashboard`, lock meta pid = health pid · run · stdout exactly `STATUS=already-running` + `BASE`, exit 0, no launcher invoked (test-plan #E3)
- [x] 2.3 Test an ok body without a pid. Triple: fixture `no-pid` · run · `STATUS=port-conflict`, exit 5, no launcher (test-plan #E4)
- [x] 2.4 Test a pid that matches no record. Triple: fixture `wrong-pid`, records never match · run with record-poll override 1 s · `STATUS=port-conflict`, exit 5 (test-plan #E5)
- [x] 2.5 Test the record catching up. Triple: fixture `wrong-pid`, lock meta rewritten to match after 0.5 s · run · `STATUS=already-running` (test-plan #E6)
- [x] 2.6 Test recovery mode. Triple: fixture `recovery` · run · `STATUS=recovery`, exit 3, no launcher (test-plan #E7)
- [x] 2.7 Test a foreign HTML service. Triple: fixture `foreign-html` · run · `STATUS=port-conflict`, exit 5 (test-plan #E8)
- [x] 2.8 Test a starting server. Triple: refused port, lock meta names a live pid, fixture binds after 2 s · run · `already-running`, no launcher, `server.pid` and lock meta byte-identical (test-plan #E9)
- [x] 2.9 Test unusable env ports. Triple: config 18555, `DASHBOARD_PORT` ∈ {abc, 0, 65536, 70000, 1e4, " 18555 "} · run · each probes 18555 (test-plan #E10)
- [x] 2.10 Test the port boundaries. Triple: `DASHBOARD_PORT` ∈ {1, 65535} · run · the probed URL uses that port, read from the curl argv log (test-plan #E11)
- [x] 2.11 Test port precedence. Triple: combinations of `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` / config / none · run · PI → DASHBOARD → config → 8000 (test-plan #E12)
- [x] 2.12 Test nested config keys. Triple: config with a nested `port: 9` before top-level 18555 · run · probes 18555 (test-plan #E13)
- [x] 2.13 Test the CLI argv and HOME. Triple: refused, no records, stub CLI · run · CLI argv exactly `start --port <resolved>`, and the stub sees the caller's `HOME` (test-plan #E14)
- [x] 2.14 Test the stdout protocol. Triple: stub CLI prints to stdout · start path · script stdout only `STATUS=started` + `BASE`, CLI text on stderr (test-plan #E15)
- [x] 2.15 Test another port with a config-sourced port. Triple: config port refuses, lock meta live on 18600 with a verified fixture · run · `already-running`, `BASE=…:18600`, no launcher (test-plan #E16)
- [x] 2.16 Test another port with an env-sourced port. Triple: `DASHBOARD_PORT=18999`, lock meta live on 18600 · run · `STATUS=failed`, exit 1, stderr names 18600, no launcher (test-plan #E17)
- [x] 2.17 Test the nvm lookup. Triple: fake nvm `v9.0.0`/`v22.19.0`/`v24.15.0` bins, no CLI on PATH · start path · the v24.15.0 executable is invoked (test-plan #E18)
- [x] 2.18 Test the login-shell lookup. Triple: stub `SHELL` printing noise + `/x/not-it` + `/y/bin/pi-dashboard` · run · `/y/bin/pi-dashboard` invoked, shell argv contains `-lc` and no `-i` (test-plan #E19)
- [x] 2.19 Test the npx-cache lookup. Triple: npx cache with a newer `0.0.0-test-x` and an older `0.9.0` · run · the 0.9.0 copy is invoked, with a non-durable note (test-plan #E20)
- [x] 2.20 Test the macOS app source. Triple: no CLI, stub `uname`=Darwin, stub `open` ok then fixture boots, config port · run · `open -g -b com.blackbelt-technology.pi-dashboard`, `STATUS=started` (test-plan #E21)
- [x] 2.21 Test that `open` is skipped. Triple: stub `uname`=Linux, or an env-sourced port · run · `open` never invoked, `STATUS=not-installed` (test-plan #E22)
- [x] 2.22 Test the no-consent path. Triple: no CLI, no app, no `--install` · run · `STATUS=not-installed`, exit 4, npm/npx never invoked, install command on stderr (test-plan #E23)
- [x] 2.23 Test the global install. Triple: `--install`, stub npm succeeds with version 0.9.0 · run · npm argv `install -g @blackbelt-technology/pi-agent-dashboard@latest` with `npm_config_allow_remote=all` in npm's env only; CLI started without it; `INSTALL=global`, `STATUS=started` (test-plan #E24)
- [x] 2.24 Test the prerelease refusal. Triple: `--install`, installed version `0.10.0-rc.1` · run · `STATUS=failed`, CLI never started (test-plan #E25)
- [x] 2.25 Test the usable-Node boundaries. Triple: `--install`, stub node v20.11.0 / v22.18.0 / v22.19.0 / v24.0.0 / v24.2.0 / v24.3.0 / v26.9.0 / v27.0.0 · run · 20.11.0, 22.18.0, 24.2.0, 27.0.0 → `failed`, exit 1, no npm; the rest → npm invoked (test-plan #E26)
- [x] 2.26 Test that the Node range matches the server. Triple: script source + root `package.json` + shared `isUsableNodeVersion` · static/parity test · the script constants equal `engines.node` and the gate's excluded range; the script's decision equals the gate's for every E26 version (test-plan #E27)
- [x] 2.27 Test the sandbox markers. Triple: each of `CLAUDE_CODE_IS_COWORK=1`, `CLAUDE_CODE_REMOTE=1`, `CLAUDE_CONFIG_DIR=/sessions/x/mnt/.claude` · run · `STATUS=sandbox`, exit 2, empty stub log, no lock dir (test-plan #E28)
- [x] 2.28 Test local markers. Triple: local markers only (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`) with a verified fixture · run · `already-running`, not `sandbox` (test-plan #E29)
- [x] 2.29 Test `--check`. Triple: fixture `dashboard` / `refused` / `wrong-pid` · `--check` · exit 0 only for `dashboard`; never a lock dir or a launcher (test-plan #E30)
- [x] 2.30 Test a dead-holder lock. Triple: lock dir with a holder naming a dead pid · start path · reclaimed, one launcher call, lock dir gone afterwards (test-plan #E31)
- [x] 2.31 Test a fresh holder-less lock. Triple: lock dir without holder, created now · run with lock-wait override 3 s · `STATUS=busy`, exit 3, no launcher, lock untouched (test-plan #E32)
- [x] 2.32 Test an old holder-less lock. Triple: lock dir without holder, mtime 2 min ago · run · reclaimed, launcher invoked (test-plan #E33)
- [x] 2.33 Static-test the script source. Triple: script source · static test · no `rm -rf` / `rm -r`; `${HOME:?}` guards on HOME-derived paths (test-plan #E34)
- [x] 2.34 Test the latency budget. Triple: verified fixture up, lock meta present · 5 runs each of the script and `--check` · max wall time ≤ 5 s (test-plan #P1)
- [x] 2.35 Test a hung server. Triple: fixture `hung` + records · run · `STATUS=busy`, exit 3, log path on stderr, no launcher, records byte-identical (test-plan #X1)
- [x] 2.36 Test a live pid with no answer. Triple: refused, lock meta live pid, nothing answers · run with poll override 2 s · `STATUS=busy`, exit 3, no launcher (test-plan #X2)
- [x] 2.37 Test corrupt metadata. Triple: refused, lock meta truncated `{"pid":` · run · no launcher, `STATUS=busy` (test-plan #X3)
- [x] 2.38 Test the real refusal window. Triple: refused for 3 s, then fixture binds, no window override · run · `already-running`, no launcher (test-plan #X4)
- [x] 2.39 Test concurrent runs. Triple: refused, no records, stub CLI boots a fixture after 2 s · two parallel runs · exactly one CLI invocation; ready statuses `started` + `already-running` (test-plan #X5)
- [x] 2.40 Test a failing launcher. Triple: stub CLI `start` exits 1 · run · `STATUS=failed`, exit 1, npm/npx/open never invoked (test-plan #X6)
- [x] 2.41 Test the readiness timeout. Triple: stub CLI exits 0, no server appears · run with readiness override 2 s · `STATUS=failed`, exit 1, `server.log` path on stderr (test-plan #X7)
- [x] 2.42 Test the install fallback. Triple: `--install`, stub npm `install -g` EACCES · run · prefix hint without a `sudo` recommendation; `npm exec --yes --package=…@latest -- node -e 0` with `npm_config_allow_remote=all`; `npx --yes …@latest start --port <p>` without it; `INSTALL=npx-cache` + non-durable warning (test-plan #X8)
- [x] 2.43 Test missing npm. Triple: `--install`, no npm resolvable · run · `STATUS=failed`, exit 1, nothing downloaded (test-plan #X9)
- [x] 2.44 Test a re-bound port. Triple: verified run, then the fixture is replaced by `wrong-pid` on the same port · `--check` · non-zero, `STATUS=port-conflict` (test-plan #X10)
- [x] 2.45 Implement `packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh` per spec and design D2–D5, starting from `openspec/changes/add-claude-code-plugin/spike/ensure-dashboard.sh`. Verify: every test in 2.2–2.44 green and `sh -n` passes
- [x] 2.46 Write `packages/claude-plugin/skills/pi-dashboard-bootstrap/SKILL.md`:
  - one foreground command `sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"` with a 600 s timeout, never in the background;
  - per-`STATUS` instructions;
  - the consent question (machine, ~1 GB, adds the command + bridge, decline in Cowork/web) before re-running with `--install`;
  - no workarounds on `sandbox`;
  - re-run after a tool timeout.

  Verify: 3.2 green for this skill

## 3. Control skill `pi-dashboard-control` (TDD)

- [x] 3.1 Add to `scripts/__tests__/claude-plugin-structure.test.mjs` (exemplar `scripts/__tests__/skill-frontmatter.test.mjs`) a forbidden-reference scan. Triple: every file under `packages/claude-plugin/` · scan · none contains `dashboard-bus`, `bus-client`, `dashboard-api.sh`, `WebSocket bus`, `commands/dashboard-` (test-plan #E37)
- [x] 3.2 Add a skill-content contract test (exemplar as 3.1). Triple: both `SKILL.md` files · static test:
  - bootstrap: one command, 600 s timeout, "never background";
  - control: `token create --label claude-code --tier control`, `-H @`, `--check &&` chaining, no `-v`/`--trace`;
  - descriptions ≤ 400 chars, valid frontmatter.

  (test-plan #E39)
- [x] 3.3 Write `scripts/__tests__/claude-plugin-parity.test.mjs` (exemplar `scripts/__tests__/skill-frontmatter.test.mjs`). Triple: source `api-reference.md` · apply the transform · the shipped file equals the source minus the "WebSocket bus verbs" section, byte for byte; the failure names `node scripts/sync-claude-plugin.mjs` (test-plan #E35)
- [x] 3.4 Add a missing-heading test to the parity test. Triple: a source copy with the heading renamed · run `sync-claude-plugin.mjs` on it · non-zero exit naming the missing heading (test-plan #E36)
- [x] 3.5 Add a route-existence test to the parity test (exemplar static scan: `scripts/__tests__/dependency-declarations.test.mjs`). Triple: every `METHOD /api/...` in the control `SKILL.md` · match against route registrations in `packages/server/src/` · each method + path is registered (test-plan #E38)
- [x] 3.6 Implement `scripts/sync-claude-plugin.mjs` (section drop; fail on a missing heading) and generate `packages/claude-plugin/skills/pi-dashboard-control/references/api-reference.md`. Verify: E35 and E36 green
- [x] 3.7 Write `packages/claude-plugin/skills/pi-dashboard-control/SKILL.md`:
  - curl against `BASE` from the bootstrap;
  - health, sessions, prompt, abort, spawn calls;
  - REST is the command path;
  - the token rules (401, or 403 `local_proof_required` → ask for a `control`-tier token; prefer the header file with `--check && curl -H @…`; never create the file; no `-v`).

  Verify: E37, E38 and E39 green

## 4. Version lockstep

- [x] 4.1 Write `scripts/__tests__/claude-plugin-version.test.mjs` (exemplar `scripts/__tests__/nightly-verdaccio-publish.test.mjs`) asserting equality. Triple: `plugin.json` + root `package.json` · test · versions equal (test-plan #E40)
- [x] 4.2 Add a stamping test to the version test. Triple: temp repo skeleton with a bumped root version · run `sync-versions.js` · `plugin.json` = new version, and a second run makes no diff (test-plan #E41)
- [x] 4.3 Add a release-cut doc check to the version test. Triple: `.pi/skills/release-cut/SKILL.md` · static test · step 6 `git add` includes `packages/claude-plugin/.claude-plugin/plugin.json`, and a version-equality check precedes `git tag` (test-plan #E42)
- [x] 4.4 Write `scripts/__tests__/claude-plugin-publish-contract.test.mjs` (exemplar `packages/shared/src/__tests__/publish-version-step-contract.test.ts`; lives in the `scripts` project because `packages/shared/src/AGENTS.md` is at its byte cap). Triple: `.github/workflows/publish.yml` · contract test · the `publish` job has a step reading `git show "$RELEASE_TAG:packages/claude-plugin/.claude-plugin/plugin.json"` ordered before `node scripts/sync-versions.js` and before any publish step (test-plan #E43)
- [x] 4.5 Implement:
  - the `plugin.json` stamp in `scripts/sync-versions.js`;
  - the tag-push preflight step in `.github/workflows/publish.yml`;
  - in `.pi/skills/release-cut/SKILL.md`: step 6 staging, the "No other files" text, a version check before `git tag`, and a manual `claude plugin validate` step.

  Verify: 4.1–4.4 green; `node scripts/sync-versions.js` on a clean tree leaves no diff

- [x] 4.6 Write `scripts/__tests__/claude-plugin-zip.test.mjs` (exemplar `scripts/__tests__/nightly-verdaccio-publish.test.mjs`). Triple: `build-claude-plugin-zip.mjs` · run into a temp dir, then `zipinfo -1` · layout per test-plan #E44, and mismatch/missing `--version` refused with no zip per #E45. Verify red first
- [x] 4.7 Implement `scripts/build-claude-plugin-zip.mjs` (design D10): `--version`, `--out`; version gate; `zip -r -X -q` over `packages/claude-plugin/`, excluding `.DS_Store`. Verify: 4.6 green
- [x] 4.8 Add to `scripts/__tests__/claude-plugin-publish-contract.test.mjs` (from 4.4) the zip-wiring check. Triple: `publish.yml` · contract test · `github-release` runs the build script before `Create GitHub Release`, and `files` includes `claude-plugin-dist/*.zip` (test-plan #E46). Verify red first
- [x] 4.9 Wire `publish.yml`: a `github-release` step running `node scripts/build-claude-plugin-zip.mjs --version "${{ needs.resolve.outputs.version }}" --out claude-plugin-dist`, and `claude-plugin-dist/*.zip` in the release `files`. Add a `release-cut` step 8 line listing the zip among the attached assets. Verify: 4.8 green

## 5. Docs and DOX

- [x] 5.1 Add `packages/claude-plugin/AGENTS.md` rows (manifest, README, LICENSE, both skills, script, derived reference). Add rows for the new scripts and tests to `scripts/AGENTS.md`, `scripts/__tests__/AGENTS.md` and `packages/shared/src/__tests__/AGENTS.md`. Add a row for `.claude-plugin/marketplace.json` per the repo DOX convention. Verify: the DOX lint and `dox-byte-gate` pass
- [x] 5.2 Delegate to DocScribe, in caveman style (include the release zip as the claude.ai upload path):
  - a `docs/faq.md` entry "How do I use pi-dashboard from Claude Code / Claude Desktop?": marketplace install, the surfaces table, the consent question, the `STATUS` meanings, strict-mode tokens via a header file;
  - a README install-paths row.

  Verify: `node scripts/check-conventions.mjs` clean

## 6. Integration check (local, isolated)

- [x] 6.1 Run the headless end to end check against a temp `HOME` and port 18555/18556 (never 8000). With `--plugin-dir packages/claude-plugin`, prompt "Is my pi dashboard running? …". Verify:
  - the transcript shows one `ensure-dashboard.sh` call, then curl to `/api/sessions`;
  - `lsof -iTCP:8000 -sTCP:LISTEN` is unchanged;
  - cleanup with `HOME=<tmp> pi-dashboard stop --port 18555 --pi-port 18556`.

  Done 2026-10-12 as a direct script run against the real CLI (temp `HOME`, ports 18555/18556): `started` → `already-running` → `--check && curl /api/sessions` → port 8000 unchanged → stop. `claude -p` could not authenticate under a temp `HOME` ("Not logged in"), so the natural-language skill-selection leg is covered by manual task 7.9 (#M9).
- [x] 6.2 Run `npm test` (`scripts` + `shared` projects) and `node scripts/check-skill-frontmatter.mjs`. Verify all green. Result: every `claude-plugin-*` test and the frontmatter guard green; the remaining 7 failing files (`tsc7-wrapper`, `verify-published-imports`, `gateway-listener-wiring`, `host-gate-upgrade`, `mcp-manifest-completeness` — `PUT /api/mcp-client/servers/:name/project-override` has no ROUTE_TIERS entry on `origin/develop` —, `resource-activation-*`, `ws-origin-gate`, `rendezvous`) are outside this change's paths (sandbox/HOME/socket/tsc environment and an in-flight develop route).

## 7. Manual QA (post-merge)

- [ ] 7.1 claude.ai Customize > Plugins > Upload plugin (zip of `packages/claude-plugin`): accepted, both skills listed (test-plan: manual-only, #M1)
- [ ] 7.2 Cowork/claude.ai "Add marketplace" `BlackBeltTechnology/pi-agent-dashboard` + install: succeeds despite repo size, otherwise start the mirror-repo fallback (test-plan: manual-only, #M2)
- [ ] 7.3 `claude plugin validate` (plugin + marketplace) and `/plugin marketplace add … --sparse .claude-plugin packages/claude-plugin` + install: validation passed; inventory 2 skills, 0 agents/hooks/MCP (test-plan: manual-only, #M3)
- [ ] 7.4 Cloud Cowork task "start my pi dashboard": either the `sandbox` message, or `not-installed` plus a consent question naming the machine; no silent install; record the env markers (test-plan: manual-only, #M4)
- [ ] 7.5 Desktop app Code tab: `env | grep CLAUDE` shows no sandbox marker and the bootstrap works. Gates announcing the plugin (test-plan: manual-only, #M5)
- [ ] 7.6 macOS with only pi-dashboard.app installed: the app opens in the background and the bootstrap reports `STATUS=started` (test-plan: manual-only, #M6)
- [ ] 7.7 Windows Claude Code with the CLI (Git Bash): the bootstrap reports `BASE`; the lock and `find -mmin` behave (test-plan: manual-only, #M7)
- [ ] 7.8 `requireLocalProof: true`, "send a prompt to session X": Claude asks for a `control`-tier token, prefers the header file, chains `--check && curl -H @…`, and does not echo the token (test-plan: manual-only, #M8)
- [ ] 7.9 Plugin installed, dashboard down, no CLI, "is my pi dashboard running?": the bootstrap skill is chosen; one foreground call with a 600 s timeout; the consent question lists machine / size / bridge / Cowork-decline before `--install` (test-plan: manual-only, #M9)
- [ ] 7.10 Temp `HOME` + temp npm prefix, consent → `--install`: `INSTALL=global`; the bridge path in `~/.pi/agent/settings.json` is inside the prefix; a second session starts without consent (test-plan: manual-only, #M10)
