# Findings — managed services spike

Each verdict below cites a probe and its observed output. A verdict is one of
**measured**, **not-measurable** (with the reason), or **needs-new-mechanism**.
Host: macOS arm64, Docker Desktop 29.1.3, podman 6.1.0 client / 5.8.6 engine
(applehv machine), qemu 10.1.1, VirtualBox 7.2.6, VMware Fusion (vmrun 1.17.0),
uv 0.8.18, OBS 5.7.4 (obs-websocket), pi 1.0.0.

**Harness.** `/tmp/svc-spike/`: probe scripts, a scratch `services.json`, a
scratch 0600 `services-secrets.json`, and a throwaway lease controller
(`probes/controller.mjs`). Containers carry the label `pi.spike=managed-services`.
Marker secrets are `SVCSPIKE-*`. The single real secret is the OBS websocket
password, imported with the user's consent and printed nowhere (§S3.4).
Baseline shas were taken of `~/.pi/dashboard/config.json`,
`~/.pi/agent/plugin-credentials.json`, `~/.pi/agent/auth.json`, the OBS
websocket config, and both image inventories (§Teardown).

---

## S1 — one OCI driver over docker and podman

### S1.1 Identical lifecycle — **MEASURED, with two podman blockers**

Probe: `probes/s1-lifecycle.sh <rt>`, which runs
`create --label … -p 127.0.0.1::8000 --health-cmd … ghcr.io/astral-sh/uv:python3.12-bookworm-slim python3 -m http.server 8000`
and then `start`, polls health, and curls the published port. This image is
present in both stores.

| | docker | podman |
|---|---|---|
| create | rc 0 | **rc 125** `error getting credentials - err: exit status 1` |
| healthy after | 10.36 s | 3.01 s (with workaround) |
| host curl of the published port | **200** | **000** |
| stop (python as PID 1) | 5.24 s, exit 137 | 5.20 s, exit 137 |

- **Credential-helper trap.** The podman remote client invokes every
  `credHelpers` entry in `~/.docker/config.json` on `create`/`run`, even with
  `--pull=never` and a local image. Here that was
  `europe-west3-docker.pkg.dev: gcloud`, whose token had expired, so the whole
  call failed. `DOCKER_CONFIG=<dir with {}>` fixes it. **The driver must run the
  runtime with an isolated, empty auth config** unless it is pulling from a
  registry that needs credentials.
- **No host port forwarding on podman.** All four bind forms
  (`127.0.0.1::8000`, `8000`, `127.0.0.1:47811:8000`, `47812:8000`) returned
  000 from macOS, and `lsof` showed no host listener. The port was reachable
  inside the container (200) and from the VM (`podman machine ssh curl` → 200).
  It was still broken after a machine restart (§S1.4). **Measured
  workaround:** `ssh -i <machine identity> -p <machine ssh port> -L 127.0.0.1:H:127.0.0.1:P core@127.0.0.1`
  → 200. The cause is unconfirmed: gvproxy flags, and/or the 6.1.0 client vs
  5.8.6 engine skew.
- **The image architecture differs per store.** The podman copy of the same tag
  is `linux/amd64` (emulated). docker reported no warning.
- **Stopping takes the full timeout** when the service process ignores SIGTERM
  as PID 1. Templates need `--init` or an explicit `StopSignal`.

### S1.2 Inspect field mapping — **MEASURED**

The same JSON paths work on both runtimes: `State.Status`, `State.Running`,
`State.Health.Status`, `State.StartedAt`, `State.ExitCode`, `State.Pid`,
`Config.Labels`, `NetworkSettings.Ports`, `Config.Image`, `Image`,
`RestartCount`, `Config.Env`. The differences that need normalising:

- `StartedAt` is `…Z` on docker and `…+02:00` on podman (both parse as ISO).
- `Image` is `sha256:<id>` on docker and a bare `<id>` on podman.
- `Config.Labels` includes the image's OCI labels, so filter on the `pi.*`
  prefix.
- **docker reassigned the ephemeral host port on every restart** (54264 → 62520,
  and 62520 → 58920 after the Docker Desktop restart on retry).
  podman kept its port. The endpoint must be re-read after every start, or the
  host port must be pinned.

### S1.3 Adoption by label — **MEASURED**

Probe: `probes/adopt.sh`, which runs
`ps -a --filter label=pi.spike=… --filter label=pi.service=probe --filter label=pi.owner=spike --format '{{.ID}} {{.Names}} {{.State}}'`.
Identical output on both runtimes, run twice: exactly 1 container adopted, 0
duplicates.

### S1.4 Host-VM lifecycle — **MEASURED; Docker Desktop restart NOT reliable**

