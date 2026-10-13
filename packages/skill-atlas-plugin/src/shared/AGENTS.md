# DOX — packages/skill-atlas-plugin/src/shared

Pure code (no `node:` imports). See change: add-skill-atlas-screen.

| File | Purpose |
|------|---------|
| `build-skill-graph.ts` | `buildSkillGraph(inputs) → {skills, links}`. Dedupe by id (project > package > global, then smallest filePath). `references` via a linear per-body mention index (hyphenated runs / skill-shaped words; regex fallback for unusual ids), case-insensitive; `bundle` same `pkg` 2–14; `shares-tool` backticked snake_case tokens shared by 2–6 skills, one link per pair listing all tokens. Undirected links canonical min→max; sorted output; degree. 300×256 KiB ≈ 75 ms. |
| `index.ts` | Public pure entry: `buildSkillGraph` + types. |
| `types.ts` | `SkillGraphInput`, `SkillNode`, `SkillLink`, `SkillLinkType`, `SkillOrigin`, `SkillGraphResponse`, `SkillAtlasChangedMessage`; constants `SKILL_ATLAS_CHANGED`, `GRAPH_NODE_CAP` (300), `BODY_BYTE_LIMIT` (256 KiB). |
| `__tests__/build-skill-graph.test.ts` | Rule tests: determinism, dedupe, reference boundaries/case/short/unsafe ids, bundle + shares-tool bands, canonical links (test-plan E1–E15). |
