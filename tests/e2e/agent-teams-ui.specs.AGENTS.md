# DOX — tests/e2e agent-teams-ui specs

Sidecar of `tests/e2e/AGENTS.md` (byte cap). One row per spec of change add-agent-teams-ui. All written, NOT run (docker harness). Fixture teams via `helpers/agent-teams.ts` (`page.route`); sessions are real.

| File | Purpose |
|------|---------|
| `agent-teams-a11y.spec.ts` | S99 axe (no serious/critical) + 3:1 contrast floor in dark / light / nord, status never colour alone; S100 reduced motion ⇒ animation none / ≈ 0. See change: add-agent-teams-ui. |
| `agent-teams-badge-live.spec.ts` | S90: no badge on a plain session; `session_updated` ref ⇒ badge live (name "Open team view, Lead"), Enter opens the view, `{teamId:null}` clears. See change: add-agent-teams-ui. |
| `agent-teams-controls.spec.ts` | S102 real confirm dialog (Cancel / Escape ⇒ 0 POST, double-click Confirm ⇒ 1 POST, focus back); S109 403 ⇒ inline message, no retry, no toast. See change: add-agent-teams-ui. |
| `agent-teams-frame-loss.spec.ts` | S104: every `agent-teams:changed` frame dropped ⇒ converges within 60 s by the safety timer (fake clock). See change: add-agent-teams-ui. |
| `agent-teams-full-path.spec.ts` | S103: faux lead (`agent-teams-lead-spawn` / `-task`) ⇒ live badge, members, board, log, Shut down ⇒ closed read-only. GAP: no 3-task / 2-teammate scenario. See change: add-agent-teams-ui. |
| `agent-teams-lazy-failure.spec.ts` | S85: aborted Team view chunk ⇒ host failure panel, never blank, no error spam. See change: add-agent-teams-ui. |
| `agent-teams-message-log.spec.ts` | S98: follow newest only at the end (8 px); scrolled up ⇒ "New messages". See change: add-agent-teams-ui. |
| `agent-teams-team-view-layout.spec.ts` | S35 (tabs on every width per owner decision; targets 44 px at 639 / 24 px at 640) and S96 (no horizontal scroll at 320 px, task 50 reachable). See change: add-agent-teams-ui. |
| `agent-teams-team-view-route.spec.ts` | S93 cold deep link, S94 lead ⇄ teammate ⇄ Back, S95 Escape / no occlusion, S97 tab survives resize. See change: add-agent-teams-ui. |
| `agent-teams-team-view-state.spec.ts` | S92: disclosure / filter / focus survive a refetch; moved task; vanished member resets the filter. See change: add-agent-teams-ui. |
| `helpers/agent-teams.ts` | `routeTeams(page, routed)` fake REST (ETag/304, 404, POSTs), `teamState`, `snapshotJson`, `teamRefFrame`, `changedFrame`, `sessionIdOf`, `teamViewUrl`. See change: add-agent-teams-ui. |
