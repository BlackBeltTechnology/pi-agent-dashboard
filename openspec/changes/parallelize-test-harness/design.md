## Context

`docker-test-harness` proved one-instance isolation from the host dashboard. Parallel git worktrees (a common dev flow here — see `.worktrees/` in `.gitignore`) break the *self-vs-self* case. Three coupled facts:

- `compose.yml` publishes ports from `${DASHBOARD_PORT}` / `${PI_GATEWAY_PORT}` (shell env, set by `test-up.sh`).
- `compose.test.yml` sets the *container* `DASHBOARD_PORT` / `PI_GATEWAY_PORT` as **literals** — so the published host port and the listen port can drift apart the moment one side changes.
- Compose project name is implicit (`docker`), shared by every worktree.

## Decisions

### D1 — Stable port pair from a hash of `HOST_CWD`, then probe

Same worktree → same ports across restarts (survives `down`/`up`), so URLs are predictable and bookmarkable per worktree. Hash → base offset **inside a fixed, disjoint window**; probe for freeness *within that window only* (wrapping at the window edge) so a high base never bleeds into the neighbouring window.

```
hash       = cksum(HOST_CWD)            # digits, portable (macOS + Linux)
DASH_LO=18000  DASH_HI=18999           # dashboard window (1000 ports)
GW_LO=19000    GW_HI=19999             # gateway window   (1000 ports)
base_dash  = DASH_LO + hash % 1000
base_gw    = GW_LO   + hash % 1000
DASHBOARD_PORT   = find_free_in_window(base_dash, DASH_LO, DASH_HI)
PI_GATEWAY_PORT  = find_free_in_window(base_gw,   GW_LO,   GW_HI)
```

**Window-bounded scan (resolves C1).** `find_free_in_window(start, lo, hi)` probes `start`, then increments and **wraps `hi → lo`**, visiting every port in `[lo..hi]` at most once (cap = window size = **1000 tries**). The dashboard scan therefore can never enter the gateway window and vice-versa — the two windows stay provably disjoint. If all 1000 ports in a window are busy (practically impossible — would need 1000 concurrent instances), `exit 1` naming the exhausted window and the change `parallelize-test-harness`.

Freeness probe is a connect-check via bash `/dev/tcp` (no `nc`/`lsof` dependency, works on macOS + Linux):

```
is_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
```

**Override path (resolves C2):** the two port vars are honoured **only as a pair**. If *both* `DASHBOARD_PORT` and `PI_GATEWAY_PORT` are exported (the e2e harness sets them), `test-up.sh` uses them verbatim and skips hashing. If *neither* is set, both are derived. If **exactly one** is set, that is a usage error → `exit 1` with a message telling the caller to export both or neither (no half-derived state). CLI users get auto-derivation; Playwright stays deterministic.

*Rejected:* random high port (ugly, non-reproducible URLs); pure sequential-from-18000 scan (two worktrees started close in time race on the same first-free port — the hash spreads them apart first).

### D2 — Unique compose project name from the same hash

```
COMPOSE_PROJECT_NAME = pi-dash-test-<hash>      # lowercase, [a-z0-9-], compose-legal
docker compose -p "$COMPOSE_PROJECT_NAME" -f compose.yml -f compose.test.yml up
```

This is the fix for the *silent* collision (②): distinct project name → distinct container set, network, and volume namespace per worktree. Without it, dynamic ports alone still let `up` recreate another worktree's containers.

**Key property:** the project name is a *pure function of `HOST_CWD`* — it does NOT depend on the chosen ports or the state file. So `test-down.sh` (run from the same worktree) can always re-derive the exact project name from `${PWD}` even if the state file is missing or corrupt. The state file (D3) carries the *ports*, not the identity.

### D3 — Per-worktree state file in `HOST_CWD`

`${HOST_CWD}/.pi-test-harness.json`:

```json
{ "project": "pi-dash-test-1234567890", "dashboardPort": 18042, "gatewayPort": 19042 }
```

Lives in the worktree root (chosen for discoverability — `test-down.sh` run from the same dir finds it via `${PWD}`). Gitignored so the host tree stays clean; harmless inside the container (read-only overlay lower). Carries the project name + ports so teardown targets the exact stack and the e2e setup learns the port.

*Rejected:* keyed `/tmp` dir (cleaner but adds a hash-lookup indirection on teardown); `docker/` single-slot file (breaks running two instances from the same worktree, and pollutes the tracked tree).

**Idempotent re-up:** if the state file exists and its project's containers are already running, reuse those ports (don't re-probe). A re-run of `test-up.sh` in a live worktree recreates its own stack rather than hunting a new port.

**Corrupt / missing state file on teardown (resolves C3):** `test-down.sh` re-derives the project name from `${PWD}` (D2 — pure function) and `down -p <project> -v` that, regardless of state-file health. If the file is present but unparseable, warn (`malformed .pi-test-harness.json, derived project from CWD`), tear down anyway, then remove the file. Teardown is best-effort and never blocks on a bad state file.

### D4 — De-hardcode `compose.test.yml`

```
DASHBOARD_PORT:  "${DASHBOARD_PORT:-18000}"
PI_GATEWAY_PORT: "${PI_GATEWAY_PORT:-18999}"
```

Keeps the published host port (from `compose.yml` `ports:`) and the in-container listen port driven by the *same* env var, so they cannot drift. Defaults preserve today's single-instance behaviour when nothing is exported.

### D5 — Playwright lifecycle reads the port

`tests/e2e/lifecycle.ts` becomes the single source of truth for the e2e port:

- `USE_RUNNING` (attach): `DASHBOARD_PORT = Number(process.env.PW_E2E_PORT ?? 18000)`.
- Managed: probe a free port in JS, export `DASHBOARD_PORT` + `PI_GATEWAY_PORT` into the `test-up.sh` spawn env (D1 override path), so the container binds exactly what Playwright will probe.
- Export `HEALTH_URL` + `BASE_URL` derived from it. `playwright.config.ts` imports `BASE_URL` from `lifecycle.ts` (same node process, evaluated once) instead of the literal `http://localhost:18000`.

This closes contract ③ — Playwright and the container always agree on the port, and two e2e runs (different worktrees) no longer fight over `:18000`.

## Risks

- **TOCTOU on the freeness probe** — a port can be taken between probe and `up`. Acceptable for a QA harness; `compose up` surfaces a clear bind error and a re-run re-probes. The hash-spread makes practical collisions rare.
- **Stale state file** — if a run is killed without `test-down.sh`, the file lingers; next `test-up` detects no live project for it and re-derives. `test-down.sh` removes it on success.
