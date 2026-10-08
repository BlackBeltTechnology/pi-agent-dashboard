## Why

Skills and plugins that depend on an external service each manage that service
themselves, and each does it differently:

- `document-converter` hardcodes `docker run --rm -i pi-doc-engine` in
  `packages/document-converter/src/engine.ts` (its own `dockerBin` override,
  its own mount confinement, its own `DOCKER_UNAVAILABLE` error).
- The `docling-graph` user skill ships its own `docker-compose.yml`, starts and
  stops Neo4j itself, generates and stores its own Neo4j password, and carries
  "Docker not found / Neo4j won't start" troubleshooting prose in `SKILL.md`.
- User-owned local services (for example OBS Studio's obs-websocket on `:4455`)
  have no registry at all — every skill that wants them must know the port, the
  password location, and how to launch the app.

`add-skill-tool-provisioning` gave skills a way to declare **"is this tool
present?"** (`pi.tools` → `ToolRegistry`, including a `docker-image` probe). No
layer answers **"is it running, healthy, where do I reach it, who started it,
when may it stop?"** The goal is a dashboard-owned service layer: plugins offer
service definitions, the user adds them to a separate `services.json`, and the
dashboard owns start / health / idle-stop / adoption / secrets delivery, so
skills shrink to "ensure the service, use the endpoint".

Several design questions cannot be settled by reasoning alone. They depend on
observed runtime behaviour: docker vs podman differences, whether native docling
works on this Python, how OBS behaves when launched and quit by script, lease
recovery after a crashed session, whether the model reliably skips a skill's
fallback text, and whether any secret reaches a session transcript. This spike
**measures** them before the core change is written, following the precedent of
`spike-mcp-credential-delivery`, whose doubt cycles falsified two delivery
designs that looked sound on paper.

## What Changes

Nothing ships. The deliverable is `findings.md`, recording measured answers.
Each answer carries the probe command and the observed output, plus a verdict:
**measured / not-measurable / needs-new-mechanism**. Probe code lives in a
scratch directory outside `packages/` and is deleted at teardown. No spec deltas.

Questions to settle (detailed with exit criteria in `tasks.md`):

- **S1 — one OCI driver over docker and podman.** Can one code path do
  `ensure → healthy → idle-stop → adopt-after-restart` on both? What actually
  differs (`inspect` JSON, labels, socket/context, `podman machine` state)? The
  two runtimes keep **separate image stores**. On this machine `pi-doc-engine`
  (5.36 GB) exists only in docker and `kroki` only in podman.
- **S2 — native ("local managed") fallback.** Does `uvx` run `docling-serve`
  when no container runtime is available? Does it need a pinned Python
  (the system Python is 3.14)? What are the cold-start time and memory compared
  with the container?
- **S3 — attached service, concrete example: OBS.** Can a script start and
  stop OBS (`open -a` / `osascript`)? Is the obs-websocket v5 `Hello` frame a
  usable health probe? Can the `server_password` be imported from OBS's config
  with consent? Does `startedBy` ownership hold, so the dashboard never stops
  an OBS it did not start?
- **S4 — leases.** Does refcount + TTL heartbeat recover when the pi session
  holding a lease crashes?
- **S5 — skill fallback discipline.** With a short `SKILL.md` that calls
  `pi-dashboard service ensure` and points to `references/standalone.md` only on
  failure, does the model avoid reading the fallback when the dashboard is up?
  Does it read it when the dashboard is down?
- **S6 — secret delivery leak check.** Using the store-vs-delivery rules in
  `design.md`, does any secret value appear in a session JSONL, in `ps` argv, or
  in `docker inspect` / `podman inspect`?
- **S7 — runtime and hypervisor detection.** What do docker / podman / qemu /
  VirtualBox / VMware report (version, reachability, host-VM state)? What is the
  capability matrix (prune, snapshot, suspend, logs, stats, exec) that a
  Settings → Services page can render?

### Roadmap the findings feed (not part of this change)

1. `add-service-registry-core` — ServiceManager, state machine, leases + idle,
   OCI + native drivers, `ensure`/`exec` CLI + REST, label adoption,
   `services.json` + secrets store, add-from-plugin flow.
2. `add-services-settings-ui` — Settings → Services, runtime + per-service
   actions (prune, logs, pin, reset data, approve, leases).
3. `migrate-skills-to-services` — docling-serve, Neo4j (`docling-graph`),
   `pi-doc-engine` job mode, `references/standalone.md` pattern.
4. `add-attached-external-and-vm-drivers` — attached (user commands), external
   (probe + endpoint), VM capability actions (snapshot / suspend via `vmrun` /
   `VBoxManage` / qemu).

## Capabilities

### New Capabilities

(none — an investigation, no shipped behaviour; `skip_specs: true`)

### Modified Capabilities

(none — the roadmap changes own the eventual spec deltas, expected to extend
`tool-registry` and reuse `plugin-credential-store` conventions)

## Impact

- `openspec/changes/spike-managed-services/findings.md` — the deliverable.
- Scratch harness only: `/tmp/svc-spike/` (probe scripts, scratch
  `services.json`, scratch secrets file, scratch skill dir) and throwaway
  containers labelled `pi.spike=managed-services`.
- Live state touched read-only or restored: OBS config file (read only, with
  consent), the user's OBS process (only launched/quit when it was not already
  running), docker/podman image stores (no pruning of pre-existing images).
- No `packages/` source modified. No change to `~/.pi/dashboard/config.json`
  or `~/.pi/agent/*credentials*.json`.

## Discipline Skills

- `security-hardening` — S3 and S6 handle real secrets (the OBS websocket
  password, a generated Neo4j password) and probe exactly where they leak
  (session JSONL, argv, `inspect` output, REST responses). The probes themselves
  must not leak a live secret.
- `systematic-debugging` — evidence before conclusion. Each verdict must cite an
  observation, not a reading of documentation or source.
- `performance-optimization` — S2 compares cold-start time and resident memory
  between container and native docling. Measure first, and record numbers, not
  impressions.
- `doubt-driven-review` — the findings drive an architecture choice (driver
  fallback, lease model, secrets delivery) for four follow-up changes, and
  `findings.md` is reviewed before `add-service-registry-core` is drafted.
