## Context

The service layer (`add-service-registry-core`, archived 2026-10-10) registers its REST routes in `packages/server/src/services/routes.ts:75-120` and a CLI. There is no client surface. The spike (`archive/2026-10-08-spike-managed-services/proposal.md:75`) scoped the follow-up as "Settings → Services, runtime + per-service actions (prune, logs, pin, reset data, approve, leases)".

Facts this design depends on:

- `ServiceStatus` / `ServiceList` shapes: `packages/server/src/services/service-manager.ts:96-125`. Status carries `secrets: Record<name, { configured }>` only — no values.
- Reads use `networkGuard`; mutations add `hasOperateAuthority` → 403 `operate_required` with `remedies` (`routes.ts:56-63`). Route tiers: `packages/shared/src/route-tiers.ts:79,225-228`.
- Native and attached children spawn with `stdio: "ignore"` (`native-driver.ts:145`, `attached-driver.ts:97`) — no output exists today.
- OCI purge already removes declared volumes after `rm` (`oci-driver.ts:350-356`).
- Leases are in-memory; `Lease.holder` is caller-supplied, ≤200 chars (`leases.ts:12-30`, `routes.ts:94`).
- Browser fan-out gates non-session frames only through `FRAME_FAMILY` (`packages/server/src/identity/bootstrap-grants.ts:50`; `packages/server/src/pairing/browser-gateway.ts:1421-1426`), families `workspace|openspec|branch|terminal`. An unmapped frame reaches every socket. The gateway's frame classifier defaults unknown types to the sheddable `transcript` class (`pairing/browser-gateway.ts:145-146`); content-free hints such as `pair_pending_changed` are listed as `state` (never shed).
- `list()` does not probe (`service-manager.ts:947-966`); `status(id)` probes under the mutex and may transition the cell (`service-manager.ts:969-990`).
- Stop honours `force` only for `adoption-uncertain` and `startedBy: "external"` (`service-manager.ts:643-649`).
- User-origin volume names are not namespaced; only package templates must use the `<id>-` prefix (`packages/shared/src/services/schema.ts:314-326`). Volume names are runtime-global.
- `services-run/.docker-config/` is the shared empty `DOCKER_CONFIG` (`paths.ts:8,46`). Service ids match `SERVICE_ID_PATTERN` = `^[a-z0-9][a-z0-9-]{0,62}$` (`schema.ts:190`).
- `remove` deletes the whole run dir (`service-manager.ts:868`).
- No client-visible source of the caller's tier exists today.
- `service-secrets` "Secret values never leave the delivery channel" forbids values in any REST response; the logs route needs a stated exception (MODIFIED in this change).
- The MCP denylist already covers every `/api/services` path (`packages/mcp-server-plugin/src/server/tools.denylist.ts:71-72`); new routes need no manifest entry.
- Settings nav groups: `SettingsPanel.tsx:1159-1214`; page-id contract and second-segment rule: `openspec/specs/settings-panel/spec.md` "Settings page-id registry contract".
- Runtime report: `RuntimeReport` (`runtime-detect.ts:11-20`), capabilities `create/start/stop/remove/hostVmControl` for containers.

## Goals / Non-Goals

**Goals**
- Every REST/CLI capability reachable from Settings, with state-correct action gating.
- Diagnose a failing service without a terminal: reason, hint, tried drivers, logs.
- Destructive actions (remove+purge, reset-data, prune, force-stop) need explicit, specific confirmation.
- Live view without polling and without widening the data any socket receives.

**Non-Goals**
- Editing an existing definition in a form (paste-JSON add/replace only).
- Host-VM or hypervisor control (report only; spec "Host VMs are never started or stopped" stands).
- Streaming/follow logs (tail snapshot + manual refresh only).
- Revealing secret values anywhere.
- Vault integration UI (owned by `absorb-service-secrets-into-vault`).

## Decisions

### D1 — Top-level "Services" nav group, two pages, detail as sub-route
Group order becomes Models, Dashboard, Network, **Services**, Add-ons, Resources, Advanced. Services are global: `services` and `runtimes` are not folder-settings page ids. Pages `services` (label "All services", so it does not repeat the group name) and `runtimes`. Detail at `/settings/services/<id>`; the second segment is interpreted for `services` exactly as for `plugins`; an unknown id renders the list with a "not found" notice (mirrors the plugin fallback). Rationale: services are a first-class operational concern, not a network setting; a sub-route makes detail linkable from a failing `ensure` hint later.
*Alternative rejected:* Network or Advanced page — buries operational state under configuration.

