# skill-atlas.md — index

Skill Atlas plugin doc (`packages/skill-atlas-plugin`). Per-folder + global skill graph.

- Relations: `references` (directed, mention rules), `bundle` (same pkg, 2–14), `shares-tool` (backticked snake_case token, 2–6 skills).
- `buildSkillGraph` pure, in `src/shared/`. Dedupe priority `project` > `package` > `global`.
- Freshness: stat fingerprint per GET (memo LRU 32, key `global` / `project:<abs cwd>`). Push: `onPiResourcesInvalidated` → 500 ms debounce → `getPiResources(cwd, {fresh:true})` → `skill_atlas_changed` iff graph hash moved.
- Route: `GET /api/plugins/skill-atlas/graph?scope=project|global&cwd=<abs>`. 400 bad params, 501 no seam.
- Entries: folder menu `skill-atlas` (group `open`), `/folder/:encodedCwd/atlas`, `/atlas` (parent `/settings/skills`), Settings ▸ Resources ▸ Skill Atlas, `resource-page-section`.
- Perf: P1 memo-hit p95 < 100 ms @100 skills; P2 rebuild < 500 ms @300 × 256 KiB. Graph tab disabled > 300 nodes.
- Bodies never sent to client. Paths only from scanner-resolved `SKILL.md`.

See change: add-skill-atlas-screen.
