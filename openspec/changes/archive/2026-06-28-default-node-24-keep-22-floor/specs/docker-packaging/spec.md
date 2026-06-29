# docker-packaging Specification (delta)

## MODIFIED Requirements

### Requirement: Dockerfile builds a self-contained image
The Dockerfile SHALL produce a single image containing Node.js 24 LTS, pi coding agent, pi-dashboard (with built client), code-server, zrok, tmux, jq, git, curl, ripgrep, fd-find, and bash. The image SHALL use `node:24-bookworm-slim` as the base. The image SHALL create a non-root user `pi` (UID 1000) and run all processes as that user. Build-essential and python3 SHALL be removed after native addon compilation to reduce image size.

#### Scenario: Image contains all required tools
- **WHEN** the image is built with `docker compose build`
- **THEN** the following binaries are available on PATH: `node`, `pi`, `pi-dashboard`, `code-server`, `zrok`, `tmux`, `jq`, `git`, `curl`, `rg`, `fdfind`, `bash`

#### Scenario: Image runs as non-root user
- **WHEN** a container starts from the image
- **THEN** all processes run as user `pi` (UID 1000)

#### Scenario: node-pty works inside container
- **WHEN** the dashboard spawns a terminal via node-pty
- **THEN** the PTY allocates successfully and shell I/O works (glibc-based Debian, not musl/Alpine)

#### Scenario: Base image runs Node 24
- **WHEN** `node --version` is run inside the built image
- **THEN** it reports a `v24.x` release (current LTS line)