### D2 — Not a Save-bar source
Every service action is instant-apply via its own route (like Access prompt toggle, `SettingsPanel.tsx.AGENTS.md` Access row). The Services pages register no draft, and the Save Bar requirement's exemption list names them (MODIFIED). Rationale: actions are lifecycle commands, not configuration; buffering "Stop" behind Save would be wrong.

### D3 — Payload-free `services_changed` ping, list refetch
Server emits `{ type: "services_changed" }` (no fields) after: any `StateCell` transition, pin/unpin, lease create/release, lease expiry found by `sweep()` on the 30 s tick (so expiry shows up to 30 s late), add/update/remove, every saved secret value, prune/reset-data. Single choke points: a change hook on `StateCell` called from both `transition()` and `init()` (`state-machine.ts:88-95`; adoption uses `init()`, `service-manager.ts:372,382,1053-1061`) and a change callback on `LeaseTable` create/release/sweep — so background transitions (tick idle, idle-stop, re-probe) notify without per-verb wiring. Coalesced: leading + trailing within 500 ms. The gateway classifier gets `case "services_changed": return { cls: "state", key: "services_changed" }`, so the frame coalesces latest-wins and is exempt from transcript shedding (a shed trailing ping would leave the page stale until reconnect); a socket over the byte ceiling is still closed, as for every frame.
Client on ping (and on WS reconnect) refetches **only** `GET /api/services`, after a 100–400 ms random delay (collapses bursts, spreads N browsers), which runs no driver probe and never transitions a cell. It does refresh exposure through the listen-address lookup (`service-manager.ts:885-903,962`), cached 30 s per port, so N browsers cost at most one scan per port per 30 s. The open detail renders state, leases and secrets from its list entry. `GET /api/services/:id` (probing, may transition) runs only when the detail opens and on an explicit Refresh. This breaks the loop probe → transition → ping → probe.
Rationale: no services family exists in `FRAME_FAMILY`; a payload would reach every socket regardless of host policy. All data still passes the HTTP route guard and route tier.
*Trade-off accepted:* every socket learns *when* services change (timing only, no ids). Scoping it would need a new bootstrap family; not worth it for a content-free hint, same reasoning as `pair_pending_changed`.
*Alternative rejected:* push `ServiceStatus[]` — would need a new bootstrap family and policy plumbing for no UX gain at dashboard scale (≤ tens of services).

### D4 — Start record, output capture for native/attached
**Start record.** `DriverInstance` has no start time (`driver.ts:13-25`); `NativeInstanceFile` keeps one but nothing else of use (`native-driver.ts:41-48`); OCI adoption rebuilds instances from labels (`oci-driver.ts:269-281`) and attached adoption marks any match `startedBy: "external"` (`attached-driver.ts:81-88`). So the record lives in its own file, `services-run/<id>/start.json` (0600), written on every dashboard start, any driver, and read back on adoption: `startedAt`, `secretsDigest` = HMAC-SHA256 over the sorted `name=value` pairs delivered, keyed by `services-digest.key` (0600, random per installation; a plain hash would let a weak secret be brute-forced offline), `secretsSavedSinceStart` (set by `setSecret` while a dashboard-started instance runs), and for native/attached the output file's `(dev, ino)`. `restartRequired` = `defHash` mismatch (`service-manager.ts:940`) OR `secretsSavedSinceStart` — persisted, so it survives a server restart.
**Output.** Dashboard-started native/attached children get stdout+stderr as an fd on `services-run/<id>/output.log`, opened `O_APPEND`, mode 0600 — the server never relays output (no event-loop back-pressure). The file is truncated in place (same inode) before every dashboard start, so it holds only the latest start's output: the digest in `start.json` then describes every byte in it, and a value retired before a restart cannot survive into the next run. The file sits in the 0600 run dir that already holds mounted secret files; `service-secrets` gets a stated at-rest exception (MODIFIED).
**Cap** = the `rpc-keeper-sidecar` "Keeper log SHALL be size-bounded by in-place truncation" rule, same 5 s cadence: over 1 MiB → `ftruncate(fd, 0)`; by path when no fd is held (after a server restart) or the descriptor truncation fails (Windows may refuse it on an `O_APPEND` handle, per the keeper rule), and by path only if `(dev, ino)` matches `start.json`. Never rename, copy or reopen. Checked at start, on logs read and every 5 s for every service with a file — an `fstat` of a local file, not a health probe, so the "no polling without leases" rule of "Health probes and exposure reporting" is untouched. Serialised per service. Steady-state bound: 1 MiB + 5 s of output.
A process the dashboard did not start and `external` mode → no file.
*Alternative rejected:* in-memory ring buffer — lost on server restart. Keeping retired values for redaction — would hold old secrets. Truncating on secret change — misses `env:`/`keychain:` changes; the digest covers all three.

