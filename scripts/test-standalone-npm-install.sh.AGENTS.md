# test-standalone-npm-install.sh — index

Bash standalone-install smoke: packs workspaces, installs tarballs into isolated temp HOME, spawns pi-dashboard headless, polls /api/health (60s), asserts web UI reachable. --keep --port flags. Probe rationale: post eliminate-electron-runtime-install, plain /api/health is readiness signal. After install, asserts installed root `packages/` holds no `__tests__`, `*.test.*`, `*.AGENTS.md` (root tarball exclusions), then boots. See change: check-root-package-imports.
