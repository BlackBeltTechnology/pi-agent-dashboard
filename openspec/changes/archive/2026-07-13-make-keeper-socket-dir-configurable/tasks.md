# Tasks

## 1. Honor PI_DASHBOARD_HOME (server + keeper)
- [x] 1.1 `defaultSessionsDir()` uses `process.env.PI_DASHBOARD_HOME?.trim() || os.homedir()` as the base for `.pi/dashboard/sessions` (flows to both spawn and the startup reconnect scan via the single `sessionsDir` the manager threads through).
- [x] 1.2 `keeper.cjs` computes `SESSIONS_DIR` from the same `PI_DASHBOARD_HOME`-or-`homedir` base, so the child binds the same path the server expects.
- [x] 1.3 `spawnKeeperFor` forwards `PI_DASHBOARD_HOME` into the keeper subprocess env (buildSpawnEnv curates the env and may not carry the custom var through on its own).

## 2. Verify (manual)
- [x] 2.1 With `PI_DASHBOARD_HOME` set to a short dir under a deep HOME, a headless spawn binds the socket successfully and the session registers (previously `bind EINVAL`).
- [x] 2.2 With `PI_DASHBOARD_HOME` unset, sockets resolve under `~/.pi/dashboard/sessions` exactly as before (backward compatible).
