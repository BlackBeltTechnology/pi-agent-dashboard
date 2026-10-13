# Test Plan — add-claude-code-plugin

Stage: design   Generated: 2026-10-12

## Assumed answers (the clarification form returned no result; the user said "go on")

- **A1:** the bootstrap must report an already-running dashboard within **≤ 5 s** (P1).
- **A2:** agent-behaviour checks (skill selection, consent question, sandbox relay, token rules) are **manual-only**. They are non-deterministic and need model credentials.
- **A3:** Windows (Git Bash) behaviour is **manual-only**.
- **A4:** `claude plugin validate` and the marketplace install stay a **manual release-cut step**. No CI job installs the Claude CLI.

Change any of these by editing the row's disposition before `ship-it`.

## Harness conventions (L1 script tests)

- Location: `scripts/__tests__/claude-plugin-*.test.mjs` (collected by `scripts/vitest.config.ts`). Exemplar for spawning a script with an injected environment: `scripts/__tests__/rebuild-scripts-gate.test.mjs`.
- `sh ensure-dashboard.sh` runs with:
  - a temp `HOME` holding `.pi/dashboard/{config.json,server.lock.meta.json,server.pid}` fixtures;
  - a stub `PATH` dir whose `pi-dashboard`, `npm`, `npx`, `node`, `open` and `uname` record argv and environment to a log file. The stub `pi-dashboard start` can boot a fixture dashboard and write lock metadata;
  - real `curl` against Node fixture HTTP servers on ephemeral `127.0.0.1` ports.
