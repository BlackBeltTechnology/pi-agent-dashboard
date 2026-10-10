## Why

Skills and plugins that depend on an external runtime each manage it themselves.
`document-converter` hardcodes `docker run --rm -i pi-doc-engine`
(`packages/document-converter/src/engine.ts`). The `docling-graph` skill ships
its own `docker-compose.yml`, its own Neo4j password, and its own "Docker not
found" prose. User-owned services such as OBS (obs-websocket on `:4455`) have no
registry at all. `add-skill-tool-provisioning` answers **"is this tool
present?"** (`pi.tools` → `ToolRegistry`). Nothing answers **"is it running,
healthy, where do I reach it, who started it, when may it stop?"**

The archived spike `2026-10-08-spike-managed-services` measured the hard parts
on a real host. Its `findings.md` is the evidence base for every decision here:
- leases with TTL heartbeat recover from crashed holders;
- adoption by container label works on docker and podman;
- a native `uvx docling-serve` fallback is viable;
- the model skipped a skill's fallback text when the service was up (0/10 wrong
  reads; one model, exit-code branching. This change's payload form is
  re-measured in task 9.5);
- a mounted 0600 file is the only secret delivery path clean on both runtimes;
- podman on macOS needs an isolated auth config and a host tunnel;
- the shared host VM (Docker Desktop) must never be stopped by the dashboard.

## What Changes

- **Service registry + `ServiceManager` (server).** One lifecycle state machine
  (`stopped → starting → healthy ⇄ idle → stopping → stopped`, plus
  `unavailable`, `blocked`, `failed`, `stop-failed`). Leases with TTL heartbeat,
  idle-stop, and pin. Adoption after a server restart by container label or by
  recorded pid.
- **Three ownership modes behind one consumer contract** (`ensure(id)` →
  `{ state, reason?, endpoints, leaseId }`):
  - `managed` with drivers **`oci`** (docker + podman) and **`native`**
    (structured runner recipe, pid-tracked);
  - **`attached`** (user-authored start/stop commands; stops only instances the
    dashboard started);
  - **`external`** (health probe + endpoint + secrets, no lifecycle).
- **User-owned definitions file** `~/.pi/dashboard/services.json`, separate from
  `config.json`. Plugins and skill packages **offer** templates via a new
  `package.json` `pi.services` array, the sibling of `pi.tools`, discovered with
  the same `discoverSkillManifests` scan. An offer does nothing until the user
  **adds** it. A newer template surfaces as an update with a diff and is never
  applied silently. Templates are declarative only: digest-pinned image, named
  volumes, loopback ports, allowlisted native runners, no shell strings.
- **Secrets layer.** `~/.pi/dashboard/services-secrets.json` (0600, via
  `locked-json-file.ts`). Refs `store:` / `env:` / opt-in **read-only**
  `keychain:` (macOS `security`, Linux `secret-tool`). Delivery rules:
  - `ensure`, REST and logs never carry a value;
  - skills get secrets via `service exec` env injection;
  - containers get secrets via a mounted 0600 file;
  - `-e` and `--env-file` are never used for secrets.
- **Runtime detection report** (`GET /api/services/runtimes`, on demand):
  docker, podman, qemu, VirtualBox and VMware with version, reachability,
  host-VM state and an advertised capability set. It reports only. The
  dashboard never starts or stops a host VM (Docker Desktop, podman machine) or
  a guest VM.
- **No silent downloads:** OCI images are never pulled. Native packages are
  fetched only through an explicit, confirmed `prefetch`. Otherwise the reason
  is `image-absent` / `package-absent`.
- **New `ToolRegistry` definitions** (additive under the "at minimum" rule):
  `docker`, `podman`, `uvx`, `ssh`, `security` (darwin), `secret-tool` (linux),
  `lsof`, `netstat`, `VBoxManage`, `vmrun`, `qemu-system-aarch64`,
  `qemu-system-x86_64`.
- **Consumer surfaces.** CLI
  `pi-dashboard service ensure|heartbeat|release|exec|list|status|start|stop|pin|unpin|add|remove|prefetch|secret`
  and REST `/api/services/*`. Reads sit behind the network guard. **Mutations
  require an `operate`-tier authenticated caller or a locally trusted one**
  (strict-mode aware), because a user-origin
  attached entry carries argv. `ensure --json` follows the `tool-registry`
  convention: exit 0, with the outcome in `state`.