### D5 — Logs route: operate authority + secret redaction
`GET /api/services/:id/logs?tail=N`, `tail` integer 1–2000 (default 200) else 400 `invalid-tail`; response ≤ 512 KiB.
Sources:
- OCI → `<runtime> logs --timestamps --since <start.json startedAt> --tail M <container>` via `CommandRunner` (argv-only). Current container's run only. M = N + (lines in the longest secret value − 1), so a multi-line value overlapping the last N lines is wholly inside the fetched text. docker/podman write container stderr to their own stderr; both streams are merged by timestamp (stdout first on ties), then the prefix is stripped. The runner keeps the *head* of each stream up to 4 MiB, silently, and kills on its 30 s timeout (`command-runner.ts:18-30,35,63-72`); it gains a `truncated` flag in `RunResult`, and `timedOut`, a spawn error or `truncated` → `runtime-error`, never partial output. More than one matching container → `duplicate-instances`.
- Native/attached → tail of `output.log` (same M), also when no instance runs (the output of a failed start is the diagnosis).
- `stale` = the service has no running instance (all drivers).
- `available: false` reasons: `external`, `duplicate-instances`, `secrets-changed`, `no-output` (incl. no `start.json`: instances started before this change), `runtime-error`, `secret-unavailable`, `secret-too-short` (the last two carry `secret: <name>` so the UI links to the input).
Logs can contain secret values (native/attached children receive values in env by design — `docs/managed-services.md` "Delivery"), so `service-secrets` gets a stated exception (MODIFIED) and:
1. Route requires **operate** authority (same guard as mutations), route tier `operate` despite being a GET; the `managed-services` read-route sentence is MODIFIED to say so. A device bearer below `operate` is refused earlier by the route-tier gate with 403 `insufficient_scope` (`auth/route-tier-gate.ts:86-97`); trusted-network callers get `operate_required`.
2. Secrets are resolved per secret (in parallel), not first-failure-wins. `resolveSecretRef` returns the same `{ ok: false, hint }` for "not set" and "cannot read" (`secrets-resolver.ts:71-100`), so it gains `kind: "unset" | "unreadable"`: `unset` → skipped; `unreadable` → `secret-unavailable`; shorter than 4 characters → `secret-too-short` (redacting it would garble every line). Both fail closed and name the first such secret in declaration order: an unredactable value cannot be served safely.
3. `secrets-changed`: the HMAC digest of the current values ≠ `start.json` `secretsDigest`. Covers store writes and outside changes to `env:`/`keychain:` values; withheld until the next start.
4. Remaining values are replaced in one pass — a single alternation, longest value first at each position — with `«secret:<name>»` on the raw text, before line split and before the cut. One pass means `pass1234` cannot leave the tail of `pass1234xyz`, and a value cannot match inside a marker already written. Values are held only for the request.
Residuals, stated in the threat model: transformed values (encoded, split, partial prints) are not caught; `hasOperateAuthority` grants operate to any login session or identity principal (`auth/operate-required.ts:48-55`) — the route-tier gate still applies to their tier — so every signed-in user at tier `operate` can read logs, the same audience that can already start, stop and rewrite services.
*Alternative rejected:* network-guard-only read like status — would turn a passive observer into a secret reader. Redact all lengths — a 1-character secret turns every line into markers. Serving output with unredactable values marked — the value is still in the bytes.

