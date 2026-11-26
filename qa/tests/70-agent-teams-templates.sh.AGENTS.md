# 70-agent-teams-templates.sh — index

L2 process-level smoke for agent-teams templates + hooks + plan approval. Hermetic: own prefix (HOME), own port (default 18970), faux provider staged under the prefix. SKIPs (exit 0) without the needed tools.

- `install` (#I2): dist-only install loads the plugin (row `loaded`, no error); the six templates-hooks routes answer their own JSON error (an unregistered route cannot); installed manifest carries the `sidebar-folder-section` claim + both `custom-entry-renderer` claims; when `yaml` is a private copy of the plugin, a missing `yaml` takes the plugin down, never the host (health 200, same process).
- `restart` (#D12): real server restart on the faux model. (A) team from `/agent-team start`, two eager members, blocking `TaskCreated` hook; restart mid-run after the template FILE lost its hook: same team, same two members (no duplicates), same tasks, frozen hook still blocks (snapshot, not file). (B) REST start restarted right after it answered: exactly one outcome — active with roster spawned once and ONE playbook mail, or closed `lead_spawn_failed`; never stuck `starting`.
- `soak` (#P3): 1000 hook runs (exit 0 / 2 / 1 / timeout / overflow) through the real hook engine + real shell for `QA_SOAK_SECONDS` (default 180): 0 surviving child pids after settle, open-fd delta ≤ 5, RSS slope ≤ 5 MB per 1000 runs. Needs a checkout (`npx tsx`).

Mechanics: all REST via `pi-dashboard api` (mints local proof; bare curl refused by `requireLocalProof`); it prints no status, so `expect_route` asserts non-2xx + the route's own JSON `error` code. Unsets `PI_*`/`DASHBOARD_STARTER` so faux pi sessions register with the dashboard under test. Manifest lookup falls back to `$REPO_ROOT/packages/agent-teams-plugin` when the bin is a checkout shim. Restart section waits for the lead to go quiet (not streaming, `lastActivityAt` stable 3 s) before each prompt: a restored session reports `active`, not `idle`, and the members-idle notice wakes the lead (an RPC prompt during that turn is refused). `finish` kills the sessions it created and removes its temp dirs.

See change: add-agent-teams-templates-hooks.
