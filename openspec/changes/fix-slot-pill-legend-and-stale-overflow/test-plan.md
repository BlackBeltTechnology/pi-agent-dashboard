# Test Plan — fix-slot-pill-legend-and-stale-overflow

Stage: design   Generated: 2026-10-14

No clarifications outstanding. The card placement at 375 px was resolved during
planning: `useMobile` (< 768 px) renders the mobile card, which has no KB slot,
so card rows run at 768/1440 only.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | directory-card-layout · legend meets the type floor | decision-table (surface × token) | L1 | automated | `<SlotPill surface="raised">` and `surface="flat"`, label "Knowledge base" | render | legend span class contains every `SLOT_PILL_LEGEND` token (`text-[11px]`, `uppercase`, `tracking-wide`, `-top-2`, `text-[var(--text-secondary)]`) plus its surface fill (`bg-[var(--bg-tertiary)]` / `bg-[var(--bg-primary)]`); contains none of `text-[9px]`, `text-[12px]`, `tracking-wider`, `-top-1.5` |
| E2 | directory-card-layout · shared legend constant | EP | L1 | automated | barrel `@blackbelt-technology/dashboard-plugin-runtime` | import `SLOT_PILL_LEGEND` | export is a non-empty string; every whitespace token of it appears in the rendered SlotPill legend class |
| E3 | directory-card-layout · mirrored OpenSpec pill legend | EP | L1 | automated | `FolderOpenSpecSection` in `cli-failed` state | render | the inert pill's legend span class contains every `SLOT_PILL_LEGEND` token; no `text-[9px]` |
| E4 | session-card-subcards · subcard legend + panel tokens | decision-table (token set) | L1 | automated | `<SessionSubcard title="OPENSPEC">child</SessionSubcard>` | render | panel class has `relative`, `mt-2.5`, `rounded-lg`, `border`, `px-2`, `pt-2.5`, `pb-1.5`, no `bg-[`, no `mt-1.5`, no `py-1.5`; legend has `-top-2`, `text-[11px]`, `uppercase`, `tracking-wide`, `font-semibold`, `text-[var(--text-secondary)]`, `rounded-full`, no `text-[12px]`/`tracking-wider` |
| E5 | session-card-subcards · parity pinned against SLOT_PILL_LEGEND | EP | L1 | automated | `SessionSubcard` legend class + `SLOT_PILL_LEGEND` | compare size/weight/tracking/overhang/colour tokens | the five tokens (`text-[11px]`, `font-semibold`, `tracking-wide`, `-top-2`, `text-[var(--text-secondary)]`) are present in both |
| E6 | kb-plugin-folder-section · stale marker keeps its text | EP | L1 | automated | stats `{chunks: 19397, staleCount: 3, indexed: true}` | render `FolderKbSection` (sidebar) | `folder-kb-stale` contains an svg with `mdiAlertOutline` path, an `aria-hidden="true"` span reading `3`, an `.sr-only` span reading `3 stale`; `title="3 stale"`; class has `shrink-0`; textContent has no `⚠` |
| E7 | kb-plugin-folder-section · stale marker BVA | BVA | L1 | automated | `staleCount` ∈ {0, 1, 12345} with `chunks: 19397` | render | 0 → no `folder-kb-stale`, `data-state="populated"`; 1 → visible `1`, sr-only `1 stale`; 12345 → visible `12345`, sr-only `12345 stale`, still `shrink-0` |
| E8 | directory-card-layout · stale on pill AND menu badge (fact vs control) | decision-table | L1 | automated | `staleCount: 3`, sidebar placement | render + read registered `kb-reindex` folder-menu item | menu item `badge === "3 stale"`; pill marker visible text `3` (E11 split: two assertions, not one shared string) |
| E9 | kb-plugin-folder-section · numbers never truncate, units do | EP | L1 | automated | stale and indexing stats (`files: 412`) | render | chunk-number span has `shrink-0` + `tabular-nums` and text `19,397`; `chunks` unit span has `min-w-0` + `truncate`; indexing files-number span `shrink-0`, unit span `min-w-0 truncate`; `folder-kb-count` has `min-w-0` and NOT `overflow-hidden`; sidebar `folder-kb-section` root has `min-w-0` |
| E10 | kb-plugin-folder-section · state words/error text truncate | decision-table (state) | L1 | automated | each of `denied`, `pinning`, `missing`, `no-sources`, `not-indexed`, `indexing`, `error` | render | the state word / "index failed" text sits in an inner span with `min-w-0` + `truncate`; its flex parent has `min-w-0` |
| E11 | ui-state-capture · overflow probe math | BVA + decision-table | L1 | automated | pure `overflowOf(root {x0,y0,w150,h40}, items)`: (a) inside; (b) right +0.4 px; (c) right +0.6 px; (d) bottom +2 px; (e) top −7 px `topExempt:true`; (f) top −7 px `topExempt:false`; (g) right +5 px with `clips:[root-sized rect]`; (h) `clips` disjoint from rect; (i) `topExempt:true` top −7 px AND right +3 px | call | (a) [] (b) [] (c) 1 entry `… right +0.6px` (d) 1 `bottom` (e) [] (f) 1 `top` (g) [] (h) [] (skipped) (i) exactly 1 entry naming `right` |
| E12 | ui-state-capture · sr-only excluded from visual floors | EP | L1 | automated | measures: one `srOnly:true` node (ratio 1.2:1, 10 px), one normal passing node | `contrastFailures(ms)` and `sizeFailures(ms)` | both return []; the same list with `srOnly:false` on the first node returns 1 contrast + 1 size failure |
| E13 | ui-state-capture · capture result carries overflow | EP | L1 | automated | fake page whose `overflowRoot` locator records `evaluate` calls; one `UiState` with `overflowRoot` returning `["div right +2.0px"]`, one without | `captureStates` | with root: every row `overflow` equals `["div right +2.0px"]`; without: rows `overflow: []` and the spy recorded 0 calls |

