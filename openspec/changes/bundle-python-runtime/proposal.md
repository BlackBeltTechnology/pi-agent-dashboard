## Why

Agent tool calls (and the bash tool calls they issue) increasingly need a working Python interpreter with runtime `pip install` capability, but the host machine's Python is absent, ancient, or unpredictable across all three platforms (macOS ships no reliable `python3`, Linux varies, Windows has none by default). The dashboard already bundles two runtimes — git+sh (`resources/git/`, Windows-only) and Node (`resources/node/`) — with a proven build-time download+verify and runtime PATH-injection pattern. Bundling a Python env closes the gap using the exact same seams.

## What Changes

- Bundle **`uv`** (Astral's package manager, single static binary) into `resources/uv/` and a per-arch **`python-build-standalone`** interpreter tarball into `resources/python-dist/` — **Tier 2** bundle shape: offline interpreter install via `file://` mirror, online package installs (graceful degradation when offline: interpreter + venv still materialize, only `pip install` needs network).
- Add `download-python.mjs` (sha256-pinned, GO/NO-GO asserted) called from `bundle-server.mjs`, mirroring `download-git-windows.mjs`.
- **Materialize a venv on the user's machine** (eager on server boot, single-flight, atomic rename via versioned overlay dirs) — never ship a pre-built venv (avoids venv relocatability breakage). The spawn-env inject seam stays **synchronous**: it prepends the ready overlay when the freshness stamp matches, else falls back to the **bare bundled interpreter** (present in `resources/` immediately) so `python` always resolves, and fires a fire-and-forget background rebuild. Two-layer env:
  - `py-base` — `--link-mode copy`, hash-pinned `requirements.txt`, pristine/reproducible, cache-independent.
  - `py-overlay` — `--system-site-packages` onto `py-base`, agent-writable, prepended to `PATH`; arbitrary agent installs land here so the baseline stays recoverable by nuke+rebuild.
- Add `augmentEnvWithPythonSource` wired into the **same spawn-env path** as `augmentEnvWithGitSource` (both injection points: `ToolResolver.buildSpawnEnv` and the terminal PTY path), so arbitrary **bash tool calls** (`python x.py`, `pip install foo`) resolve the bundled env via `PATH`. Unlike the win32-only git seam, this is **active on all platforms**; it injects only `PATH` (+ `VIRTUAL_ENV`, + `SSL_CERT_FILE` → the interpreter's own CA bundle so agent `python -m pip` HTTPS works). `UV_*` vars are confined to the materialize subprocess, never the general spawn env.
- Add a **blocking verification spike** confirming uv's `UV_PYTHON_INSTALL_MIRROR` `file://` layout against real python-build-standalone tarballs (per-triple), plus the interpreter's per-platform bindir + `cacert.pem` layout; documented fallback = self-extract + `uv venv --python <path>`.
- Add tri-state config `pythonSource: auto | host | bundled`, **default `bundled` on all platforms** (polarity flipped vs git: host Python is a swamp; host is opt-in escape hatch).
- Add a Doctor readout (`getPythonSourceReadout`): interpreter version, venv health/stamp, baseline satisfied, pip network reachability.
- Security posture: arbitrary agent `pip install` == existing bash trust level (the agent already has arbitrary code execution via bash — pip adds no new capability). Baseline stays `--require-hashes`; runtime-install approval defers to the in-flight `add-supervised-tool-approval` gate at the bash boundary. No bespoke Python sandbox.

## Capabilities

### New Capabilities
- `bundled-python-runtime`: build-time bundling of `uv` + per-arch standalone interpreter tarball into Electron `resources/`, with sha256 pinning and GO/NO-GO build asserts.
- `python-env-materialization`: runtime, eager, single-flight creation of the `py-base` + `py-overlay` venv on the user's machine, offline interpreter install via `file://` mirror, freshness-stamped rebuild on interpreter version bump.
- `python-source-selection`: tri-state `pythonSource` config, spawn-env PATH injection (`augmentEnvWithPythonSource`) so tool/bash calls resolve the bundled env, and the Doctor readout.

### Modified Capabilities
<!-- None: the git/node bundling changes are precedent patterns, not spec-level modifications to existing capabilities. -->

## Impact

- **Build:** `packages/electron/scripts/bundle-server.mjs` (new download+GO/NO-GO block), new `download-python.mjs`, `_python-version.json` pin file, per-arch build matrix already exists (same triples as node-pty prebuilds).
- **Bundle size:** +~30-40 MB (`uv`) +~40 MB (one per-arch interpreter tarball). No wheelhouse (Tier 2).
- **Runtime:** `packages/shared/src/platform/` — new `select-python-source.ts`, `ensure-bundled-python.ts`, `python-source.ts` (mirrors the git-source trio); new `materializePyEnv()` single-flight module (reuses atomic-rename + freshness-stamp idioms from `bundle-server.mjs`).
- **Config:** `packages/shared/src/config.ts` — add `pythonSource`.
- **Doctor:** new `getPythonSourceReadout`.
- **Env pins (materialize subprocess ONLY — not leaked into spawned children):** `UV_PYTHON_INSTALL_MIRROR=file://…`, `UV_CACHE_DIR=~/.pi-dashboard/uv-cache`, `UV_MANAGED_PYTHON=1`, `UV_OFFLINE`/`--offline`, `UV_NO_CONFIG=1`. Spawn seam injects only `PATH`(+`VIRTUAL_ENV`,+`SSL_CERT_FILE`).
- **Security:** integrates with `add-supervised-tool-approval` (no new gate); licenses — `uv` (Apache-2.0/MIT) and `python-build-standalone` (permissive) require THIRD-PARTY-LICENSE attribution like the git bundle. *(verify license texts during implementation.)*

## Discipline Skills

- `security-hardening` — arbitrary agent-driven `pip install`, `--require-hashes` baseline, supply-chain trust boundary, THIRD-PARTY license attribution.
- `performance-optimization` — first-run/boot materialization latency budget; eager single-flight warm; uv CoW/hardlink dedup.
- `systematic-debugging` — cross-platform venv/interpreter materialization failures (relocatability, same-volume link rule, torn writes).
