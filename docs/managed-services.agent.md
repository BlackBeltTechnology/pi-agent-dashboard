# managed-services.md — managed services index

Pull-only condensed map. Source: `docs/managed-services.md`. Dashboard-run long-lived processes behind one consumer contract. Changes: add-service-registry-core, add-services-settings-ui.

## Purpose
- `pi.tools` = short argv CLIs. `pi.services` = inert offer; nothing started until added.
- Dashboard owns start, probe, lease, idle-stop. Skill consumes `ensure` only.

## Files (`~/.pi/dashboard/`, `packages/server/src/services/paths.ts`)
- `services.json` 0600 (`schemaVersion: 1`, `instanceId`, `services[]`). `services-secrets.json` 0600. `services-digest.key` 0600.
- `services-run/<id>/` 0700: `instance.json`, `start.json` (`secretsDigest`, `output` `(dev, ino)`), `output.log` (cap 1 MiB), `tunnel.json`, `lifecycle.lock`, `secrets/<name>`.
- Missing `services.json` → zero services. Run dir under `~/`, never `/tmp`.

## Modes
- `managed`: `oci:docker`, `oci:podman`, `native`. Owns lifecycle. `drivers` = preference order.
- `attached`: user argv, `origin: "user"`, `lifecycle.{start,stop}.{darwin,linux,win32}`, `shell:false`.
- `external`: probe + endpoint + secrets only.
- OCI module `oci-driver.ts`. Native recipe `{runner: "uvx"|"npx", package: "<name>@<exact>", bin?, args}`. Placeholder `${port.<name>}` only.

## Lifecycle
- States: `stopped`, `starting`, `healthy`, `idle`, `blocked`, `failed`, `stopping`, `stop-failed`. `unavailable` derived per `ensure`, always with `reason`.
- `reason`: `runtime-missing`, `runtime-unreachable`, `host-vm-stopped`, `image-absent`, `runner-absent`, `package-absent`, `secret-unavailable`, `unsupported-platform`, `invalid-definition`, `adoption-uncertain`, `owner-conflict`, `duplicate-instances`.
- `blocked`: never killed, relaunched, idle-stopped. Only explicit `stop`.
- `stop-failed`: confirmed only by observed exit.
- `failed`: `retryAt` exponential 5 s → cap 300 s. Cleared by `service retry` or def change.
- `startTimeout` 120 s, `stopTimeout` 15 s.

## Leases, idle, pin
- Lease TTL 300 s. Heartbeat 30 s.  
- `idleStopMinutes` 15 (`null` for `attached`). Idle-stop only if `startedBy: "dashboard"`, not pinned, not `blocked`.
- `ensure` returns lease only when `healthy`. `leaseHolders` = `holder` + `expiresAt`, never `leaseId`.
- Unknown lease → `404 lease-unknown`. Restart clears leases.

## Adoption (restart)
- OCI labels `pi.service`, `pi.owner=<instanceId>`, `pi.def-hash`. 1 running → `idle`; 1 exited → `stopped`; >1 → `duplicate-instances`; other owner → `owner-conflict`; hash differs → recreate on start.
- Native: adopt only if pid alive + argv has `package` + pid holds port (`findPortHolders`). Dead → drop `instance.json`. Unverifiable → `adoption-uncertain`.
- `instanceId` never regenerated while `services.json` exists. Boot adoption: no probe, no network. Scheduler starts after listener.

## Offers, add, update, remove
- Offer format: `dashboard-plugin-scaffold/references/manifest-schema.md` § `pi.services`.
- Validator `parseServiceOffers` (`packages/shared/src/services/offers.ts`). Discovery `scanPiManifests`. Cache 10 s.
- Rules: unknown keys rejected. No `lifecycle`, binds, `privileged`, host network, non-loopback ports. OCI `@sha256:` pinned. Native exact version. Templates reference only `store:<id>/<name>`. Named volumes prefix `<id>-`.
- Add: `POST /api/services {offer, dryRun: true}` → review (`AddReview.secretSources`); `dryRun: false` writes. CLI: review → confirm → write. `--yes` never implies `--prefetch`.
- Update: `templateHash` ≠ origin → `updateAvailable`. Applied only on `update: true`.
- Remove: named volumes kept unless `purgeData`. Never force-signals. 409 while secrets store corrupt.
- Corrupt `services.json` → quarantine byte-exact; writes refused; `invalid-definition`. Offered not added → `state: "not-added"`.

