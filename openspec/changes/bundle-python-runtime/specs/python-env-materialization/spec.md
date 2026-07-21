## ADDED Requirements

### Requirement: Two-layer base + overlay env
Materialization SHALL create a pristine `py-base` env from a small hash-pinned starter `requirements.txt` using `--link-mode copy`, and an agent-writable `py-overlay` env created with `--system-site-packages` inheriting `py-base`. Arbitrary package installs SHALL land in `py-overlay`; `py-base` SHALL never be mutated by agent installs. `py-base` SHALL be a non-empty pinned starter set (not interpreter-only).

#### Scenario: Baseline is reproducible and hash-pinned
- **WHEN** `py-base` is materialized
- **THEN** it is installed from the pinned `requirements.txt` with `--require-hashes`
- **AND** its installed file tree does not depend on the uv cache surviving (link-mode copy)

#### Scenario: Agent install does not corrupt the baseline
- **WHEN** an agent runs `pip install <pkg>` against the active env
- **THEN** `<pkg>` is written into `py-overlay`
- **AND** `py-base` remains byte-identical to its post-materialization state

#### Scenario: Nuke+rebuild restores a known-good baseline
- **WHEN** `py-base` and `py-overlay` are deleted and materialization re-runs with network or a warm cache available
- **THEN** a baseline satisfying the pinned starter `requirements.txt` is restored

### Requirement: Failed package install surfaces pip's own result
When an agent package install cannot reach the index (offline / network-denied), the tool call SHALL observe pip's own non-zero exit code and stderr verbatim — no dashboard wrapper, no added timeout, no swallowed error. Interpreter + baseline availability SHALL be unaffected.

#### Scenario: Offline pip install passes pip's failure through
- **WHEN** an agent runs `pip install <pkg>` with no network and `<pkg>` not in the cache
- **THEN** the tool call receives pip's own non-zero exit code and its stderr text
- **AND** `python x.py` using only stdlib + baseline packages still succeeds

### Requirement: Eager single-flight materialization, decoupled from injection
Materialization SHALL run as a background subprocess kicked off eagerly on server boot (non-blocking) and SHALL be single-flight: concurrent triggers share one in-process build. Materialization SHALL NOT be awaited inside the synchronous spawn-env injection seam.

#### Scenario: Concurrent triggers produce one build
- **WHEN** multiple tool calls trigger materialization before it has completed
- **THEN** exactly one venv build runs and all callers observe the same result

#### Scenario: Torn build never becomes visible
- **WHEN** a materialization is interrupted mid-build
- **THEN** the partial env is never selected by the injection seam (writes land in a temp/versioned dir and are made visible only atomically)

### Requirement: Freshness stamp forces rebuild on interpreter version change
Materialization SHALL record a `.py-stamp` equal to the bundled interpreter version. When the stamp does not match the bundled interpreter version, the env SHALL be rebuilt. This is a runtime-staleness mechanism distinct from the build-time `.bundle-stamp`.

#### Scenario: Post-update interpreter swap triggers rebuild
- **WHEN** an electron-updater whole-app replacement swaps the bundled interpreter version and the server restarts
- **THEN** the stamp mismatch causes `py-base` and `py-overlay` to be rebuilt against the new interpreter

### Requirement: Overlay persists until interpreter version bump
`py-overlay` SHALL persist across sessions and app launches, resetting only on an interpreter version bump (stamp mismatch) or an explicit reset action. Cross-session inheritance of overlay packages is an accepted trade-off; baseline integrity is preserved by the base/overlay split.

#### Scenario: Overlay survives a server restart without version change
- **WHEN** the server restarts with the interpreter version unchanged
- **THEN** packages previously installed into `py-overlay` remain available

### Requirement: Rebuild is safe against a live install on Windows
An interpreter-version rebuild SHALL NOT fail because an agent holds open handles inside the current overlay. The replacement env SHALL be built in a fresh versioned directory and made active by repointing (not by renaming over a directory with open handles).

#### Scenario: Rebuild while a pip install holds overlay handles
- **WHEN** a stamp-triggered rebuild runs on Windows while an agent process has open file handles inside the current overlay
- **THEN** the rebuild completes into a new versioned overlay dir without an EACCES/EBUSY rename failure
- **AND** subsequent spawns resolve the new overlay
