## 0. Scratch harness (never touch live dashboard state)

- [x] 0.1 Create `/tmp/svc-spike/` with a scratch `services.json`, a scratch 0600 `services-secrets.json`, and a probe script dir; verify `~/.pi/dashboard/config.json` and `~/.pi/agent/*credentials*.json` are byte-identical before and after the spike (`shasum` recorded at start and at teardown)
- [x] 0.2 Record the baseline image inventory of both runtimes (`docker images --digests`, `podman images --digests`) and OBS state (running? config sha); verify the teardown task can diff against it
- [x] 0.3 Fix the marker convention: every probe secret is `SVCSPIKE-<n>` except the single consented OBS import; verify by grepping the scratch tree for anything that is not a marker before writing findings

## 1. S1 — one OCI driver over docker and podman

- [x] 1.1 Run the same `create → start → health → stop → rm` sequence for a small labelled image (`pi.spike=managed-services`, `pi.service=probe`) against docker and podman with the binary as the only variable; verify both reach healthy and record every argv or output difference
- [x] 1.2 Diff the `inspect` JSON fields a driver needs (state, health, ports, labels, started-at) between the two runtimes; verify each needed field has a mapped path in both, or record it as a gap
- [x] 1.3 Simulate a server restart (kill the probe controller, restart it) and adopt the running container by label only; verify no duplicate is created and state is recovered from `inspect`
- [x] 1.4 Measure host-VM lifecycle: `podman machine stop/start` and Docker Desktop's stopped state; verify what `info` returns in each state and the time to reachable, and record whether the host VM can be started on demand non-interactively
- [x] 1.5 Confirm image-store separation with `pi-doc-engine:0.1.0` (docker only) and `kroki` (podman only) using an `image present?` probe per runtime; verify the probe distinguishes them without pulling anything

## 2. S2 — native ("local managed") fallback

- [x] 2.1 Try `uvx docling-serve` on the default Python and with `--python 3.12`; verify which starts and serves its health endpoint, recording the exact working recipe or the failure output
- [x] 2.2 Measure cold start (process spawn → healthy) and resident memory for native vs a container docling-serve, if a container image is obtainable without a multi-GB pull; otherwise mark the container side not-measured; verify the numbers come from timed runs (3 runs each)
- [x] 2.3 Verify pid-tracked stop: SIGTERM the native process tree and confirm no orphaned worker processes remain (`pgrep -f docling`)

## 3. S3 — attached service: OBS

- [x] 3.1 With OBS not running (or with explicit user go-ahead), launch it via `open -a OBS --args --minimize-to-tray`; verify time-to-`:4455`-listening and that the obs-websocket `Hello` (op 0) frame arrives without auth
- [x] 3.2 Quit via `osascript -e 'quit app "OBS"'`; verify a clean exit and record whether OBS raises a blocking dialog (for example, while recording) that would make a scripted stop unsafe
- [x] 3.3 Ownership rule: with OBS started by the user beforehand, run ensure → release → idle elapse; verify the probe controller records `startedBy: external` and never sends the stop command
- [x] 3.4 Consented import of `server_password` from OBS's `config.json` into the scratch secrets file; verify a successful authenticated `Identify` (op 1 → op 2) using the stored value, and that the value appears in no log line or stdout
- [x] 3.5 Record the bind address finding (`*:4455` vs loopback) and whether the health probe can detect non-loopback exposure (`lsof` / `netstat`); verify with observed output

## 4. S4 — leases and crash recovery

- [x] 4.1 Acquire a lease from a child process, then `kill -9` it; verify the lease expires after its TTL and idle-stop fires after `idleStopMinutes` (use short values, for example TTL 10s and idle 20s)
- [x] 4.2 Two concurrent holders, one released; verify the service stays up until the second lease ends
- [x] 4.3 Pin overrides idle; verify a pinned service with zero leases is still running after the idle window

## 5. S5 — skill fallback discipline (model behaviour)

- [x] 5.1 Create a scratch skill: a short `SKILL.md` calling `pi-dashboard service ensure probe --json` (stubbed by the probe controller), plus `references/standalone.md` with a unique marker line; verify the skill loads in a scratch pi agent dir
- [x] 5.2 Five runs with the stub returning ok; verify from the session JSONL that `references/standalone.md` was never read (no read tool call on that path, no marker in the transcript)
- [x] 5.3 Five runs with the stub failing (no server); verify the fallback was read and followed in each run
- [x] 5.4 Record the wrong-read rate for both cases and a verdict on H5 (keep it, or move to the bridge-swap alternative)

## 6. S6 — secret delivery leak check

- [x] 6.1 Start a container with a marker secret via `--env-file` (0600 tmp file deleted after start); verify the marker is absent from sampled `ps axeww` output and record whether it appears in `docker inspect` / `podman inspect` (Config.Env)
- [x] 6.2 Compare a mounted secrets file (`-v secret:/run/secrets/x:ro`); verify the marker is absent from both argv and `inspect`
- [x] 6.3 Prototype `service exec probe -- <cmd>` env injection; verify the child sees the marker and the parent pi session's env and transcript do not
- [x] 6.4 Run the S5 skill end to end with a marker secret; verify `grep SVCSPIKE` over the session JSONL returns nothing
- [x] 6.5 Record which delivery paths are eliminated (with the observation that kills each) and which remain viable

## 7. S7 — runtime and hypervisor detection matrix

- [x] 7.1 Probe docker, podman, nerdctl, colima, qemu, VBoxManage, vmrun and prlctl for presence, version, and reachability (daemon or host-VM up); verify the output as one JSON report
- [x] 7.2 For each detected runtime, record which capability commands exist and work read-only (`system df`, `ps`, `logs`, `stats`, snapshot list); verify each entry cites the probe output, with no destructive action run
- [x] 7.3 Draft the capability-matrix JSON shape for the Settings page; verify every field is populated from 7.1/7.2 observations

## 8. Report and teardown

- [x] 8.1 Write `findings.md` with one section per question (S1–S7); each answer carries the probe, the observed output, and a verdict (measured / not-measurable / needs-new-mechanism); verify every verdict cites an observation
- [x] 8.2 Mark each hypothesis H1–H7 in `design.md` as confirmed, revised, or falsified, with a pointer to its finding; verify none is left unmarked
- [x] 8.3 List the Linux/Windows questions left unmeasured; verify the list is explicit (non-empty, or states "none")
- [x] 8.4 Teardown: remove `/tmp/svc-spike/` and all `pi.spike=managed-services` containers; verify the image inventories, the OBS config sha, and the dashboard and credential file shas match the 0.1/0.2 baselines
