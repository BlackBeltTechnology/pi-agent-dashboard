# DOX — packages/team-plugin/src/client

Dashboard-side folder entry. One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `FolderTeamSection.tsx` | `sidebar-folder-section` claim. Row "Csapat · N ügynök · M aktív" only for matched folders; folder-menu items: OPEN `team-open`, WORKSPACE `team-settings` / `team-disable` (folder-enabled + admin), `team-enable` (unmatched + `enableable`). Failed match ⇒ nothing. See change: add-team-plugin. |
| `TeamProjectDialog.tsx` | Enable/settings dialog (name, everyone vs selected known users in multi-user, context-files switch) + disable confirm. Validation mirrors server. See change: add-team-plugin. |
| `index.tsx` | Client barrel: `catalog`, `FolderTeamSection`. See change: add-team-plugin. |
| `match-store.ts` | Batched `POST /projects/match` (25 ms window, ≤ 200 cwds), per-cwd cache, `invalidateMatches` (menu refresh + window focus), `useFolderMatch`. See change: add-team-plugin. |
| `team-open.ts` | `openTeam`: embedded folder route when the host has `EmbeddedApp`, else `/apps/team/?project=<id>` in a new tab (D17 fallback). See change: add-team-plugin. |
