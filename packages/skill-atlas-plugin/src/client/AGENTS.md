# DOX — packages/skill-atlas-plugin/src/client

UX source: `openspec/changes/add-skill-atlas-screen/mockups/ui-plan.md`. Tokens only. See change: add-skill-atlas-screen.

| File | Purpose |
|------|---------|
| `AtlasSummary.tsx` | Compact summary (counts, per-relation glyph+word counts, top-5 hubs → focused atlas, "Open atlas"). Empty → null; degraded → warning; error → alert + Retry. |
| `atlas-api.ts` | `fetchSkillGraph`, `canOpenSkillFile` (probe `/api/pi-resource-file`), `piResourceViewerUrl`, `atlasUrl(scope, cwd?, sel?, hops?)` (folder route via runtime `./sdk` `folderRouteHref`; no local codec). See change: decouple-plugins-from-core. |
| `claims.tsx` | Slot components: `SkillAtlasSection` (resource-page-section), `SkillAtlasSettings` (promoted settings entry) — both wrap a lazy `AtlasSummary` in Suspense (cold index chunk is capped by `mdi-chunk-size.test`: only wrappers, atlas-api and the i18n catalog stay eager; measured 944,453 → 941,595 B gz), `FolderAtlasMenu` (registers folder-menu item, group `open`, renders null; card placement registers nothing), `ProjectAtlasClaim` (takes the host-decoded `cwd` prop) / `GlobalAtlasClaim` (lazy `SkillAtlasPage` in Suspense). |
| `graph-layout.ts` | Pure: `layoutGraph` (seeded force layout, normalized), `fitTransform` (viewport fit + focus re-fit + zoom/pan), `placeLabels` (greedy priority, no overlap), `hopSet`, `neighbourRows` (mutual → `↔`), `topByDegree`. |
| `index.tsx` | Client barrel: claim components + `catalog`. |
| `relation-style.ts` | Relation (colour + dash + word) and origin (glyph + static tint classes) encodings; `shortPkg`. |
| `RelationGlyph.tsx` | Inline SVG line sample per relation type. |
| `SkillAtlasPage.tsx` | Full atlas: header + freshness status, APG tabs, search, relation/origin toggles (mobile disclosure), Graph/Cards/Links, detail panel; Cards/Links hide non-matches + "Showing N of M · Clear"; Graph disabled above 300; `?sel=&hops=` preselect. |
| `SkillCardsView.tsx` | Cards grouped by origin / package with ref in/out counts. |
| `SkillDetailPanel.tsx` | Selected skill: pills, description, path, focus All/1/2 hops, neighbours per relation with reason, Open SKILL.md (refusal → inline error). |
| `SkillGraphView.tsx` | SVG graph: shapes per origin, edge styles per relation, labels via `placeLabels`, zoom/pan/fit, keyboard walk; marks `atlas-graph-rendered` once. |
| `SkillLinksView.tsx` | Links table (graph text equivalent). |
| `useSkillGraph.ts` | Fetch + live refetch on matching `skill_atlas_changed`; keeps stale graph with `updating`. |
| `__tests__/graph-layout.test.ts` | Layout determinism/budget, labels no-overlap, focus re-fit, ↔ merge, hops, top-by-degree. |
| `__tests__/atlas-ui.test.tsx` | Summary states, focus hiding, ↔ row, >300 cap, keyboard, XSS-as-text, open refusal, stale-while-updating, folder menu item. |
