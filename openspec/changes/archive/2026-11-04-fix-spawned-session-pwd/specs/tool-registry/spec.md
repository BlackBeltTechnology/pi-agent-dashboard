## MODIFIED Requirements

### Requirement: Node-wrapped spawns to the Electron binary always run as Node

When a spawn's `argv[0]` is the host `process.execPath` and that interpreter is the Electron binary (the triply-degraded `execpath-fallback` topology: server on the Electron binary, no managed runtime `node`, no PATH `node`), **every** spawn-env builder that produces the env for that spawn SHALL set `ELECTRON_RUN_AS_NODE=1` on the child env. This SHALL hold for both node-wrapped executor argv (`[<electron-binary>, cli.js]` from `resolveExecutor("pi")`) and the RPC keeper's own launch argv (`[<electron-binary>, keeper.cjs]`). No spawn-env builder SHALL strip `ELECTRON_RUN_AS_NODE` for such an argv. When a real `node` resolves (bundled, managed, or on PATH), `argv[0]` is that real `node`, the requirement is inert, and the spawn path SHALL NOT add `ELECTRON_RUN_AS_NODE`.

Scope note: spawn sites that pass `pi` as a shell token (`spawnTmux`, `spawnWslTmux` via `buildTmuxCommand`) are NOT node-wrapped and are outside this requirement.

#### Scenario: spawnWt pi argv spawned as Node

- **WHEN** no real `node` is resolvable and `spawnWt` resolves the pi executor argv to `[<electron-binary>, cli.js]`, whose env is built by `process-manager.buildSpawnEnv`
- **THEN** the built child env SHALL contain `ELECTRON_RUN_AS_NODE=1`, so pi runs as Node instead of re-launching the Electron GUI and exiting on the single-instance lock

#### Scenario: spawnHeadless keeper and pi argv spawned as Node

- **WHEN** no real `node` is resolvable and `spawnHeadless` routes through the RPC keeper, which spawns its own `[<electron-binary>, keeper.cjs]` (`nodeBinary = process.execPath`) and forwards the pi argv `[<electron-binary>, cli.js]` via `PI_KEEPER_PI_CMD`, all under the `process-manager.buildSpawnEnv`-stripped env
- **THEN** the keeper's launch env AND the forwarded pi spawn env SHALL each contain `ELECTRON_RUN_AS_NODE=1`
- **AND** neither the keeper process nor the pi child SHALL re-launch the Electron GUI

#### Scenario: Env builders agree — no strip-without-readd divergence

- **WHEN** the same Electron-binary `argv[0]` is passed to `process-manager.buildSpawnEnv` (with argv) and to `runner.buildSpawnEnvForArgv`
- **THEN** both SHALL yield an env containing `ELECTRON_RUN_AS_NODE=1`, and neither SHALL leave it stripped for that argv

#### Scenario: Healthy install adds no Electron flag via the spawn path

- **WHEN** a real `node` (bundled, managed, or on PATH) resolves and the node-wrap yields `[<real node>, cli.js]`
- **THEN** the spawn path SHALL NOT add `ELECTRON_RUN_AS_NODE`, and the non-Electron spawn env SHALL be byte-identical to current behavior apart from the `PWD` rewrite that the headless-spawn capability adds to `process-manager.buildSpawnEnv` pi-session spawns