## No silent download
- `ensure` never fetches or pulls. Image absent → `image-absent`.
- Fetch only via `service prefetch <id>` / `POST …/prefetch` or `service add --prefetch`.
- uvx: `uvx --offline`. npx: `prefetched.json` marker only; start `npx --no`. Stale marker → `failed`, not fetch.

## Secrets
- Store `writeJsonAtomic(…, 0o600)` under `withLockedJsonFile`. Corrupt → writes refused, `secret-unavailable`.
- Sources: `generate: {bytes}`; `PUT /api/services/:id/secrets/:name` or `service secret set` (stdin); `service secret import`.
- `configured` only for store-backed (`storeSlotOf`, `secrets-resolver.ts`).
- Read-only refs: `store:`, `env:<NAME>`, `keychain:<service>/<account>` (darwin `security find-generic-password -w`; linux `secret-tool lookup`; 10 s). No fallback. win32 / docker all-in-one → `secret-unavailable`.
- OCI: `:ro` mount at `/run/secrets/<name>`, never `-e`. Env holds path (`secretPathEnv`). Native / attached: env holds value in child only (`startCommandSecretEnv`).
- `service exec <id> -- <argv…>`: child env `SVC_<ID>_<NAME>`. Parent untouched. No REST route returns a secret value.

## Output and redaction
See change: add-services-settings-ui (D4, D5).
- Native/attached: `output.log` via inherited fd, `O_APPEND`. Cap 1 MiB, checked at start, logs read, every 5 s. Over cap → `ftruncate(fd, 0)`.
- OCI: `<runtime> logs --timestamps --since <startedAt> --tail M`. Merge by timestamp. Head 4 MiB, kill 30 s.
- Fail closed:
  - `unset` skipped. `unreadable` → `secret-unavailable`. Value < 4 chars → `secret-too-short`.
  - `secretsDigest` ≠ `start.json` → `secrets-changed` (withheld until next start).
  - One pass, longest first, pre line-split → `«secret:<name>»`.

## Threat model
- Protected: REST, CLI output, logs, `inspect`, other OS users. Out of scope: same-uid code; `service exec` child.
- Accepted: non-strict mode, any local loopback caller passes `isLocallyTrusted`. Strict: `requireLocalProof`.
- Residuals: transformed secrets not redacted. Plaintext log ≤ ~1 MiB at rest. Any `operate` session reads logs.

## REST routes
Source: `packages/server/src/services/routes.ts`.
- `GET /api/services` (list + `canOperate`). `GET …/offers`, `…/runtimes`, `…/:id` (re-probes).
- `POST /api/services` `{offer | definition, dryRun?, update?}`. `DELETE …/:id?purgeData=true`.
- `POST …/:id/ensure` `{holder?}`. `heartbeat` / `release` `{leaseId}`, 404 `lease-unknown`.
- `POST …/:id/{start,stop,retry,pin,unpin,prefetch}`. `PUT …/secrets/:name` `{value}` → `{configured}`.
- `GET …/:id/logs?tail=N`, `POST …/:id/reset-data`, `POST /api/services/prune`: operate.
- Unexpected error → 500 `internal` (details in `server.log`).
- Mutations: operate bearer, or authenticated session/principal, or `isLocallyTrusted`. Trusted-network `observe`/`control` refused. Denylisted from MCP.
- Logs `tail` 1–2000 (default 200) else 400 `invalid-tail`. Body ≤ 512 KiB.
- Log reasons: `external`, `duplicate-instances`, `secrets-changed`, `no-output`, `runtime-error`, `secret-unavailable`, `secret-too-short`.
- reset-data 409: `not-resettable`, `no-data`, `runtime-unreachable`, `volume-shared`, `volume-in-use`.
- prune 409: `definitions-missing`, `definitions-corrupt`. Candidates: orphan `pi.owner` containers, undefined `services-run/<id>/` with no live pid. Never volumes or foreign owners.

