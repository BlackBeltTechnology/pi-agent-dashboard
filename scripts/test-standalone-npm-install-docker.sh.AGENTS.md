# test-standalone-npm-install-docker.sh — index

Docker smoke: packs workspaces + root, launches clean Linux container (default node:24-bookworm-slim), installs all tarballs at once (no --ignore-scripts), asserts pi-dashboard --version + start, polls /api/health (≤180s), GET /, spawn-session WS round-trip, /api/sessions, openspec CLI + /api/openspec-archive. Flags: --keep, custom IMAGE.
