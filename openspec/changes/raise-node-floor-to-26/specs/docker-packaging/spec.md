## REMOVED Requirements

### Requirement: Dockerfile builds a self-contained image
**Reason**: Pins `node:24-bookworm-slim` / Node 24 LTS, which the server now refuses; its "Base image runs Node 24" scenario cannot be kept under that name.
**Migration**: Replaced by "Dockerfile builds a self-contained Node 26 image" — same tools, user and node-pty guarantees, base `node:26-bookworm-slim`.

## ADDED Requirements

### Requirement: Dockerfile builds a self-contained Node 26 image
The Dockerfile SHALL produce a single image containing Node.js 26 LTS, pi coding agent, pi-dashboard (with built client), code-server, zrok, tmux, jq, git, curl, ripgrep, fd-find, and bash. The image SHALL use `node:26-bookworm-slim` as the base. The image SHALL create a non-root user `pi` (UID 1000) and run all processes as that user. Build-essential and python3 SHALL be removed after native addon compilation to reduce image size.

#### Scenario: Image contains all required tools
- **WHEN** the image is built with `docker compose build`
- **THEN** the following binaries are available on PATH: `node`, `pi`, `pi-dashboard`, `code-server`, `zrok`, `tmux`, `jq`, `git`, `curl`, `rg`, `fdfind`, `bash`

#### Scenario: Image runs as non-root user
- **WHEN** a container starts from the image
- **THEN** all processes run as user `pi` (UID 1000)

#### Scenario: node-pty works inside container
- **WHEN** the dashboard spawns a terminal via node-pty
- **THEN** the PTY allocates successfully and shell I/O works (glibc-based Debian, not musl/Alpine)

#### Scenario: Base image runs Node 26
- **WHEN** `node --version` is run inside the built image
- **THEN** it reports a `v26.x` release that satisfies the server engines range