## CLI
Source: `packages/server/src/services/cli-service.ts` (`SERVICE_HELP`).
- `ensure <id> [--holder]`, `heartbeat <id> <leaseId> [--loop]`, `release <id> <leaseId>`, `exec <id> -- <argv…>`.
- `list`, `status <id>`, `start|stop|retry|pin|unpin <id>` (`stop --force`).
- `add <offer|pkg#offer> [--yes] [--update] [--prefetch]`, `add --file <def.json>`.
- `remove <id> [--purge-data]` / `--all`. `prefetch <id> [--yes]`. `secret set <id> <name>` (stdin), `secret import <id> <name> <file>`.
- `--json` → exit 0, payload `{ok, …}`. Plain → non-zero on failure. `ensure` non-zero unless `healthy`. `exec` forwards child exit.
- Server unreachable → `state: "no-server"` (CLI only).

## Consumer contract
- `ensure --json`: `id`, `state` (`healthy`|`starting`|`blocked`|`failed`|`unavailable`|`not-added`|`no-server`|`stop-failed`), `tried?`, `reason?`, `retryAt?`, `endpoints?` (`{http}`), `leaseId?`, `driver?`, `exposure?`, `updateAvailable?`, `hint?`.
- `idle` never returned by `ensure`. All drivers fail → `reason` = first driver's; `tried` lists all.
- Skill: `healthy`? → `endpoints.<name>`, heartbeat, release. Else `references/standalone.md`.

## Runtime and tunnel
- `GET /api/services/runtimes`: `installed`, `version`, `reachable`, `hostVm`, `capabilities` (`ok` | `ok-destructive` | `cli-present` | `needs-secret` | `unavailable` | `unsupported-platform`).
- On demand only. Host VMs and hypervisors (qemu, VirtualBox, VMware): report only.
- podman tunnel (macOS / Windows): host probe fails AND podman connection exists → `ssh -N -L 127.0.0.1:<h>:127.0.0.1:<p>`. Identity/port: `podman system connection list --format json`.

## Stop semantics
- OCI: `stop -t <stopTimeout>`, poll `State.Running`. Still running → `stop-failed`. Without instance: only `pi.service=<id>` AND `pi.owner=<instanceId>`.
- Native: `killProcessGroup` (POSIX SIGTERM → SIGKILL; win32 `taskkill /F /T`).
- Attached: exact-executable matcher gone within `stopTimeout`. Never by rc.

## Settings UI
See change: add-services-settings-ui (D1–D12).
- Nav `Services`: `/settings/services[/<id>]`, `/settings/runtimes`. `services_changed` ping, 500 ms coalesced.
- Actions (server authoritative): stopped → Start, Prefetch (native), Reset data. starting / stop-failed → Stop. healthy / idle / blocked → Stop (not `external`), Force stop (`external`). failed → Retry. unavailable → Try again (not `adoption-uncertain` / `duplicate-instances` / `owner-conflict`), Force stop (`adoption-uncertain`), Prefetch (`package-absent`), Reset data.
- Pin/unpin `managed` only.
- Destructive: Remove (volumes unchecked); Reset data (type id); Prune (dry-run first, exact ids); Force stop (names override).
- `canOperate: false` → disabled + banner. 403 `operate_required` → inline remedy.

## Rollback
- `pi-dashboard service remove --all`. Leftovers: labelled containers (`pi.owner=<instanceId>`), pid files, `services-secrets.json`.
