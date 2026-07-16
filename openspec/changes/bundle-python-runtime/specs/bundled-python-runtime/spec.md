## ADDED Requirements

### Requirement: Bundle uv and a per-arch interpreter into Electron resources
The build SHALL place the `uv` binary at `resources/uv/` and exactly one `python-build-standalone` interpreter distribution for the target triple under `resources/python-dist/`, so the shipped app contains a self-contained Python toolchain for its own platform+arch.

#### Scenario: Per-arch interpreter present for the target triple
- **WHEN** the Electron bundle is built for a target triple (e.g. `darwin-arm64`, `win32-x64`)
- **THEN** `resources/uv/` contains the `uv` binary for that triple
- **AND** `resources/python-dist/` contains the interpreter distribution for that triple and no other triple's distribution

#### Scenario: Bare interpreter is runnable directly from resources
- **WHEN** the built bundle is extracted on a target machine and the bundled interpreter executable is invoked with `--version`
- **THEN** it prints a Python version without requiring any prior materialization or network access

### Requirement: sha256 pin and GO/NO-GO build assertion
The build SHALL verify the downloaded `uv` binary and interpreter tarball against pinned sha256 digests before extraction, and SHALL fail the build (GO/NO-GO) when the interpreter or `uv` binary is missing for a required target triple — mirroring the node-pty and bundled-git GO/NO-GO asserts in `bundle-server.mjs`.

#### Scenario: Checksum mismatch aborts the build
- **WHEN** a downloaded interpreter tarball or `uv` binary does not match its pinned sha256
- **THEN** the build aborts before extraction and exits non-zero with a checksum-mismatch message

#### Scenario: Missing required-triple artifact fails GO/NO-GO
- **WHEN** the bundle step completes but `resources/python-dist/` lacks the interpreter for a required target triple
- **THEN** the build exits non-zero with a GO/NO-GO failure naming the missing triple

### Requirement: THIRD-PARTY license attribution
The build SHALL emit a `THIRD-PARTY-LICENSE.txt` for the bundled `uv` and `python-build-standalone` components, mirroring the bundled-git `writeLicense` attribution.

#### Scenario: License file emitted alongside the bundled runtime
- **WHEN** the Python runtime is bundled into resources
- **THEN** a `THIRD-PARTY-LICENSE.txt` covering uv and python-build-standalone is present in the bundled resource tree

### Requirement: Interpreter install-source mechanism verified before commit
The build SHALL install the interpreter into a venv without network access. The intended mechanism is uv's `UV_PYTHON_INSTALL_MIRROR` pointed at a `file://` path over `resources/python-dist/`; because uv's expected mirror layout is unverified, a verification spike SHALL confirm the mirror layout against real per-triple tarballs before the `file://` path is committed, with the documented fallback being self-extraction plus `uv venv --python <extracted-path>`.

#### Scenario: Offline interpreter install succeeds via the chosen mechanism
- **WHEN** materialization runs on a machine with no network access and the bundled interpreter present in resources
- **THEN** a venv is created using the bundled interpreter with no network calls for the interpreter step
