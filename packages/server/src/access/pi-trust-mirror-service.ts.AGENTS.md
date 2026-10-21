# pi-trust-mirror-service.ts — index

Server side of the dashboard-trust → pi mirror. `createPiTrustMirrorService(deps)`: durable registry over persisted stores (worktree-init current hash, pins, folder-workspaces, persisted grants; workflow slot not installed), per-entry choices `pi-trust-overrides.json`, snapshot writer (tmp+rename 0600, generation, >5,000 warn), `grant` (choice → source → snapshot), `revoke`/`revokeMany` (snapshot without entry FIRST, then source), `refresh`, `rebuildAtBoot`. `get/setPiTrustMirror` process handle. See change: mirror-dashboard-trust-to-pi. Project-root `.git`/`.pi` test is the shared `hasProjectRootMarker` (`shared/src/project-root.ts`), no private copy. See change: add-access-provisioning.

Live: `deps.live`, `liveCount` in snapshot (boot writes 0), `noteLiveChanged()` sync rewrite, failed rewrite warns only. See change: mirror-dashboard-trust-live-remote.
