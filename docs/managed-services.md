# Managed services

Dashboard-run long-lived processes (containers, native runners, user commands) behind one consumer contract. Change: add-service-registry-core. Design: `openspec/changes/archive/2026-10-10-add-service-registry-core/design.md`.

## Purpose

- `pi.tools` = CLI tools a skill calls (short-lived argv). Discovered via `discoverSkillManifests`.
- Services = long-lived endpoints (HTTP/TCP/WS). Dashboard owns start, probe, lease, idle-stop.
- `pi.services` = inert offer. Nothing pulled, fetched or started until user adds it.
- Skill consumes `ensure` → endpoint. Never spawns the service itself.

## Files on disk

Root `~/.pi/dashboard/` (`servicesPaths()` in `packages/server/src/services/paths.ts`).

| Path | Mode | Content |
|---|---|---|
| `services.json` | 0600 | `schemaVersion: 1`, `instanceId`, `services[]`. User-owned. |
| `services-secrets.json` | 0600 | Secret store, keyed `<id>/<name>`. |
| `services-run/<id>/` | 0700 | Per-service run dir. |
| `services-run/<id>/instance.json` | | Native pid, argv, ports. OCI container id. |
| `services-run/<id>/prefetched.json` | | Explicit prefetch marker (`package@version`). |
| `services-run/<id>/tunnel.json` | | podman `ssh -L` tunnel pid. |
| `services-run/<id>/pinned` | | Pin marker. |
| `services-run/<id>/lifecycle.lock` | | Async `proper-lockfile` per service. |
| `services-run/<id>/secrets/<name>` | 0600 | Secret files mounted `:ro`. |
| `services-run/.docker-config/` | 0700 | Empty `DOCKER_CONFIG` for every runtime call. |

- Missing `services.json` → zero services, no probe, no command at boot.
- Run dir under `~/`, never `/tmp` (podman machine does not mount `/tmp`).

## Ownership modes and drivers

| Mode | Drivers | Owns lifecycle | Notes |
|---|---|---|---|
| `managed` | `oci:docker`, `oci:podman`, `native` | yes | `drivers` = preference order. |
| `attached` | user argv | yes, user cmds | `origin: "user"` only. `lifecycle.{start,stop}.{darwin,linux,win32}`. Spawn `shell:false`. |
| `external` | none | no | probe + endpoint + secrets only. |

- One OCI module (`oci-driver.ts`) for docker + podman. Quirks isolated in probe/tunnel.
- Native recipe: `{ runner: "uvx" | "npx", package: "<name>@<exact>", bin?, args }`.
- `args` placeholders: `${port.<name>}` only.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> stopped
  stopped --> starting: ensure / start
  starting --> healthy: probe ok
  starting --> failed: timeout / exit
  starting --> blocked: alive, probe failing past startTimeout
  blocked --> healthy: probe ok (self-recovery)
  healthy --> idle: leases = 0
  idle --> healthy: ensure + probe ok
  idle --> blocked: ensure, alive, probe failing
  idle --> stopping: idleStop elapsed (owned, not blocked)
  healthy --> blocked: probe failing, alive
  stopping --> stopped: exit observed
  stopping --> stop-failed: no exit within stopTimeout
  stop-failed --> stopping: manual stop
  failed --> starting: ensure after retryAt
