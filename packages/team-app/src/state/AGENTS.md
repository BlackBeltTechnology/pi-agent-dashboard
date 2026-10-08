# DOX — packages/team-app/src/state

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `effective-target.ts` | Selected target, or the locked folder project (`POST /projects/match`) in a folder view. See change: add-team-plugin. |
| `target-store.ts` | `team:target` store (`useSyncExternalStore`), `resolveStartTarget` (remembered → first available project → `_ws`). See change: add-team-plugin. |
| `team-store.ts` | Per-host shared `/me` + `/projects` store; `useTeam`; never fetches before identity is authenticated. See change: add-team-plugin. |
| `use-poll.ts` | `usePoll(fn, ms)` — runs while the document is visible. See change: add-team-plugin. |
