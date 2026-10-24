# Spec Delta

## Purpose

Provide the headless Blender WebAssembly runtime on demand: one pinned upstream build, downloaded only on first use, verified fail-closed, safely extracted into a per-version cache, with an offline directory override and a machine-readable report.

## ADDED Requirements

### Requirement: Pinned runtime identity
The provisioner SHALL accept exactly one runtime build, identified in source by package name, version, tarball URL, tarball byte size and an sha512 integrity value. It SHALL NOT consult registry metadata at run time to choose a version, URL or integrity value.

#### Scenario: Tarball bytes do not match the pin
- **WHEN** the bytes downloaded from the pinned tarball URL do not hash to the pinned sha512 integrity value
- **THEN** provisioning fails with code `integrity-mismatch`, the downloaded file is deleted, and nothing is extracted

#### Scenario: No metadata lookup
- **WHEN** a runtime is provisioned on a machine with an empty cache
- **THEN** the only network request is a GET of the pinned tarball URL

### Requirement: Bounded download
The download SHALL fail with code `download-failed` and leave no committed cache when it exceeds 600 seconds in total, receives no bytes for 60 seconds, or grows beyond the pinned tarball size.

#### Scenario: Stalled download
- **WHEN** the tarball server stops sending bytes for more than 60 seconds
- **THEN** provisioning fails with code `download-failed` and no directory exists at `<cache root>/<version>/`

#### Scenario: Oversized response
- **WHEN** the tarball response sends more bytes than the pinned tarball size
- **THEN** provisioning fails with code `download-failed` and stops reading the response

### Requirement: Lazy provisioning on first use
The runtime SHALL be downloaded only when a command or tool call needs it and no valid cached copy exists. Installing the package SHALL NOT download it. A cached copy SHALL be valid only when its completion stamp matches the pinned version and integrity, every required runtime file exists, and every stamped file has its stamped size.

#### Scenario: Install does not download
- **WHEN** the package is installed and no command has run
- **THEN** no runtime download has happened and no cache directory for it exists

#### Scenario: Valid cache is reused
- **WHEN** a valid runtime for the pinned version is already cached and provisioning is requested
- **THEN** no network request is made and the cached directory is used

#### Scenario: Truncated cached file
- **WHEN** a cached runtime's expanded wasm file is shorter than its stamped size and provisioning is requested
- **THEN** the cached copy is treated as invalid and the runtime is provisioned again

#### Scenario: Missing session code in cache
- **WHEN** a cached runtime lacks its browser session entry file and provisioning is requested
- **THEN** the cached copy is treated as invalid and the runtime is provisioned again

### Requirement: Safe extraction of an allowlisted subset
The provisioner SHALL list every archive entry before extracting anything. It SHALL accept regular files, directory entries and archive metadata headers. It SHALL abort on absolute paths, `..` segments, symbolic or hard links, device or FIFO entries, or more than 500 entries. It SHALL extract only the single-threaded runtime, the browser session code, the project protocol code and the licence files, excluding source maps and type declarations.

#### Scenario: Path traversal entry
- **WHEN** the verified archive contains an entry whose path contains `..`
- **THEN** provisioning fails with code `unsafe-archive` and no file is written outside the staging directory

#### Scenario: Unneeded flavour is not extracted
- **WHEN** a runtime is provisioned successfully
- **THEN** the cache holds the single-threaded runtime files, and no pthread-flavour files, source maps or type declarations

#### Scenario: Metadata headers accepted
- **WHEN** a verified archive contains PAX extended headers and directory entries alongside the allowlisted files
- **THEN** provisioning succeeds

#### Scenario: Symbolic link entry
- **WHEN** the verified archive contains a symbolic link entry
- **THEN** provisioning fails with code `unsafe-archive` before any file is extracted

### Requirement: Runtime is committed expanded and verified
The provisioner SHALL decompress the compressed runtime wasm and data files and verify each against the expanded (`raw`) size and sha256 recorded in the runtime's own flavour manifest. It SHALL commit only the expanded files, with a top-level runtime manifest that declares no compressed encoding, so the session loads them directly.

#### Scenario: Decompressed file does not match manifest
- **WHEN** a decompressed runtime file's sha256 differs from its `raw` manifest entry
- **THEN** provisioning fails with code `runtime-manifest-mismatch` and the cache entry is not committed

#### Scenario: Committed runtime boots
- **WHEN** a runtime has been provisioned from the pinned tarball and a Blender session is booted from the cache with no network access
- **THEN** the session reaches ready and no compressed runtime file or brotli decoder is read

### Requirement: Atomic, race-free cache commit
The cache root SHALL be `BLENDER_WASM_HOME` when set, otherwise `<pi agent dir>/tools/blender-wasm`, where the pi agent dir is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The provisioner SHALL build each runtime in a staging directory inside the cache root and commit it with one rename to `<cache root>/<version>/`. When the rename loses a race to another process, it SHALL reuse the winner's copy only if that copy is valid, and SHALL remove its own staging directory.

#### Scenario: Two processes provision concurrently
- **WHEN** two processes provision the same version at the same time on an empty cache
- **THEN** both end using the same committed directory, both report success, and no staging directory from either remains

#### Scenario: Interrupted provisioning
- **WHEN** provisioning is interrupted after the download started and is run again more than one hour later
- **THEN** no directory exists at `<cache root>/<version>/` before the second run, and the leftover staging directory is removed by it

#### Scenario: Agent dir redirected
- **WHEN** `PI_CODING_AGENT_DIR` is set, `BLENDER_WASM_HOME` is not, and a runtime is provisioned
- **THEN** it is committed under `$PI_CODING_AGENT_DIR/tools/blender-wasm/<version>/`

### Requirement: Directory override
When `BLENDER_WASM_DIR` names a directory, the provisioner SHALL use it as the committed runtime layout without downloading or verifying integrity. It SHALL fail with code `override-invalid`, naming the first missing required file, when the package metadata, the runtime manifest, the session worker, any of the four single-threaded runtime files, the browser session entry, its brotli helper module or the generated protocol module is absent.

#### Scenario: Offline machine with override
- **WHEN** `BLENDER_WASM_DIR` points at a valid runtime layout and the machine has no network access
- **THEN** provisioning succeeds with source `override` and makes no network request

#### Scenario: Override missing files
- **WHEN** `BLENDER_WASM_DIR` points at a directory without the single-threaded runtime wasm file
- **THEN** provisioning fails with code `override-invalid` naming that file

### Requirement: Provisioning report
Each provisioning run SHALL be able to report one JSON object with:
- `version`;
- `source` (`cache`, `download` or `override`);
- `dir`;
- `bytes` (total on-disk bytes of the runtime directory);
- `licence` (the runtime package metadata's licence field, or `unknown` when it has none);
- `jspi` (`native`, `flag` or `unavailable`).

Failures SHALL report a lowercase machine `code` and a message.

#### Scenario: Fresh download report
- **WHEN** provisioning downloads and commits the runtime
- **THEN** the report has `source: "download"`, the committed `dir`, and `licence` equal to the runtime package's declared licence

#### Scenario: Override without a licence field
- **WHEN** `BLENDER_WASM_DIR` holds a valid runtime layout whose package metadata has no licence field
- **THEN** the report has `source: "override"` and `licence: "unknown"`
