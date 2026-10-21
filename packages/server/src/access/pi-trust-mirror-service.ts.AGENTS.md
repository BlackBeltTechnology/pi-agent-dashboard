# pi-trust-mirror-service.ts — detail

Server side of the dashboard-trust → pi mirror. `createPiTrustMirrorService(deps)`: durable registry over persisted stores (worktree-init current hash, pins, folder-workspaces, persisted grants; workflow slot not installed), per-entry choices `pi-trust-overrides.json`, snapshot writer (tmp+rename 0600, generation, >5,000 warn), `grant` (choice → source → snapshot), `revoke`/`revokeMany` (snapshot without entry FIRST, then source), `refresh`, `rebuildAtBoot`. `get/setPiTrustMirror` process handle. See change: mirror-dashboard-trust-to-pi.

Live: `deps.live`, `liveCount` in snapshot (boot writes 0), `noteLiveChanged()` sync rewrite, failed rewrite warns only. See change: mirror-dashboard-trust-live-remote.