| | podman machine | Docker Desktop |
|---|---|---|
| stop | 14.7 s | 17.0 s (`docker desktop stop`) |
| error while stopped | `unable to connect to Podman socket: … ssh: handshake failed` | `failed to connect to the docker API at unix:///var/run/docker.sock … no such file` |
| start → API reachable | 10.9 s / 11.1 s, non-interactive | **never.** `docker desktop start --detach` printed "✓ Starting" but nothing came up in >100 s. `open -a Docker` → backend crash `opening tray: starting electron: unmarshaling start request: unexpected EOF`, monitor exit 150. A stale `cagent` helper from Sep 27 was still running. Left for the user to restart manually. |
| containers after restart | `kroki` (restart policy) came back; `buildx_buildkit_default` and the spike probe did not | n/a |

**Incident (a key design input).** Stopping Docker Desktop interrupted another
pi session's docker E2E harness (worktree
`os-add-focus-mode-and-card-block-toggles`), and a third session was found
polling `docker info`. **The host VM is shared infrastructure.** The service
layer must never stop a host VM it did not start. Even when it did start it, it
must not stop it while any container or client outside pi is active. Docker
Desktop must never be auto-stopped.

### S1.5 Image-present probe per store — **MEASURED (both live; docker on retry)**

- podman: `podman image exists pi-doc-engine:0.1.0` → 1 (absent);
  `podman image exists docker.io/yuzutech/kroki:latest` → 0 (present).
- docker (retry, daemon up): `docker image inspect pi-doc-engine:0.1.0` → 0
  (present); `docker image inspect docker.io/yuzutech/kroki:latest` → 1 (absent).
  The stores are disjoint, as expected.
- **Ambiguity:** with the daemon down, `docker image inspect pi-doc-engine:0.1.0`
  → rc 1, the same rc as "image absent". The probe must establish runtime
  reachability first and report `runtime-unreachable` separately from
  `image-absent`. Nothing was pulled.

## S2 — native ("local managed") fallback

### S2.1 `uvx docling-serve` — **MEASURED: viable, no Python pin needed**

`uvx --from docling-serve docling-serve --help` installed in 49 s on the
**default** interpreter: Python 3.14.8, docling-serve 1.36.0,
docling-jobkit 3.8.1, docling-core 2.100.0, torch 2.14.1.
`run --host 127.0.0.1 --port 47950` serves `GET /health` → 200
`{"status":"ok"}`.

### S2.2 Cold start and memory — **MEASURED (native); container NOT MEASURED**

| run | spawn → /health 200 | RSS (process group, idle) |
|---|---|---|
| 1 (first after install) | 46.21 s | 1443 MB |
| 2 | 11.47 s | 1063 MB |
| 3 | 10.18 s | 1061 MB |

Models load lazily on the first conversion, which was not measured. The
container side is not measurable: neither store has a docling-serve image, and
a pull is multi-GB (design risk rule). For the idle-stop budget, a warm restart
costs about 10 s, which supports idle timeouts in minutes rather than seconds.

### S2.3 Stop without orphans — **MEASURED**

SIGTERM to the `uvx` parent → 0 `docling-serve run` processes after 4 s, in 3
of 3 runs.

## S3 — attached service: OBS

### S3.1 Scripted launch — **MEASURED**

`open -a OBS --args --minimize-to-tray`: process up in 0.13 s, `:4455`
listening at 1.57 s, Hello (op 0) at 1.70 s. The Hello arrives **without auth**
(`authRequired: true`), so it works as an unauthenticated liveness probe
(14–18 ms).

### S3.2 Scripted quit — **MEASURED; two hazards**

- `osascript -e 'quit app "OBS"'` returns rc 1, `User cancelled. (-128)`,
  **even when the quit succeeds** (exit in 1.03 s). A stop must be judged by
  process exit, never by the command's rc.
- **Hazard: unclean-shutdown dialog.** Quitting OBS a few seconds after launch
  caused the next launch to log `Crash or unclean shutdown detected` and block
  on a modal Safe Mode dialog **before** the websocket loaded. Health
  (`connect-failed`) correctly reported the service as down, but every later
  `quit` was refused (-128) and the process stayed. It needs a human click.
  `OBS --help` has no flag to skip the check, and `--safe-mode` disables
  WebSockets. Detecting the dialog via System Events fails without
  Accessibility permission (`not allowed assistive access (-1728)`).
  Resolution: the user answered the dialog, and the **same pid 47591** went on to
  listen on `*:4455` with a valid Hello (5.7.4). The service went from
  process-alive-but-unhealthy to healthy without a restart. A driver must
  therefore treat "process up, health failing" as a distinct `blocked`/`degraded`
  state that can recover by itself or with user action. It is not a crash, and
  it must not be killed and relaunched.