### Performance

None — presentation-only change; no latency or throughput requirement.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | kb-plugin-folder-section · probes pass in every state | decision-table (state × theme × width) | L3 | automated | `kbPillStates` (loading, populated, stale, indexing, pinning, no-sources, not-indexed, denied, missing, error) × `{base,dark}`,`{base,light}`,`{nord,dark}` × 375/768/1440, sidebar | capture with `overflowRoot = folder-kb-open-settings` | every cell: `contrast`, `size`, `focus`, `overflow` lists empty; `measured > 0` |
| F2 | kb-plugin-folder-section · stale marker stays inside the pill (sidebar) | BVA (narrowest column) | L3 | automated | `stale` state (`chunks: 19397, staleCount: 3`) at 375/768/1440 × 3 themes | read boxes + styles | unclipped `folder-kb-stale` rect ⊂ `folder-kb-open-settings` border box (±0.5 px); `folder-kb-chunks` `scrollWidth <= clientWidth` and text `19,397` (en-US); computed colour of the `aria-hidden` count span vs the marker's computed background ≥ 4.5:1 via `contrastRatio`; root accessible name contains `3 stale` |
| F3 | directory-card-layout · legend stays clear of the content row | BVA (1-col vs 2-col) | L3 | automated | KB pill, sidebar, `populated` | viewport 375 (expect 1 column), 768 and 1440 (expect 2 columns) | grid column count matches; legend rect `bottom ≤` glyph-chip rect `top` and `≤` `folder-kb-count` rect `top` |
| F4 | kb-plugin-folder-section · stale marker inside the pill in the card placement | state-transition (populated → stale) | L3 | automated | real git worktree + spawned session (setup as `folder-collapse-worktree.spec.ts`), `/api/kb/stats` stubbed `populated` then `stale` | viewport 768 and 1440 × 3 themes, desktop session card | probe root = card's `folder-kb-open-settings`: `overflow` empty; unclipped `folder-kb-stale` rect ⊂ root; number text `19,397` untruncated; `folder-kb-card-reindex` rect does not intersect root |
| F5 | session-card-subcards · stacked legends do not overlap the panel above | invariant | L3 | automated | the F4 worktree session's desktop card (OPENSPEC/KB slot/GIT/STATUS/PROCESS rendered) | viewport 1440 | for each `SessionSubcard` and the `worktree-card-section-gap` wrapper: its legend rect `top ≥` bottom border edge of the previous sibling element |
| F6 | directory-card-layout · legends read as labels, not headings | visual/subjective | — | manual-only | sidebar folder card (KB, MCP, Goals, Automations, OpenSpec pills) + a desktop session card, base dark/light + nord dark | human looks at 768 and 1440 px | [judgment: legend is visibly subordinate to the count line; no crowding against the border or content] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | kb-plugin-folder-section · error state stays inside the pill | fault-injection (abort) | L3 | automated | `/api/kb/stats` → `jobStatus: "error"` with a 300-char `lastError` | sidebar render at 375 px, base dark | "index failed" pill rect ⊂ root (overflow empty); the long message appears only in the root `title`, not in visible text |
| X2 | kb-plugin-folder-section · card placement with session setup failure | fault-injection (abort) | L3 | automated | `/api/git/worktree` create fails in `beforeAll` | run F4/F5 | tests fail with the recorded `setupError` message (not a silent skip, not a timeout) |

---

## Coverage summary

- Requirements covered: 5/5 (directory-card-layout ×2, session-card-subcards ×1, kb-plugin-folder-section ×1, ui-state-capture ×1 via E11–E13 + F1)
- Scenarios by class: edge 13 · perf 0 · frontend 6 · error 2
- Scenarios by level: L1 13 · L2 0 · L3 7 · — 1
- Scenarios by disposition: automated 20 · manual-only 1

## New infra needed

- `overflowOf` / `overflowFailures` in `tests/e2e/helpers/computed-contrast.ts` and the `overflowRoot` axis in `ui-capture.ts` (E11–E13) — extends existing helpers, no new harness.
- Card-placement capture reuses the worktree-session setup from `tests/e2e/folder-collapse-worktree.spec.ts`; no new docker fixture.