```

- `unavailable` = derived, re-evaluated per `ensure`. Always carries `reason`.
- Closed `reason` set:
  - `runtime-missing`
  - `runtime-unreachable`
  - `host-vm-stopped`
  - `image-absent`
  - `runner-absent`
  - `package-absent`
  - `secret-unavailable`
  - `unsupported-platform`
  - `invalid-definition`
  - `adoption-uncertain`
  - `owner-conflict`
  - `duplicate-instances`
- `blocked`: never killed, relaunched or idle-stopped. Only explicit `stop` acts.
- `stop-failed`: stop confirmed only by observed exit.
- `failed`: `retryAt` exponential from 5 s, cap 300 s, reset on `healthy`. No start path overrides `retryAt`. `service retry <id>` or definition change clears it.
- Stale definition on live instance → `restartRequired: true`. Applies next start.
- Timeouts: `startTimeout` 120 s, `stopTimeout` 15 s. Per-definition override.
- Lifecycle ops serialized: per-service in-process mutex, then `lifecycle.lock`, then JSON lock (never held across await).

## Leases, idle, pin

| Setting | Default |
|---|---|
| Lease TTL | 300 s |
| Heartbeat interval (CLI) | 30 s (TTL/10) |
| Runtime re-probe while leased | 30 s |
| `idleStopMinutes` | 15 min (`null` for `attached`) |
| Health probe concurrency | 4 |

- `ensure` returns a lease only when `healthy`.
- `heartbeat` / `release` on unknown lease → `404 lease-unknown`. Restart clears leases (in memory).
- CLI `heartbeat` / `exec` on `lease-unknown` → re-`ensure`, adopt new `leaseId`.
- Idle-stop only when `startedBy: "dashboard"`, not pinned, not `blocked`.
- Pin, unpin, definition change → reset idle clock.
- `attached` without `lifecycle.stop` → `idleStopMinutes` must be `null`.

## Adoption (restart)

- OCI: labels `pi.service=<id>`, `pi.owner=<instanceId>`, `pi.def-hash`.
  - 1 running match → `idle`, endpoints re-read.
  - 1 exited match → `stopped`.
  - >1 match → `unavailable` `duplicate-instances`. No endpoint. Nothing auto-removed. stop/remove acts on all.
  - Different `pi.owner` → `unavailable` `owner-conflict`. No create.
  - `pi.def-hash` differs → recreated on next start.
- Native: adopt only if pid alive AND argv contains `package` token AND pid holds recorded port (`findPortHolders`).
  - Dead pid → discard `instance.json`.
  - Alive but unverifiable (incl. port check impossible) → `unavailable` `adoption-uncertain`. No spawn until `stop --force` / `remove`.
  - pid known only from `instance.json` (no live instance) → signal only if command line still carries recorded package. Else drop record (PID-reuse safety).
  - `service stop <id> --force` overrides the argv check.
- `instanceId` never regenerated while `services.json` exists.
- Boot adoption: no health probe, no network I/O.
- Boot adoption + scheduler start after HTTP listener up (`start()`, `serviceManager.boot()` → `startScheduler()`), not at `createServer`.

## Offers and add/update/remove

- Offer format + validated example: [manifest-schema.md](../packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/manifest-schema.md) section `pi.services`. Do not duplicate JSON here.
- Validator: `parseServiceOffers` (`packages/shared/src/services/offers.ts`).
- Discovery: same scopes as `pi.tools` — `node_modules/@blackbelt-technology/*`, monorepo `packages/*` (`scanPiManifests`, `packages/shared/src/tool-registry/pi-tools.ts`). Packages outside scopes not discovered.
- Offer list cached 10 s (`OFFERS_CACHE_MS`). `updateAvailable` may lag a package upgrade by ≤10 s.
- Rules (summary):
  - `schemaVersion: 1`; unknown keys rejected and named.
  - No `lifecycle`, binds, `privileged`, host network, non-loopback ports.
  - OCI image `@sha256:` pinned. Native `package` exact version.
  - Package templates reference only own store slot: `store:<id>/<name>`. No `env:`, `keychain:`, or other service's secret.
  - Named volumes start with `<id>-`. Volumes runtime-global; `--purge-data` removes only declared volumes.
  - `image` may not start with `-`.
  - Secret names may not differ only by case.
- Add:
  - `POST /api/services { offer, dryRun: true }` → review (image or recipe, ports, volumes, secrets, `templateHash`).
  - `dryRun: false` writes.
  - `AddReview.secretSources` per secret: `store:<id>/<name> (generated, N bytes)` | `(user-entered)` | ref.
  - CLI `service add` = review → confirm → write.
  - `--yes` skips confirm only. Never implies prefetch.
  - `--prefetch` or separate confirm required for fetch.
- Update:
  - `templateHash` ≠ `origin.templateHash` → `updateAvailable: true` + diff `[{ path, from, to }]`.
  - Applied only on `update: true` / `service add --update`. Never silent.
- Remove:
  - `service remove <id> [--purge-data]` / `DELETE /api/services/:id?purgeData=true`.
  - Stops owned service; removes container/instance files, secrets, `services-run/<id>/`.
  - Named volumes retained unless `--purge-data`.
  - `service remove --all` = every service.
  - `service remove` never force-signals.
  - Refuses 409 before any teardown while `services-secrets.json` corrupt.
- User entries: `definition` body or hand-edit `services.json` (picked up next `ensure` / `list`).
- Offered but not added → `state: "not-added"` + hint.
- Corrupt `services.json` → quarantined byte-exact. Every write refused. All services `unavailable` `invalid-definition`. `list` reports `definitionsCorrupt` + backup path.

## No silent download

- `ensure` never fetches, never pulls.
- Image absent → `image-absent`. Fix: pull yourself (`docker pull` / `podman pull`).
- Fetch only via `service prefetch <id>` / `POST /api/services/:id/prefetch`, or opt-in `service add --prefetch`.
- uvx presence: `uvx --offline --from <pkg> <bin> --help` exits 1 fast if not cached. `start` also `uvx --offline`.
- npx presence: `prefetched.json` marker ONLY. Never invoke npx for probe (may hit registry). `start` uses `npx --no`.
- Stale marker (cache evicted) → `failed` start, not fetch.
- Missing package → `package-absent`. Fix: `service prefetch <id>`.

## Secrets

- Store: `services-secrets.json`, `writeJsonAtomic(…, 0o600)` under `withLockedJsonFile`.
- Corrupt store → all writes refused. Affected services `secret-unavailable`.
- Sources:
  - `generate: { bytes }` at add time (sync `randomBytes` inside lock).
  - User value via `PUT /api/services/:id/secrets/:name` or `service secret set <id> <name>` (value from **stdin**, never argv).
  - `service secret import <id> <name> <file>`.
- Store-backed secret `store:<id>/<name>` → slot `<id>/<name>` for write (`service secret set`), generation, `configured` (`storeSlotOf`, `secrets-resolver.ts`).
- `configured` reported only for store-backed secrets.
- Refs (read-only):
  - `store:<id>/<name>`
  - `env:<NAME>`
  - `keychain:<service>/<account>` — darwin `security find-generic-password -w`, linux `secret-tool lookup`. 10 s timeout.
  - No fallback. win32 / docker all-in-one → `secret-unavailable`.
  - Keychain writes not supported.
- Delivery:
  - OCI: `~/.pi/dashboard/services-run/<id>/secrets/<name>` mounted `:ro` at `/run/secrets/<name>`. Never `-e` / `--env-file`.
    - Declared `env` var holds mount path `/run/secrets/<name>` (`secretPathEnv`).
  - native / attached: env into spawned child only.
    - Declared `env` var holds VALUE in child env (`startCommandSecretEnv`).
  - Definition mixing oci + native/attached → value driver-dependent. Read `/run/secrets/<name>` only inside a container.
  - `service exec <id> -- <argv…>`: child env `SVC_<ID>_<NAME>`. Parent env untouched.
- No reveal surface. No REST route returns a value.

## Threat model

- Protected boundary: dashboard surfaces (REST, CLI output, logs, `inspect` of dashboard containers) + other OS users.
- Secret files owner-only (0600/0700).
- Out of scope:
  - same-uid code (can read 0600 files and `/proc/<pid>/environ`).
  - `service exec` child (receives secrets by design; may print them).
- Accepted: `ensure --json` exit 0 diverges from measured exit-code form (see Consumer contract).
- Accepted residual (user decision):
  - Default (non-strict) mode: any genuinely-local loopback caller, incl. another OS user on same host, passes `isLocallyTrusted`.
  - Such caller can create argv-carrying `attached` entry.
  - Same dashboard-wide loopback posture as terminals.
  - Strict mode: `requireLocalProof` → requires local token / proof cookie.

## REST routes

Source: `packages/server/src/services/routes.ts` (top comment).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/services` | list (+ `updateAvailable`, diff) |
| GET | `/api/services/offers` | discovered `pi.services` (cached 10 s) |
| GET | `/api/services/runtimes` | runtime detection report |
| GET | `/api/services/:id` | status (re-probes running instance) |
| POST | `/api/services` | add `{ offer \| definition, dryRun?, update? }` |
| DELETE | `/api/services/:id?purgeData=true` | remove |
| POST | `/api/services/:id/ensure` | `{ holder? }` → ensure payload + lease |
| POST | `/api/services/:id/heartbeat` | `{ leaseId }` → 404 `lease-unknown` |
| POST | `/api/services/:id/release` | `{ leaseId }` → 404 `lease-unknown` |
| POST | `/api/services/:id/{start,stop,retry,pin,unpin,prefetch}` | mutations |
| PUT | `/api/services/:id/secrets/:name` | `{ value }` → `{ configured }`. Never echoed. |

Auth:
- Unexpected server error → 500 `{ error: "internal", message: "internal error (see server.log)" }`. Details only in `server.log` (`sendError`, `routes.ts`).
- Reads: network guard (`createNetworkGuard`).
- Mutations: `canMutateServices` →
  - device bearer tier `operate`, OR
  - authenticated session / principal, OR
  - `isLocallyTrusted(input, ctx)` (honours `requireLocalProof`).
- Trusted-network caller and `observe` / `control` bearer → refused.
- Mutations denylisted from MCP (core).
- Gates: `route-tier-gate.test.ts`, `mcp-manifest-completeness.test.ts`.

## CLI

Source: `packages/server/src/services/cli-service.ts` (`SERVICE_HELP`).

```
pi-dashboard service ensure <id> [--holder <name>]
pi-dashboard service heartbeat <id> <leaseId> [--loop]
pi-dashboard service release <id> <leaseId>
pi-dashboard service exec <id> -- <argv…>
pi-dashboard service list | status <id>
pi-dashboard service start|stop|retry|pin|unpin <id>     (stop --force: adoption-uncertain / external)
pi-dashboard service add <offer|pkg#offer> [--yes] [--update] [--prefetch]
pi-dashboard service add --file <def.json> [--yes]
pi-dashboard service remove <id> [--purge-data]
pi-dashboard service remove --all [--purge-data]
pi-dashboard service prefetch <id> [--yes]
pi-dashboard service secret set <id> <name>              (value from stdin)
pi-dashboard service secret import <id> <name> <file>
```

Exit rule:
- `--json` → exit 0, payload `{ ok, … }`. Outcome in payload.
- Plain → non-zero on failure. `ensure` non-zero unless `healthy`.
- `exec` forwards child exit code.
- Server unreachable → `state: "no-server"` (CLI-produced only).

## Consumer contract

`ensure --json` payload:

```jsonc
{ "id": "docling",
  "state": "healthy" | "starting" | "blocked" | "failed" | "unavailable" | "not-added" | "no-server" | "stop-failed",
  "tried"?: [{ "driver": "oci:docker", "reason": "runtime-unreachable" }],
  "reason"?: "<closed set>", "retryAt"?: "<ISO>",
  "endpoints"?: { "http": "http://127.0.0.1:41231" }, "leaseId"?: "…",
  "driver"?: "oci:podman", "exposure"?: "loopback", "updateAvailable"?: true, "hint"?: "…" }
```

- `idle` never returned by `ensure` (it starts or probes).
- All drivers fail → `reason` = first-preference driver's; `tried` lists all.

## Skill pattern

```
1. ensure <id> --json            → exit 0 always
2. state === "healthy"?          → use endpoints.<name>; heartbeat while working; release at end
3. else                          → read references/standalone.md (fallback path)
4. secrets                       → service exec <id> -- <argv>  (env SVC_<ID>_<NAME>); never echo
```

- Skill passes secrets onward. Never prints them.

## Runtime detection

- `GET /api/services/runtimes` → per-runtime report.
- Fields: `installed`, `version`, `reachable`, `hostVm`, `capabilities`.
- `capabilities` ∈ `ok` | `ok-destructive` | `cli-present` | `needs-secret` | `unavailable` | `unsupported-platform`.
- Cache 30 s.
- `exposure` field cached per port for 30 s.
- Detection on demand only (ensure, runtimes route, list with OCI). Never at boot.
- Host VMs (Docker Desktop, podman machine): reported only. Never started or stopped.
- Hypervisors (report only): qemu, VirtualBox, VMware.

## podman machine tunnel (macOS / Windows)

- Trigger: host probe fails AND podman machine connection exists.
- Action: `ssh -N -L 127.0.0.1:<h>:127.0.0.1:<p>`. No in-container precondition.
- Identity + port from `podman system connection list --format json` (`URI: ssh://…:<port>/…`, `Identity`).
- Wait for bind, re-probe through tunnel, then `healthy` or `blocked`.
- `services-run/<id>/tunnel.json` = `{ pid, forwards }`.
- Stale forward from previous server killed only when argv still contains every recorded `-L` spec.
- Terminated via `killProcess` with the service.
- Linux rootless podman: no tunnel expected (QA item).

## Stop semantics

- OCI: `stop -t <stopTimeout>`, poll `inspect State.Running` until false. Still running → `stop-failed`.
- Native: `killProcessGroup(pid, { timeoutMs })` (POSIX: SIGTERM `-pid`, poll, SIGKILL `-pid`; win32: `taskkill /F /T`). Known limit: `setsid` workers not reached on POSIX.
- Attached: judged only by exact-executable matcher gone within `stopTimeout`. Never by rc.
  - Matcher scans current user's processes only on POSIX (`ps -U <uid>`). Windows `tasklist` unfiltered.
- No direct `process.kill`. Must go through `packages/shared/src/platform/process.ts`.

## Rollback

1. Before removing module: `pi-dashboard service remove --all`.
   - Stops owned services, removes containers, native instances, tunnels, `services-run/`, secrets.
   - Named volumes kept unless `--purge-data`.
2. Leftovers if skipped:
   - labelled containers: `docker ps -aq --filter label=pi.owner=<instanceId>`
   - pid files under `services-run/`
   - `services-secrets.json` (live secrets; delete deliberately)

## Platform matrix

| | macOS | Linux | Windows | docker all-in-one image |
|---|---|---|---|---|
| oci:docker | measured | expected (native daemon, no host VM) | expected (Docker Desktop, Linux containers) | `runtime-missing` (no docker CLI in image) |
| oci:podman | measured, needs tunnel | expected (rootless, no tunnel) | expected (podman machine; tunnel as macOS) | `runtime-missing` |
| native | measured (uvx) | expected | expected (`killProcess` → `taskkill /T`) | works if `uvx`/`npx` present |
| attached | measured (OBS) | expected | expected (`win32` argv) | user commands run inside container |
| keychain | `security` | `secret-tool` (needs session bus) | `secret-unavailable` | `secret-unavailable` |
| exposure | `lsof` | `lsof`, fallback `netstat` | `netstat -ano` | `lsof`/`netstat` if present, else `unknown` |
| Windows-container mode | n/a | n/a | `unsupported-platform` | n/a |
| hypervisor detection (report) | qemu, VirtualBox, VMware (measured) | qemu, VirtualBox, VMware if found | VirtualBox, VMware if found; Hyper-V not detected | none → `installed: false` |

"expected" = unmeasured. QA items (tasks 9.x). Missing binary → explicit `unavailable` reason.