### S3.3 Ownership rule — **MEASURED**

- OBS already running (the user's instance), idle-stop opted in, `DRY_STOP=1`:
  `adopt-external` → lease → release → `idle-skip-not-ours`. No stop was issued
  and the pid was unchanged.
- Complement (controller started OBS): `start` → lease → release →
  `idle-stop` at +10 s. **The stop failed silently** (the hazard above), yet
  the controller believed the service was stopped. A stop must be verified by
  polling for process exit with a timeout, and on failure the state must become
  `stop-failed`, never `stopped`.

### S3.4 Consented secret import — **MEASURED**

`server_password` (16 chars) went from OBS `config.json` to
`services-secrets.json` (0600, tmp + rename) without being echoed.
Authenticated Identify (op 1 → op 2, `negotiatedRpcVersion: 1`) used the stored
value. `grep -rlF --exclude=services-secrets.json` over the scratch tree → none.

### S3.5 Exposure detection — **MEASURED**

`lsof -iTCP:4455 -sTCP:LISTEN` → `OBS *:4455`; `netstat -an -p tcp` →
`tcp46 *.4455 LISTEN`. Non-loopback exposure can be detected without
privileges, so the health check can flag it.

## S4 — leases and crash recovery

| probe | observed |
|---|---|
| S4.1 TTL 10 s, idle 20 s, heartbeat 3 s, `kill -9` holder at 04:29:08 | `lease-expired` 04:29:16 (TTL counted from the last heartbeat), `idle-stop` 04:29:36 (+20.1 s), container stopped. **MEASURED** |
| S4.2 two leases, one released | still running at +15 s (> idle 8 s) while the other lease was live. **MEASURED** |
| S4.3 pin, then 0 leases | running at +25 s after the last lease expired. **MEASURED** |
| side finding | unpin at 04:30:34.303 → idle-stop at 04:30:34.727 (0.4 s), because the idle clock kept running during the pin. **Pin/unpin must reset the idle clock.** |

## S5 — skill fallback discipline (model behaviour)

Harness: `pi -p --no-skills --skill <svc-probe> --no-extensions --model zai/glm-5.3-flash`.
The `@fast` model returned 429 "Go usage limit exceeded", so the user chose a
substitute. A `pi-dashboard` stub on PATH either returned ensure JSON and ran
`service exec` (mode ok) or exited 3 "no server" (mode down).
`references/standalone.md` carried `FALLBACK-MARKER-7731`. JSONL tool calls
were parsed by `s5/analyze.py`.

| mode | read standalone.md | marker in JSONL | used `service exec` | correct greeting |
|---|---|---|---|---|
| ok ×5 | 0/5 | 0/5 | 5/5 | 5/5 |
| down ×5 | 5/5 | 5/5 | 0/5 | 5/5 |

**MEASURED: the wrong-read rate is 0/10**, so H5 holds for this model. Other
models were not measured; a single small model is weak evidence of
generality.

## S6 — secret delivery leak check

| path | container sees | host argv | VM `ps e` / environ | `inspect` | verdict |
|---|---|---|---|---|---|
| `--env-file` (0600, deleted after start) | yes | 0 | **1** (the container process's environ) | **contains it** (`Config.Env`) | hides argv only |
| bind-mounted file `:ro` (`~/` dir 0700) | yes | 0 | 0 | 0 | **viable** |
| `podman secret` + `--secret` | yes | 0 | 0 | 0 (`secret inspect` 0; `--showsecret` reveals it to the same user) | **viable** |
| docker `--env-file` (retry) | yes | 0 | 0 (host `ps e`); **1** in `/proc/1/environ` | **contains it** | hides argv only (same as podman) |
| docker bind-mounted file `:ro` (retry) | yes | 0 | 0 | 0 | **viable** |
| `docker secret` (retry) | — | — | — | — | **unavailable without swarm** (`This node is not a swarm manager`); not initialised, to avoid changing host state |
| `service exec` env injection (prototype) | child hash = expected | 0 (`ps axww`) | 0 (`ps axeww`) | n/a | **viable** |
| end to end, 10 pi sessions (S5) | — | — | — | — | `SVCSPIKE-64` in 0/10 JSONL, 0/10 stdout |

Probe pitfall, measured: the first `service exec` check had a false positive
because the marker appeared literally in the probe's own `sh -c` argv. Leak
probes must compare hashes and never embed the value.

### S6.5 Eliminated vs viable

- **Eliminated:** `-e KEY=value` (argv, per `spike-mcp-credential-delivery`)
  and `--env-file` for anything sensitive. Its value persists in
  `inspect` `Config.Env` and in `/proc/<pid>/environ` (S6.1).
- **Viable:** a mounted 0600 file (the only path measured clean on **both**
  runtimes), `podman secret` (podman only; `docker secret` needs swarm), and
  `service exec` env injection for skills.
  `ensure` returned no secret in 10 of 10 sessions.

## S7 — runtime and hypervisor detection

Probe: `probes/detect.mjs` (read-only; deleted at teardown). Matrix shape:
[`s7-matrix.json`](s7-matrix.json) (kept in this change).

| runtime | installed | version | reachable | capability notes |
|---|---|---|---|---|
| docker | yes | 29.1.3 | **no** (10 ms, socket missing) | every capability unavailable while down |
| podman | yes | 6.1.0 / engine 5.8.6 | yes (141 ms) | ps 15, `system df`, images 34, machine list; port forwarding broken (S1.1) |
| qemu-system-aarch64 / x86_64 | yes | 10.1.1 | n/a | **no VM inventory.** VMs are just command lines, so a qemu driver would need dashboard-owned VM definitions |
| VirtualBox | yes | 7.2.6r172322 | n/a | 0 VMs; CLI has `snapshot` and `controlvm` |
| VMware Fusion | yes | vmrun 1.17.0 | n/a | 2 VMs; verbs start/stop/suspend/pause/unpause/listSnapshots/snapshot/deleteSnapshot/revertToSnapshot; Ubuntu → 0 snapshots; **encrypted Windows 11 VM → "A password is required for this operation"**, so VM drivers need the secrets layer |
| nerdctl, colima, limactl, prlctl, orb | no | — | — | — |

Capability values for the UI matrix: `ok | ok-destructive | cli-present | needs-secret | unavailable | unsupported`.

---

## Hypotheses outcome

| H | verdict | evidence |
|---|---|---|
| H1 three ownership modes | **confirmed** | S3.3 (`startedBy` external vs dashboard), S1.3 adoption |
| H2 user-owned `services.json` | **confirmed (shape)** | S3.4 import flow; the encrypted-VM password (S7) shows VM entries need secrets as well |
| H3 driver fallback chain | **revised** | podman is not a drop-in fallback on macOS: auth trap, no host port forwarding (S1.1), per-store architecture. Native fallback is viable (S2). Host VM: never auto-stop Docker Desktop; stop only a host VM we started with no foreign users (S1.4 incident) |
| H4 leases + TTL + labels | **confirmed + amended** | S4.1–4.3, S1.3. Amendments: pin/unpin resets the idle clock; re-read the endpoint after every start (docker port reassignment, S1.2); stop is verified, `stop-failed` state (S3.3) |
| H5 fallback text not loaded | **confirmed (1 model)** | S5: 0/10 wrong reads |
| H6 storage conventional, delivery is the control | **confirmed + amended** | S6: drop `--env-file` from the allowed delivery paths; use a mounted file or runtime secrets |
| H7 capability matrix as data | **confirmed** | S7 report + matrix shape |

## Unmeasured (Linux / Windows / other)

- Docker Desktop restart reliability on a healthy install (this one may have
  been degraded by the stale `cagent`).
- The root cause of podman's missing port forwarding (version skew vs gvproxy
  config) and whether `podman machine` reinit fixes it.
- docling-serve container cold start and memory (no image; multi-GB pull).
- S5 with models other than glm-5.3-flash.
- **All Linux and Windows behaviour:** native docker without a host VM, rootless
  podman without a machine, WSL2, Windows Credential Manager, `vmrun` on
  Windows, Hyper-V detection.

## Teardown

- podman: 0 `pi.spike=managed-services` containers left, 0 spike secrets. Image
  inventory and container list are **identical** to the baseline (`diff` empty).
- `~/.pi/dashboard/config.json` and `~/.pi/agent/plugin-credentials.json`:
  shas OK. OBS websocket `config.json`: sha OK (read only).
- `~/.pi/agent/auth.json`: sha **changed**. It was last written at 05:39:16Z
  by an OAuth token refresh, with the key set unchanged. This is pi's own
  refresh, from the S5 `pi -p` runs or a concurrent session. No spike probe
  writes `auth.json`.
- `/tmp/svc-spike/` removed. `~/.svc-spike-secrets` removed.
- docker (retry, after the user restarted Docker Desktop): `svcspike-probe-docker`
  removed, 0 spike containers left. Image and container diffs against the
  baseline show only `pi-dashboard:pi-dash-test-2374803042` and
  `pi-dash-test-2374803042-pi-dashboard-1`, created by the concurrent E2E
  session's harness after Docker came back. None are spike artifacts.
  `/tmp/svc-spike-baseline/` removed.
- Left in place: the uv cache for docling-serve (`uv cache clean docling-serve`
  removes it). OBS restored by the user (pid 47591, healthy on `:4455`).