### D6 — reset-data
`POST /api/services/:id/reset-data`: operate. Allowed only in `stopped`, or `unavailable` with a reason other than `adoption-uncertain` / `duplicate-instances` / `owner-conflict` (those may involve containers this instance does not own), and only while no owned container runs → else 409 `not-resettable`. If the containers cannot be listed or inspected, 409 `runtime-unreachable` and nothing is removed — never read a failed query as "no containers". Today `listContainers` returns `null` only when `ps` fails, while `inspect()` returns `[]` on failure (`oci-driver.ts:199-224`); inspect failure is changed to propagate as `null`. Volume guards, because user-origin volume names are runtime-global (`schema.ts:314-326`): 409 `volume-shared` if another defined service declares the same name; 409 `volume-in-use` if `<runtime> ps -a --filter volume=<name>` finds a container not labelled `pi.service=<id>` + `pi.owner=<instanceId>`. Under the lifecycle lock: plain `rm` (never `-f`) of the labelled+owned containers (a failure → 409 `not-resettable`, no volume touched), then `volume rm` (never `-f`) each declared volume — the runtime refuses a volume a container started using after the check, and that volume is reported as kept. Result lists the outcome per volume; definition, secrets and run dir untouched. No declared volumes → 409 `no-data`. Logs `[services] <id> data reset (<n> volumes)`.
**Return shape.** `{ volumes: [{ name, removed, reason? }] }`; `remove` with `purgeData` returns the same list beside its `{ ok, hint? }` (`service-manager.ts:831`; `OciDriver.remove` returns `void` today, `oci-driver.ts:350`).
**Same guards for `remove --purge-data`** (MODIFIED "Adding, updating and removing services are explicit actions"): `OciDriver.remove` today runs `volume rm` on every declared volume after `rm -f` with no shared-volume check (`oci-driver.ts:350-356`), and the Remove dialog offers "Also delete data volumes", so the UI would otherwise drive the unguarded path. A purge keeps (and reports) any volume another definition declares or a foreign container uses, and never forces `volume rm`. One helper serves both routes.

