## Why

Issue #1079: a dashboard-spawned pi session runs in the right directory (the spawn `cwd`) but carries a stale `PWD` copied from the dashboard server's environment. context-mode's pi adapter resolves its project dir via `PI_WORKSPACE_DIR → PI_PROJECT_DIR → PWD → process.cwd()` (context-mode 1.0.169, `build/adapters/pi/extension.js:343-402`; its MCP tool server also consults `PWD` before `cwd`); the first two are unset, so `ctx_execute` / `ctx_batch_execute` run in the dashboard's launch directory and context-mode session memory is filed under it, shared across every spawned project. `Bash` looks fine because bash re-derives `PWD`, so the cwd appears to jump between tools. Only visible in projects other than the one the server was launched from.

Root cause (verified, see design.md): `buildSpawnEnv` copies `process.env` (PWD included) and has no notion of the spawn `cwd`; the keeper sets the child cwd but never touches `PWD`. The worktree-init agent hook (`runAgent`) has the same defect: it execs `pi -p` directly with a verbatim `process.env` copy. Nothing in non-test source writes `PWD`. This is a never-handled gap, not a regression of an archived change.

## What Changes

- `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts`) gains an optional `cwd` option and, when given, sets `env.PWD = normalizeCwdKey(path.resolve(cwd))` in the host's own shaping (before contributors): the canonical physical path (realpath), falling back to the absolute lexical form. Absent `cwd` ⇒ env unchanged.
- All five `buildSpawnEnv` call sites in `process-manager.ts` pass the spawn cwd: `spawnTmux`, `spawnWslTmux`, `spawnWt`, `spawnHeadless`, `spawnChildCmdViaKeeper` (the last already receives `cwd` as its first parameter, :1070).
- `PWD` becomes a host-owned name: added to the spawn-env contributor deny list (`DENY_EXACT`, `spawn-env-contributors.ts`), so no plugin can contribute, supersede or `-e`-inject it.
- `runAgent` (`packages/server/src/git-worktree/worktree-init.ts`) spawns the agent-hook pi with `opts.env ?? { ...defaultHookEnv(), PWD: normalizeCwdKey(path.resolve(cwd)) }`. Gate and script hooks (`bash -c`) are unchanged; a caller-supplied `opts.env` stays untouched (heap-limits "explicit caller environment is respected").
- `PWD` only. `PI_PROJECT_DIR` / `PI_WORKSPACE_DIR` / `CONTEXT_MODE_PROJECT_DIR` are NOT set (see design D2).
- No change to `keeper.cjs`/`keeper-env.cjs`, tmux argv, the PTY terminal or ACP agent processes (design D3: each is already correct or out of scope).
- Spec deltas (all MODIFIED):
  - `headless-spawn` "env-var injected on every spawn": `PWD` is the one sanctioned rewrite; new scenarios.
  - `worktree-init-hook` "Agent-flavor hook runs detached": agent pi `PWD` = checkout cwd.
  - `plugin-spawn-env-contributor` "Contributions apply …": reject list gains `PWD`.
  - `spawn-correlation` "env-var injection", `tool-registry` "Node-wrapped spawns …", `host-cwd-policy` "The spawn funnel applies cwd policy to ANY spawn", `acp-agent-sessions` "ACP spawn routing": their "unchanged / byte-identical / as before" env guarantees admit the cwd-derived `PWD`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `headless-spawn`: spawned pi's `PWD` names the spawn cwd for every strategy.
- `worktree-init-hook`: the agent-flavor hook's detached pi carries `PWD` = checkout cwd.
- `plugin-spawn-env-contributor`: `PWD` is a rejected (host-owned) name.
- `spawn-correlation`: "existing env vars preserved" admits the `PWD` rewrite.
- `tool-registry`: healthy-install "byte-identical spawn env" clause admits the `PWD` rewrite.
- `host-cwd-policy`: no-policy "byte-identical" clause admits the `PWD` rewrite.
- `acp-agent-sessions`: "spawn without agent unchanged" admits the `PWD` rewrite.

## Impact

- `packages/server/src/spawn-process/process-manager.ts`, `spawn-env-contributors.ts` (+ `process-manager.ts.AGENTS.md`, `spawn-process/AGENTS.md` row).
- `packages/server/src/git-worktree/worktree-init.ts` (+ `worktree-init.ts.AGENTS.md` row).
- Tests: exact list in `test-plan.md` (env-builder unit, per-mechanism env-sink wiring, contributor rejection, real-keeper regression incl. respawn, worktree agent-hook env).
- `wt`: pi sees `PWD` only as far as `wt.exe` propagates the spawn env (pre-existing exposure, design Risks).
- Existing keepers (started by an older server) keep their stale `PWD` until their session ends; no migration possible.
- Cross-change: `add-plugin-isolation-and-public-routes` MODIFIES three of the same requirements; whichever archives second must rebase its MODIFIED bodies (design "Cross-change coordination").

## Discipline Skills

`review-code` (non-trivial change with tests passing, before commit). No `security-hardening` trigger: `PWD` is derived from the spawn cwd that is already the child's working directory (no new input, no new sink; the value goes into the env only, never argv or a shell string), and the contributor change only tightens the trusted-plugin boundary. No performance/observability/irreversible-step trigger: one `realpathSync` per user-initiated spawn, no new endpoint, no migration.

Fixes #1079