- Health fixture modes: `dashboard` (`{"ok":true,"pid":<lock pid>}`), `wrong-pid`, `no-pid`, `recovery` (`{"ok":false,"mode":"recovery"}`), `foreign-html`, `hung` (accepts, never replies), `refused` (no listener).
- A "live pid" fixture is a `sleep 600` child; a "dead pid" is a reaped child's pid.
- Timing windows (refusal 10 s, record poll 10 s, live-pid poll 60 s, readiness 60 s, lock wait 170 s) are shortened through test-only environment overrides that the script honours (design D2). Each spec value has one test without the override where feasible (E13).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Installable on every surface | static / decision-table | L1 | automated | `packages/claude-plugin/` tree + `plugin.json` | structure test | required keys present; no `displayName`; no `bin/`, `.mcp.json`, `hooks/`; README ≥ 40 words outside fences; LICENSE or `license` |
| E2 | Marketplace manifest | static | L1 | automated | root `.claude-plugin/marketplace.json` | structure test | `name`=`pi-agent-dashboard`, `description` non-empty, `pi-dashboard` entry, `source` resolves to `packages/claude-plugin` |
| E3 | Identity / already up | decision-table | L1 | automated | fixture `dashboard`, lock meta pid = health pid | run script | stdout exactly `STATUS=already-running` + `BASE=http://localhost:<p>`; exit 0; no launcher stub invoked |
| E4 | Identity | decision-table | L1 | automated | fixture `no-pid` (`{"ok":true}`) | run | `STATUS=port-conflict`, exit 5, no launcher |
| E5 | Identity | decision-table | L1 | automated | fixture `wrong-pid`, records never match | run (record-poll override 1 s) | `STATUS=port-conflict`, exit 5, no launcher |
| E6 | Identity | decision-table | L1 | automated | fixture `wrong-pid`; lock meta rewritten to the matching pid 0.5 s into the run | run | `STATUS=already-running`, exit 0 |
| E7 | Identity | decision-table | L1 | automated | fixture `recovery` | run | `STATUS=recovery`, exit 3, no launcher |
| E8 | Identity | EP | L1 | automated | fixture `foreign-html` (200 text/html) | run | `STATUS=port-conflict`, exit 5, no launcher |
| E9 | Never started over | state-transition | L1 | automated | refused port; lock meta names a live pid; fixture dashboard binds after 2 s | run | `STATUS=already-running`; no launcher; `server.pid` and lock meta byte-identical before/after |
| E10 | Port resolution | BVA | L1 | automated | config `port`=18555; `DASHBOARD_PORT` ∈ {`abc`,`0`,`65536`,`70000`,`1e4`," 18555 "} | run with fixture on 18555 | each probes 18555 (unusable ignored) |
| E11 | Port resolution | BVA | L1 | automated | `DASHBOARD_PORT` ∈ {`1`,`65535`}, fixture on that port where bindable (65535 asserted via the curl argv log) | run | the probed URL uses the env port |
| E12 | Port resolution | decision-table | L1 | automated | combinations of `PI_DASHBOARD_PORT`, `DASHBOARD_PORT`, config, none | run | precedence PI → DASHBOARD → config → 8000 (argv log) |
| E13 | Port resolution | EP | L1 | automated | config.json with a nested `{"tunnel":{"port":9}}` before top-level `"port":18555` | run | probes 18555, not 9 |
| E14 | Launch passes port | static/argv | L1 | automated | refused, no records, stub CLI | run | CLI argv exactly `start --port <resolved>`; stub sees `HOME` equal to the caller's `HOME` |
| E15 | Line protocol | invariant | L1 | automated | stub CLI prints `Dashboard server started …` to stdout | run (start path) | script stdout contains only `STATUS=started` and `BASE=…`; the CLI text appears on stderr |
| E16 | Other port, config-sourced | decision-table | L1 | automated | port from config refuses; lock meta live pid, `httpPort` 18600 with a verified fixture | run | `STATUS=already-running`, `BASE=http://localhost:18600`, no launcher |
| E17 | Other port, env-sourced | decision-table | L1 | automated | `DASHBOARD_PORT=18999`; lock meta live on 18600 | run | `STATUS=failed`, exit 1, stderr names 18600, no launcher |
| E18 | Launch order | EP | L1 | automated | no CLI on PATH; fake `~/.nvm/versions/node/{v9.0.0,v22.19.0,v24.15.0}/bin/pi-dashboard` | run (start path) | the `v24.15.0` executable is invoked |
| E19 | Launch order | EP | L1 | automated | stub `SHELL` printing noise lines + `/x/not-it` + `/y/bin/pi-dashboard` | run | `/y/bin/pi-dashboard` invoked; the recorded shell argv contains `-lc` and no `-i` |
| E20 | Launch order | EP | L1 | automated | npx cache with two copies: newer `0.0.0-test-x`, older `0.9.0` | run | the `0.9.0` copy is invoked; stderr says non-durable |
| E21 | macOS app | decision-table | L1 | automated | no CLI; stub `uname`=Darwin, stub `open` exit 0 then fixture boots; port from config | run | `open -g -b com.blackbelt-technology.pi-dashboard` recorded; `STATUS=started` |
| E22 | macOS app | decision-table | L1 | automated | as E21 but stub `uname`=Linux, or the port comes from `DASHBOARD_PORT` | run | `open` never invoked; `STATUS=not-installed` |
| E23 | No consent | EP | L1 | automated | no CLI, no app, no `--install` | run | `STATUS=not-installed`, exit 4; npm/npx never invoked; stderr shows the install command |
| E24 | Consented install | argv/env | L1 | automated | `--install`; stub npm succeeds and drops a CLI under a fake prefix with version `0.9.0` | run | npm argv `install -g @blackbelt-technology/pi-agent-dashboard@latest` with `npm_config_allow_remote=all` in npm's env; CLI started **without** that variable; stdout `INSTALL=global`, `STATUS=started` |
| E25 | Consented install | EP | L1 | automated | `--install`; installed version `0.10.0-rc.1` | run | `STATUS=failed`; CLI never started |
| E26 | Consented install | BVA | L1 | automated | `--install`; stub node reports `v20.11.0` / `v22.18.0` / `v22.19.0` / `v24.0.0` / `v24.2.0` / `v24.3.0` / `v26.9.0` / `v27.0.0` | run | 20.11.0, 22.18.0, 24.2.0, 27.0.0 → `STATUS=failed`, exit 1, npm not invoked; 22.19.0, 24.0.0, 24.3.0, 26.9.0 → npm invoked |
| E27 | Consented install | static | L1 | automated | script source + root `package.json` + the shared `isUsableNodeVersion` gate | test | the script's range constants equal `engines.node` and the gate's excluded range; for each version in E26 the script decision equals `isUsableNodeVersion` |
| E28 | Sandbox refusal | decision-table | L1 | automated | each of `CLAUDE_CODE_IS_COWORK=1`, `CLAUDE_CODE_REMOTE=1`, `CLAUDE_CONFIG_DIR=/sessions/x/mnt/.claude` | run | `STATUS=sandbox`, exit 2; no curl/launcher/lock activity (stub log empty, no lock dir) |
| E29 | Sandbox refusal | EP | L1 | automated | local markers only (`CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ID=x`) | run with verified fixture | not `sandbox`; `already-running` |
| E30 | Verify-only | decision-table | L1 | automated | `--check` with fixture `dashboard` / `refused` / `wrong-pid` | run | exit 0 only for `dashboard`; never a lock dir; never a launcher |
| E31 | Bootstrap lock | state-transition | L1 | automated | lock dir with holder naming a dead pid | run (start path) | lock reclaimed, launcher invoked once, lock dir gone afterwards |
| E32 | Bootstrap lock | state-transition | L1 | automated | lock dir without holder, created now | run (lock-wait override 3 s) | treated as live: `STATUS=busy`, exit 3, no launcher, lock dir untouched |
| E33 | Bootstrap lock | state-transition | L1 | automated | lock dir without holder, mtime set to 2 min ago (`touch -t`) | run | reclaimed; launcher invoked |
| E34 | Bootstrap lock | static | L1 | automated | script source | test | no `rm -rf` / `rm -r`; every path built from `HOME` uses a `${HOME:?}` guard |
| E35 | Control skill derivation | static | L1 | automated | source `api-reference.md` | run the transform | derived = the source minus the "WebSocket bus verbs" section; the parity test compares the shipped file byte for byte |
| E36 | Control skill derivation | EP | L1 | automated | a source copy with the heading renamed | run `sync-claude-plugin.mjs` on it | non-zero exit naming the missing heading |
| E37 | Forbidden references | static | L1 | automated | every file under `packages/claude-plugin/` | scan | none contains `dashboard-bus`, `bus-client`, `dashboard-api.sh`, `WebSocket bus`, `commands/dashboard-` |
| E38 | Route existence | static | L1 | automated | every `METHOD /api/...` in the control `SKILL.md` | match against route registrations in `packages/server/src/` | each method + path is registered |
| E39 | Skill content contract | static | L1 | automated | both `SKILL.md` files | test | bootstrap: one command with a 600 s timeout and "never background"; control: `token create --label claude-code --tier control`, `-H @`, `--check &&` chaining, no `-v`/`--trace`; descriptions ≤ 400 chars, valid frontmatter |
| E40 | Version lockstep | static | L1 | automated | `plugin.json` + root `package.json` | test | versions equal |
| E41 | Version lockstep | state-transition | L1 | automated | temp copy of the repo skeleton with the root version bumped | run `sync-versions.js` | `plugin.json` version = new root version; a second run produces no diff |
| E42 | Version lockstep (local release path) | static | L1 | automated | `.pi/skills/release-cut/SKILL.md` | test | step 6 `git add` includes `packages/claude-plugin/.claude-plugin/plugin.json`; a version-equality check precedes `git tag` |
| E43 | Version lockstep (tag-push path) | static / workflow-contract | ci | automated | `.github/workflows/publish.yml` | contract test | the `publish` job has a step reading `git show "$RELEASE_TAG:packages/claude-plugin/.claude-plugin/plugin.json"` ordered **before** `node scripts/sync-versions.js` and before any publish step |

