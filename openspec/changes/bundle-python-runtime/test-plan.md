# Test Plan — bundle-python-runtime

Stage: design   Generated: 2026-07-16

Scenarios derived from `specs/**/spec.md` (post doubt-review + scenario-design gate).
No performance rows: no requirement carries a latency/throughput threshold (measure-first
per the performance-optimization checkpoint, not a spec gap). No L3 rows: bundling exposes
no rendered-UI surface (Doctor readout data is L1-testable).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Bundle uv + per-arch interpreter | partition (per-triple) | electron | automated | build for target triple T | bundle step completes | `resources/uv/` has uv for T; `resources/python-dist/` has T's distro and no other triple |
| E2 | Bare interpreter runnable | BVA (cold) | L2 | automated | freshly extracted bundle, no prior materialize, no network | invoke bundled interpreter `--version` | prints a Python version, exit 0, zero network calls |
| E3 | sha256 pin | fault (corrupt) | L1 | automated | interpreter tarball with wrong sha256 | download+verify step | build aborts before extraction, exit ≠ 0, checksum-mismatch message |
| E4 | GO/NO-GO missing triple | decision-table | L1 | automated | bundle output missing interpreter for a required triple | GO/NO-GO assert | exit ≠ 0, message names the missing triple |
| E5 | Default pythonSource=bundled | decision-table | L1 | automated | `pythonSource` unset, platform ∈ {darwin,linux,win32} | `selectPythonSource()` | returns `bundled` on all three |
| E6 | Host opt-in | decision-table | L1 | automated | `pythonSource=host`, host python present | `selectPythonSource()` | returns `host`; seam does not prepend bundled env |
| E7 | Per-platform bindir | partition (os) | L1 | automated | root dir R, platform win32 vs posix | `resolveVenvBinDir(R)` | `R/Scripts` on win32, `R/bin` on posix |
| E8 | THIRD-PARTY license | presence | electron | automated | Python runtime bundled | inspect resource tree | `THIRD-PARTY-LICENSE.txt` covers uv + python-build-standalone |
| E9 | Doctor readout | partition | L1 | automated | bundled python active | `getPythonSourceReadout()` | reports source+setting, interp version, stamp-match, baseline N/N, pip reachability |

### Frontend-quirk (state / lifecycle — not UI)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Sync inject + bare fallback | state-transition | L1 | automated | overlay absent | `augmentEnvWithPythonSource(env)` (sync) | PATH prepended with bare interpreter bindir; materialize trigger fired; function returns synchronously (no await) |
| F2 | Ready overlay preferred | state-transition | L1 | automated | overlay exists, stamp == interp version | `augmentEnvWithPythonSource(env)` | PATH prepended with overlay bindir; `VIRTUAL_ENV`=overlay |
| F3 | Stale overlay rejected | state-transition (illegal edge) | L1 | automated | overlay exists, stamp ≠ interp version | `augmentEnvWithPythonSource(env)` | prepends bare interp bindir (NOT stale overlay); rebuild triggered |
| F4 | Both spawn paths injected | state (coverage) | L1 | automated | session via `buildSpawnEnv`, terminal via PTY path | spawn each | both child envs have python bindir on PATH |
| F5 | Stamp mismatch → rebuild | state-transition | L1 | automated | `.py-stamp` != bundled interp version | materialize decision | base+overlay marked for rebuild |
| F6 | Overlay persists across restart | state (no-transition) | L2 | automated | pkg installed in overlay, interp version unchanged | server restart | pkg still importable from overlay |
| F7 | Minimal env surface | invariant | L1 | automated | injection active | inspect spawned child env | no `UV_*` vars present; `SSL_CERT_FILE` → interpreter CA bundle |
| F8 | Single-flight materialize | state-convergence | L1 | automated | N concurrent materialize triggers | fire all before completion | exactly one build runs; all callers get same result |
| F9 | Torn build never visible | invariant | L1 | automated | materialize interrupted mid-build | seam resolves env | partial env never selected (temp/versioned dir; atomic visibility) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Offline pip passthrough | fault (network abort) | L2 | automated | no network, pkg not cached | agent `pip install <pkg>` | tool call gets pip's own non-zero exit + stderr verbatim; `python x.py` (stdlib+baseline) still exits 0 |
| X2 | Rebuild vs live install (Win) | fault (open handle) | L2 | automated | Windows, agent holds handles in current overlay | stamp-triggered rebuild | completes into new versioned overlay dir, no EACCES/EBUSY; later spawns resolve new overlay |
| X3 | Baseline not corrupted | invariant under fault | L2 | automated | agent installs arbitrary pkg | `pip install <pkg>` | pkg lands in overlay; `py-base` byte-identical to post-materialize state |
| X4 | Nuke+rebuild restores baseline | recovery | L2 | automated | delete py-base+py-overlay, network/warm cache available | re-run materialize | env satisfying pinned starter `requirements.txt` restored |
| X5 | Offline interpreter install | fault (no network) | L2 | automated | no network, bundled interp in resources | run materialize (chosen mirror/`--python` mechanism) | venv created via bundled interpreter, zero network calls for interpreter step |
| X6 | pip uses interpreter CA store | fault (cert) | L1 | automated | injection active | inspect env for `python -m pip` | `SSL_CERT_FILE` set to interpreter's bundled CA bundle path |

---

## Coverage summary

- Requirements covered: 14/14
- Scenarios by class: edge 9 · perf 0 · frontend 9 · error 6
- Scenarios by level: L1 15 · L2 7 · electron 2 · L3 0
- Scenarios by disposition: automated 24 · manual-only 0

## New infra needed

- **Verification spike (blocking, pre-implementation):** confirm uv's `UV_PYTHON_INSTALL_MIRROR`
  `file://` layout vs real per-triple python-build-standalone tarballs, plus the interpreter's
  per-platform bindir + `cacert.pem` path. Fallback: self-extract + `uv venv --python <path>`.
  X5/E7/X6 assume the spike's resolved mechanism.
- **Windows qa smoke** for X2 (`qa/tests/*.ps1`) — open-handle rebuild is Win32-specific; check
  for an existing qa Windows test to extend before adding one.
- All other levels (L1 vitest, L2 qa smoke) already exist.