- **No `BREAKING` changes.** Existing skills keep working, and skills adopt the
  service layer incrementally.

### Not in this change (roadmap)

- `add-services-settings-ui`: Settings → Services page (actions, logs, prune,
  approval UI). This change ships REST + CLI only.
- `migrate-skills-to-services`: docling-serve and Neo4j templates,
  `pi-doc-engine` job mode, `references/standalone.md` rewrites.
- `add-vm-service-drivers`: snapshot / suspend / start for VMware, VirtualBox
  and qemu.
- Keychain **writes**, a Windows Credential Manager resolver, a `/svc/<id>/*`
  reverse proxy, and a plugin-host `ctx.services` seam.

## Capabilities

### New Capabilities

- `managed-services`: service definitions + `pi.services` offers, ownership
  modes and drivers, lifecycle state machine, leases / idle / pin, adoption,
  health probes, runtime detection, and the CLI + REST consumer contract.
- `service-secrets`: the secret store, ref resolvers (`store:` / `env:` /
  `keychain:`), and the delivery and redaction rules.

### Modified Capabilities

- `command-executor`: the tree-termination and single-source-termination
  requirements gain a `killProcessGroup(pid, opts)` helper (POSIX group SIGTERM→wait→SIGKILL with a
  group re-check; win32 delegates to `killProcess`). The existing `killProcess`
  behaviour is unchanged.

Other capabilities are reused without requirement changes:
- `tool-registry` requirements are unchanged. New binary definitions are
  additive under "Registered tool set … at minimum". The package walk in
  `pi-tools.ts` is extracted into a shared helper with `discoverSkillManifests`
  behaviour unchanged.
- The OCI driver does not reuse the `docker-image` probe, because it cannot
  separate "daemon down" from "image absent".
- `plugin-credential-store` conventions are reused via `locked-json-file.ts`.
- Tree termination uses the `command-executor` helpers.)

## Impact

- **New server module:** `packages/server/src/services/` (manager, state
  machine, leases, drivers `oci` / `native` / `attached` / `external`, health
  probes, runtime detection, secrets resolver, routes).
- **Shared types:** `packages/shared/src/services/` (definition schema, ensure
  payload, `pi.services` parser).
- **CLI:** `packages/server/src/cli.ts` gains a `service` subcommand group.
- **New files on disk:** `~/.pi/dashboard/services.json`,
  `~/.pi/dashboard/services-secrets.json`, a per-service secrets mount dir under
  `~/.pi/dashboard/services-run/` (0700; not `/tmp`, because podman machine does
  not mount `/tmp`).
- **External tools invoked:** `docker`, `podman`, `ssh` (podman tunnel), `uvx`,
  `security` (macOS) / `secret-tool` (Linux), `lsof`/`netstat` (exposure check).
  All are resolved through new `ToolRegistry` definitions.
- **Shared code touched:** `packages/shared/src/tool-registry/definitions.ts`
  (new defs) and `pi-tools.ts` (scan extraction).
- **Compatibility:** additive. No `pi.services` and no `services.json` means
  no behaviour change and no probing.
- **Rollback:** run `pi-dashboard service remove --all` **before** removing the
  module. It cleans up containers, native processes, tunnels, `services-run/`
  and secrets. Otherwise, labelled containers, pid files and the live-secret
  file remain and must be removed deliberately (design, Migration Plan).

## Discipline Skills

- `security-hardening`: executes user-authored commands, approves
  plugin-offered container specs, mounts host paths, stores and delivers
  secrets, and adds REST mutation routes reachable over a tunnel.
- `doubt-driven-review`: `pi.services` and `services.json` are new public file
  formats that third-party packages will depend on, so they are hard to change
  once shipped.
- `observability-instrumentation`: new background lifecycle (health polling,
  idle-stop, adoption) and new endpoints. Every state transition must be
  logged with its reason.
- `performance-optimization`: health polling and runtime probes run on the
  server event loop, which already has a known slow-tick history
  (`unstick-dashboard-server`). Probes must be async, bounded in concurrency,
  and measured.
- `systematic-debugging`: driver behaviour differs per runtime and OS (see
  spike findings). Fix discrepancies from observed evidence, not assumption.
