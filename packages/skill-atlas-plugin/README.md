# @blackbelt-technology/pi-dashboard-skill-atlas-plugin

Dashboard plugin: every skill pi loads in a folder (project atlas) or globally (global atlas), shown as cards, a force graph and a links table with typed relations:

| Relation | Rule |
|---|---|
| `references` | Skill A's SKILL.md names skill B (hyphenated id, or `/skill:x`, `skill: x`, `x skill`). Directed. |
| `bundle` | Shipped by the same package (2–14 skills). |
| `shares-tool` | Both mention the same backticked `snake_case` tool token, used by only 2–6 skills. |

The graph is a pure function of the resolved skill state (`buildSkillGraph`, exported from `./shared`). The server rebuilds it only when a fingerprint of the skill files moves, and pushes `skill_atlas_changed` to open atlases after skills change or a session reloads.

## Surfaces

- Folder actions menu → **Skill Atlas** (project atlas, `/folder/:encodedCwd/atlas`).
- Settings ▸ Resources ▸ **Skill Atlas** and `/atlas` (global atlas).
- A summary section above the grid on the Folder and Global **Skills** pages.

## Server

`GET /api/plugins/skill-atlas/graph?scope=project|global&cwd=<abs>` — needs the host seams `getPiResources` and `onPiResourcesInvalidated` (dashboard ≥ 0.9). SKILL.md bodies never leave the server.
