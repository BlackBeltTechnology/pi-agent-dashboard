## Context

`parallelize-test-harness` already built the right primitives in `docker/lib-ports.sh`:
- `derive_project` — compose-legal project name = pure function of `HOST_CWD` (cksum).
- `derive_hash` + `find_free_in_window` — stable per-worktree start port + atomic in-window probe over disjoint windows (dashboard 18000–18999, gateway 19000–19999).

The manual path uses them. The managed e2e path does not — it overrides with `probeFreePort()` and pins the pair verbatim, which is where both bugs live.

## Decision 1 — Managed e2e derives in-window instead of probing `:0`

**Reject** raw ephemeral `:0` probing for managed mode. **Adopt** the same `test-up.sh` derivation the manual path already trusts.

Flow:
```
global-setup.ts                         test-up.sh                         lifecycle.ts (workers)
───────────────                         ──────────                         ─────────────────────
mkdtemp workspace  ──HOST_CWD──▶ derive_project + derive_ports (in-window)
spawn test-up (NO port env)             write .pi-test-harness.json
wait for state file  ◀──{dashboardPort, gatewayPort}──┘
set PW_E2E_PORT / PW_GATEWAY_PORT  ─────────────────────────────────────▶ inherit → baseURL in sync
waitForHealth(resolvedPort)
```

Why this is safe across parallel runs: each managed run boots from a **unique** `mkdtemp` workspace → unique cksum → distinct in-window start slot **and** distinct compose project. `find_free_in_window` then guarantees an actually-free port.

`USE_RUNNING` (attach) keeps trusting `PW_E2E_PORT` / `PW_GATEWAY_PORT` defaults (18000 / 18999) — unchanged.

**Sequencing wrinkle:** `lifecycle.ts` is imported by `playwright.config.ts` *and* by every worker, and currently resolves the port at module top-level (before the container exists). The resolved-from-state-file value is only known after `global-setup` boots. Resolution: `global-setup` writes `PW_E2E_PORT`/`PW_GATEWAY_PORT` into `process.env` after reading the state file; workers spawn later and inherit it. The main process's `baseURL` is read from the same env in config. (Same propagation contract the current code already relies on, just sourced from the state file instead of a `:0` probe.)

## Decision 2 — Retry the bind to close the residual TOCTOU gap

Even in-window, a probe→`docker up` gap remains (another process can grab the port between `find_free_in_window` returning and Docker binding). Wrap the final `up` in a bounded loop:

```
attempt=0
until docker compose ... up "$@"; do
  grep -q 'port is already allocated' "$up_stderr" || break   # only retry the race, not real failures
  (( ++attempt >= MAX_BIND_RETRIES )) && exit 1
  derive_ports        # next free slot in-window
  rewrite state file
done
```

`MAX_BIND_RETRIES` small (e.g. 5). Non-port failures propagate immediately — no masking of real boot errors. Only applies when `derive_ports` owns the port (skip retry-rederive when ports were pinned verbatim by an external caller, to preserve the e2e-pair contract; with Decision 1 the e2e path no longer pins, so retry is active for it).

## Decision 3 — Per-worktree image tag (LOAD-BEARING, not just clobber-avoidance)

**Finding (from reading the entrypoints):** the container has TWO distinct code surfaces, and they are not the same thing.

- **Dashboard's own source = BAKED into the image.** `Dockerfile` does `WORKDIR /app` + `COPY packages ./packages` + `RUN npm install`, links `pi-dashboard` on PATH from `/app`. `test-entrypoint.sh` launches the daemon via the base entrypoint's `pi-dashboard start` — i.e. the `/app` baked binary. The server AND client a spec exercises run from the image.
- **`HOST_CWD` overlay = the managed WORKSPACE, not the app.** `compose.test.yml` mounts `${HOST_CWD}:/mnt/test-lower:ro`; `test-entrypoint.sh` overlays it writable at the identical path. This is only the directory pi sessions spawn into / git-op / pin — the "project being worked on," never the dashboard's own source.

**Consequence:** the overlay does NOT make the dashboard worktree-specific — only the workspace. With a shared `pi-dashboard:local` tag and warm reuse, worktree B silently runs worktree A's **server + client** code. So the per-worktree image is load-bearing for correctness, not merely clobber-avoidance.

`compose.yml` hardcodes `image: pi-dashboard:local`. Override in `compose.test.yml`:
```yaml
image: "pi-dashboard:${TEST_IMAGE_TAG:-local}"
```
`test-up.sh` exports `TEST_IMAGE_TAG="$COMPOSE_PROJECT_NAME"` (pure function of `HOST_CWD`, stable per worktree). Both halves are non-negotiable:
- **Per-worktree tag** → no two worktrees share an image → no silent wrong-code reuse, no concurrent same-tag build clobber.
- **`--build` on the managed path is MANDATORY, not an optimization to remove.** The dashboard executes baked source; without `--build` the run tests whichever worktree built the tag first. BuildKit layer cache keeps it cheap — only the `COPY packages` layer changes between worktrees; base + `npm install` layers are cache hits. Distinct tags build concurrently without contention.

**Alternative considered — content-hash tag:** tag by a hash of the build context. Rejected: more moving parts, and the worktree-path tag already gives per-worktree isolation, which is the actual requirement. A stale tag within the *same* worktree is desired cache behaviour, not a bug.

## Decision 4 — Teardown removes the per-worktree image

One image per worktree would accumulate across runs. `test-down.sh` removes the worktree's image after `down -v`:
```
docker image rm -f "pi-dashboard:${project}" 2>/dev/null || true
```
- Runs AFTER `down -v` so no container still references the tag.
- Re-derives `project` from `$PWD` (same pure function teardown already uses for `-p`), so it targets only the calling worktree's tag — never another worktree's live image.
- Best-effort / non-fatal: a missing tag (already pruned, or `up` never built) must not fail teardown. Guarded with `|| true`.
- The base `pi-dashboard:local` tag is never touched (different name), so manual/dev flows are unaffected.

## Risks

- **State-file read timing:** `global-setup` must wait for `.pi-test-harness.json` to exist *and* be parseable before reading. Poll with a short deadline; the file is written synchronously by `test-up.sh` before `exec ... up`, so it appears well before health.