| E44 | Release zip layout | static / EP | L1 | automated | `scripts/build-claude-plugin-zip.mjs --version <plugin version>` into a temp dir | run + `zipinfo -1` | exactly one `pi-dashboard-claude-plugin-<v>.zip`; lists `.claude-plugin/plugin.json`, both `SKILL.md`, `README.md`, `LICENSE`; no `bin/`, `.mcp.json`, `hooks/`, `.DS_Store`; zipped `plugin.json` version = `<v>` |
| E45 | Release zip version gate | BVA | L1 | automated | same script with `--version` ≠ `plugin.json` version (and a missing `--version`) | run | non-zero exit naming both versions (or the missing flag); no zip written |
| E46 | Release zip wiring | static / workflow-contract | ci | automated | `.github/workflows/publish.yml` | contract test | the `github-release` job runs `build-claude-plugin-zip.mjs` before `Create GitHub Release`, and that step's `files` includes `claude-plugin-dist/*.zip` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Bootstrap (assumption A1) | threshold | L1 | automated | verified fixture dashboard already up; lock meta present | wall time of `ensure-dashboard.sh` ≤ 5 s (and `--check` ≤ 5 s) | 5 consecutive runs, max |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Never started over | fault-injection (delay) | L1 | automated | fixture `hung` holding the port; `server.pid` + lock meta present | run | `STATUS=busy`, exit 3, server log path on stderr, no launcher; both records byte-identical |
| X2 | Never started over | fault-injection (abort) | L1 | automated | refused port; lock meta names a live pid; nothing ever answers | run (poll override 2 s) | `STATUS=busy`, exit 3, no launcher |
| X3 | Never started over | fault-injection (corrupt) | L1 | automated | refused; lock meta = `{"pid":` (truncated) | run | no launcher; `STATUS=busy`, exit 3 |
| X4 | Never started over | fault-injection (transient) | L1 | automated | refused for the first 3 s, then fixture `dashboard` binds | run (no window override: 10 s real) | `STATUS=already-running`; no launcher |
| X5 | Concurrent bootstraps | race | L1 | automated | refused, no records; stub CLI boots a fixture after 2 s | two runs spawned in parallel | exactly one CLI invocation in the stub log; both end with ready statuses (`started` + `already-running`) |
| X6 | Launcher fails | fault-injection (abort) | L1 | automated | stub CLI `start` exits 1 | run | `STATUS=failed`, exit 1; npm/npx/open never invoked |
| X7 | Readiness wait | fault-injection (delay) | L1 | automated | stub CLI exits 0 but no server appears | run (readiness override 2 s) | `STATUS=failed`, exit 1, stderr names `~/.pi/dashboard/server.log` |
| X8 | Consented install fallback | fault-injection (abort) | L1 | automated | `--install`; stub npm `install -g` exits with EACCES | run | stderr hint leads with npm prefix and does not recommend `sudo`; `npm exec --yes --package=…@latest -- node -e 0` recorded **with** `npm_config_allow_remote=all`; `npx --yes …@latest start --port <p>` recorded **without** it; stdout `INSTALL=npx-cache` + non-durable warning |
| X9 | Consented install | fault-injection (missing dep) | L1 | automated | `--install`; no npm resolvable | run | `STATUS=failed`, exit 1, nothing downloaded |
| X10 | Credentials only to verified dashboard | fault-injection (re-bind) | L1 | automated | after a verified run, the fixture is replaced by a `wrong-pid` server on the same port | `--check` | non-zero exit, `STATUS=port-conflict`; a chained `&& curl` would not run (asserted via the exit code) |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | Accepted by claude.ai | exploratory | — | manual-only | claude.ai Customize > Plugins > Upload plugin (the release zip, or a local build of `build-claude-plugin-zip.mjs`) | upload | accepted; both skills listed |
| M2 | Marketplace install | exploratory | — | manual-only | Cowork/claude.ai "Add marketplace" `BlackBeltTechnology/pi-agent-dashboard` | add + install | succeeds despite repo size, otherwise trigger the mirror-repo fallback (design D6) |
| M3 | Validator + CLI install (A4) | exploratory | — | manual-only | `claude plugin validate packages/claude-plugin` and `.`; `/plugin marketplace add … --sparse .claude-plugin packages/claude-plugin` + install | release-cut checklist | validation passed; inventory 2 skills, 0 agents/hooks/MCP |
| M4 | Sandbox refusal | exploratory | — | manual-only | cloud Cowork task "start my pi dashboard" | run | `sandbox` message, or `not-installed` + a consent question that names the machine; no silent install; record the env markers observed |
| M5 | Local surface not refused | exploratory | — | manual-only | Claude desktop app Code tab | `env \| grep CLAUDE` + bootstrap | no sandbox marker; bootstrap works. **Gates announcing the plugin** |
| M6 | Electron app source | exploratory | — | manual-only | macOS with only pi-dashboard.app installed | "start my pi dashboard" | the app opens in the background; `STATUS=started` |
| M7 | Windows (A3) | exploratory | — | manual-only | Windows Claude Code with the CLI installed (Git Bash) | bootstrap | reports `BASE`; lock and `find -mmin` behave |
| M8 | Token handling | exploratory | — | manual-only | dashboard with `requireLocalProof: true` | "send a prompt to session X" | Claude asks for `token create --label claude-code --tier control`, prefers the header file, uses `--check && curl -H @…`, the token is not echoed |
| M9 | Agent behaviour (A2) | exploratory | — | manual-only | Claude Code with the plugin installed, dashboard down, no CLI | "is my pi dashboard running?" | bootstrap skill chosen; one foreground call with a 600 s timeout; the consent question lists machine/size/bridge/Cowork-decline before `--install` |
| M10 | Consented install end to end | exploratory | — | manual-only | temp `HOME` + temp npm prefix (`npm_config_prefix`), network | consent → `--install` | `INSTALL=global`; `~/.pi/agent/settings.json` bridge path inside the prefix, not `~/.npm/_npx`; a second session starts with no consent |

---

## Coverage summary

- Requirements covered: 12/12 (every `### Requirement` in `specs/claude-code-plugin/spec.md` has ≥ 1 automated row; "Accepted by claude.ai" and "Manifest validates" are covered by manual rows M1/M3 plus E1).
- Scenarios by class: edge 46 · perf 1 · error 10 · manual 10
- Scenarios by level: L1 55 · ci 2 · L2 0 · L3 0 · — 10
- Scenarios by disposition: automated 57 · manual-only 10

## New infra needed

- None. The L1 tests use the existing `scripts` vitest project, Node fixture servers and stub executables. The script exposes test-only timing overrides (design D2).