### D7 — prune
`POST /api/services/prune`: operate. Candidates: (a) containers labelled `pi.owner=<instanceId>` whose `pi.service` is not in `services.json` (one `ps -a` per reachable runtime, same as `adoptAll`; unreachable runtimes are listed in the dry-run response so a clean list is not mistaken for "nothing left"); (b) `services-run/<name>/` where `<name>` matches `SERVICE_ID_PATTERN` (excludes `.docker-config` and any other dot-dir), is not defined, and has no live recorded pid (the native driver's group-aware liveness — `signalZero(-pid)` on POSIX, `native-driver.ts:95-98` — so live workers of a dead leader count; `EPERM` counts as live, only `ESRCH` as dead; PID reuse can only make prune keep garbage, never delete live state). Running orphan containers are reported as skipped, never force-removed. Never volumes, foreign `pi.owner`, or defined services.
`{ dryRun: true }` → `{ candidates, unreachableRuntimes }`. `{ dryRun: false, ids }` → considers only `ids`; each is re-checked under its own lifecycle lock after re-reading `services.json`, then removed. `definitions.mutate` cannot be used: its callback must be synchronous (`auth/locked-json-file.ts:117`, `definitions-store.ts:98-105`) and it always rewrites the file. Residual race: an id added after its re-check but before removal loses an empty run dir or an orphan container — harmless, since the definition, secrets and volumes are untouched and the next start recreates both. Returns `{ removed, skipped }`. 409 while `definitionsCorrupt`, and 409 `definitions-missing` while `services.json` does not exist — a missing file reads as "zero services" (`definitions-store.ts:89-91`), which would make every owned container and run dir a candidate.

### D8 — Lease holders and caller authority in status
`ServiceStatus.leaseHolders?: Array<{ holder?: string; expiresAt: string /* ISO 8601 */ }>` — live leases only, never `leaseId`; status readers are observers, not lease owners. `holder` is caller-supplied (≤200 chars) and is rendered as text only.
`ServiceList.canOperate: boolean` = `hasOperateAuthority(req) && tierRefusalFor(req, "operate") === null` — the same two checks a mutating route passes (a `control`-tier login session passes the first but is refused by the tier gate). One shared predicate; the route passes it into `list()`, which is caller-blind today (`routes.ts:75`). The ≤200-char holder limit moves into `LeaseTable.create` (today only the ensure route slices, `routes.ts:94`). The client uses it to disable actions and skip the logs request; the server still enforces on every route.

### D9 — Action gating table (client, from state)

| State | Start | Stop | Force stop | Retry | Prefetch | Reset data |
|---|---|---|---|---|---|---|
| stopped | ✓ | | | | ✓ native | ✓ |
| starting | | ✓ | | | | |
| healthy / idle | | ✓ unless `startedBy: external` | ✓ if `startedBy: external` | | | |
| blocked | | ✓ unless `startedBy: external` | ✓ if `startedBy: external` | | | |
| stopping | | | | | | |
| stop-failed | | ✓ (retries the stop) | | | | |
| failed | | | | ✓ | | |
| unavailable | ✓ as "Try again" (except adoption-uncertain / duplicate-instances / owner-conflict) | ✓ duplicate-instances | ✓ adoption-uncertain | | ✓ package-absent | ✓ except adoption-uncertain / duplicate-instances / owner-conflict |

`start` is `ensure` without a lease (`service-manager.ts:616-618`) and `unavailable` is re-derived on every ensure except the sticky reasons `adoption-uncertain` / `owner-conflict` / `duplicate-instances` (`service-manager.ts:67,464`), which is why Try again excludes them; "Try again" re-evaluates after the user fixes the cause (e.g. starts Docker); it never fetches. Force is offered exactly where the server refuses a plain stop (`service-manager.ts:643-649`). `duplicate-instances` = several containers of *this* owner (main spec, adoption); `owner-conflict` = a foreign owner. Without a recorded instance OCI `stop` matches `pi.service` only (`oci-driver.ts:333-337`), which contradicts the main spec's "stop/remove act on all matches" of `pi.service` + `pi.owner` and could stop a foreign container; this change adds the owner label to that filter (ADDED "Container stop is owner-scoped"), after which Stop is safe for `duplicate-instances`. Reset data is shown only when the definition declares volumes.
Pin/unpin available when `mode === "managed"`; Remove always available. The server remains the authority — a refused action shows its error code and hint inline.

### D10 — Destructive confirmations
- Remove: dialog lists what is removed; "Also delete data volumes" unchecked by default, names each volume.
- Reset data: type-the-id confirmation; names each volume.
- Prune: always dry-run first; shows candidates and unchecked runtimes; confirm sends exactly the previewed ids; the result names anything skipped.
- Force stop: dialog explains which safety check is overridden (PID-reuse check for `adoption-uncertain`; "not started by the dashboard" for external instances).

### D11 — operate_required handling
A 403 `operate_required` renders the existing remedy UI (`reason` + `remedies`, change `surface-operate-required-remedy`) inline at the action, not a toast. When `canOperate` is false the page shows actions disabled, one banner with the remedies, and the logs panel sends no request.

### D12 — Secrets entry
Per declared secret: name, source (`store:` / `env:` / `keychain:` ref text), configured badge. Store-backed only: password input + Save → `PUT …/secrets/:name`; the input clears on success and no value is ever kept in state after submit. Non-store refs are read-only with their ref.

## Risks / Trade-offs

- Logs leak transformed secrets → D5 residual; operate-only limits audience; threat model states it.
- Plaintext output at rest (≤ ~1 MiB, 0600, run dir that already holds secret files) → stated exception in `service-secrets`.
- Any login session at tier `operate` can read logs → existing predicate + tier gate, stated, not widened.
- Unreadable or < 4-character secret hides all output → fail closed by design; the reason names the secret and links to its input.
- Output head lost on truncation → accepted (keeper-log precedent).
- `services_changed` storm during a flapping service → server coalesces to ≤ 2/s, client jitter, probe-free list.
- `services_changed` timing visible to every socket → accepted, content-free (D3).
- Prune holds the definitions lock across container removal → a concurrent add waits seconds; explicit operator action.
- docker/podman CLI parity (`--timestamps` format, stderr routing, `ps --filter volume=`) → unverified here; a test-plan item records real output of both runtimes as fixtures before the parser is written.
- Stale client gating vs server state → server authority + inline error.

## Migration Plan

Additive. Existing running native/attached instances keep `stdio: "ignore"` until next start (no log file → logs route reports `no-output`). New fields (`leaseHolders`, `canOperate`, `services_changed`) are optional to older clients. An instance started before this change has no `start.json` → its logs report `no-output` until restart. Rollback: revert; `output.log`, `start.json` and `services-digest.key` are inert files (the first two deleted by `service remove`). Behaviour changes: `--purge-data` keeps and reports a shared or in-use volume; OCI stop without an instance no longer touches foreign-owner containers.

## Open Questions

- None blocking. The roadmap's "approve" maps to the add-from-offer review/confirm (D10 flow); no separate approval queue.
