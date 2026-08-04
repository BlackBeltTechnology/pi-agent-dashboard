## 1. Protocol

- [ ] 1.1 Add `MoveFolderToWorkspaceMessage { type: "move_folder_to_workspace"; path: string; toWorkspaceId: string | null; index?: number }` to `packages/shared/src/browser-protocol.ts`, beside the workspace mutation family (design D1)
- [ ] 1.2 Add it to the `BrowserToServerMessage` union; confirm typecheck surfaces the unhandled case in the gateway switch

## 2. Server — store

- [ ] 2.1 Add `moveFolderToWorkspace(path, toWorkspaceId, index?)` to the `PreferencesStore` interface with a doc comment stating the nullable-target contract and the validate-before-mutate rule
- [ ] 2.2 Implement it in `packages/server/src/persistence/preferences-store.ts`: canonicalize internally, resolve the target BEFORE any detach, reject same-workspace moves via `ws.folders.includes(canon)`, clamp `index` to `[0, len]`, return `true` only on real mutation (design D1)

## 3. Server — handler

- [ ] 3.1 Extract everything after the `pinDirectory` call in `handlePinDirectory` into `pinDirectorySideEffects(resolved, ctx)`, keeping the `if (!preferencesStore) return` / `if (directoryService)` guards, and have `handlePinDirectory` call it (design D2)
- [ ] 3.2 Add `handleMoveFolderToWorkspace` in `packages/server/src/browser-handlers/directory-handler.ts`: guard the optional store, reject non-integer `index`, gate all effects on the store's return, and on eject call `pinDirectory` + `pinDirectorySideEffects` BEFORE broadcasting `workspaces_updated`
- [ ] 3.3 Wire the `case "move_folder_to_workspace"` dispatch in `packages/server/src/pairing/browser-gateway.ts`

## 4. Client — pure resolvers

- [ ] 4.1 Replace `sameTypeClosestCenter` with `compatibleClosestCenter` in `packages/client/src/lib/layout/sidebar-dnd.ts`, driven by an exported `DRAG_TARGETS` matrix; typeless active → closestCenter over all, typed-but-unmatrixed → same-type filter (design D3)
- [ ] 4.2 Implement `resolveFolderMove` in `sidebar-dnd.ts` returning `{ kind: "reorder-pinned" | "reorder-folders" | "move" } | null`, keyed on the (active, over) type pair per the design D5 table, including the own-slot / own-header / already-a-member null rules
- [ ] 4.3 Export `SPRING_LOAD_DWELL_MS = 600` and `PINNED_TIER_MIN_HEIGHT_PX = 64` as named constants

## 5. Client — components and wiring

- [ ] 5.1 Add a header-sized droppable to `WorkspaceHeader` with `id: "wsh:<ws.id>"` and `data: { type: "workspace-header", wsId }`, rendering `dropIndicatorProps` on `isOver` (design D4)
- [ ] 5.2 Add `PinnedTierDropZone` in `packages/client/src/components/workspace/`, sentinel id `__pinned_tier__`, mounted OUTSIDE the `visibleTopPinned.length > 0` gate, rendered only when the pinned tier is empty and a `workspace-folder` drag is active, min-height 64px
- [ ] 5.3 Add an `onMoveFolderToWorkspace?(path, toWorkspaceId, index?)` prop to `SessionList` and thread the sender from `App.tsx` beside the existing workspace senders
- [ ] 5.4 Replace the `activeType !== overType` early return in `handleDragEnd` with per-active-type dispatch; keep the `session` and `workspace` branches byte-identical and route folder-like actives through `resolveFolderMove` (design D5)
- [ ] 5.5 Add `onDragOver` to the `DndContext` plus a `springOpen: Set<wsId>` state and a dwell-timer ref; timer keyed on the resolved workspace id, `springOpen` add-only for the drag, both cleared in `handleDragEnd`/`handleDragCancel` (design D6)
- [ ] 5.6 Apply `displayCollapsed = springOpen.has(ws.id) ? false : (forceCollapsed.has(ws.id) || ws.collapsed)`
- [ ] 5.7 Verify the `DndContext` measuring config remeasures droppables mounted mid-drag (`MeasuringStrategy` for droppables); if it cannot be made reliable, cut spring-load rather than ship it half-working (design Risks)

## 6. Tests — L1 store and handler (server)

Exemplars: `packages/server/src/__tests__/preferences-store.test.ts` (store),
`packages/server/src/__tests__/openspec-group-broadcast.test.ts` (handler + broadcast assertions).

- [ ] 6.1 E1: ws B `[x,y,z]`, move `/a` with `index: -1` · call `moveFolderToWorkspace` · `/a` lands at position 0, no splice-from-end (test-plan #E1)
- [ ] 6.2 E2: ws B `[x,y,z]`, `index: 0` · move · `B.folders === [a,x,y,z]` (test-plan #E2)
- [ ] 6.3 E3: ws B `[x,y,z]`, `index: 3` · move · `B.folders === [x,y,z,a]` (test-plan #E3)
- [ ] 6.4 E4: ws B `[x,y,z]`, `index: 4` · move · clamped to `[x,y,z,a]` (test-plan #E4)
- [ ] 6.5 E5: `index: NaN` · handler entry · rejected, folders unchanged, zero broadcasts (test-plan #E5)
- [ ] 6.6 E6: `index` omitted · move · appended at end (test-plan #E6)
- [ ] 6.7 E7: `toWorkspaceId: "nope"` while `/a` is in ws A · move · `A.folders` still contains `/a`, returns false, zero broadcasts (test-plan #E7)
- [ ] 6.8 E8: `/a` already in target ws B · move · returns false, order unchanged, zero broadcasts (test-plan #E8)
- [ ] 6.9 E9: eject `/a` that is in no workspace · move with `toWorkspaceId: null` · returns false, NOT pinned, no side effects, zero broadcasts (test-plan #E9)
- [ ] 6.10 E19: `/a` in ws A · move to ws B · `/a` in B only, absent from A (test-plan #E19)
- [ ] 6.11 E20: `path` with trailing separator / case variant · move · canonical form stored once, no duplicate entry (test-plan #E20)
- [ ] 6.12 X1: eject via `handleMoveFolderToWorkspace` · assert `pinned_dirs_updated` is broadcast BEFORE `workspaces_updated` (test-plan #X1)
- [ ] 6.13 X2: unknown `toWorkspaceId` · handler invoked · not pinned, `onDirectoryAdded` not called, zero broadcasts (test-plan #X2)
- [ ] 6.14 X3: `ctx.preferencesStore` undefined · handler invoked · returns without throwing, zero broadcasts (test-plan #X3)
- [ ] 6.15 X4: `ctx.directoryService` undefined · eject invoked · still pins + broadcasts, does not throw (test-plan #X4)
- [ ] 6.16 X5: target ws mutated between the client's render and the message · move applied · membership correct (target ws only), store internally consistent (test-plan #X5)

## 7. Tests — L1 pure resolvers (client)

Exemplar: `packages/client/src/lib/__tests__/sidebar-dnd.test.ts`.

- [ ] 7.1 E10: active `pinned-group`, over `pinned-group` · `resolveFolderMove` · `{ kind: "reorder-pinned" }` (test-plan #E10)
- [ ] 7.2 E11: active + over `workspace-folder`, same `wsId` · resolve · `{ kind: "reorder-folders" }` (test-plan #E11)
- [ ] 7.3 E12: active + over `workspace-folder`, different `wsId` · resolve · `{ kind:"move", index: overWs.folders.indexOf(overId) }` (test-plan #E12)
- [ ] 7.4 E13: active `pinned-group`, over `workspace-folder` · resolve · `{ kind:"move", index }` (test-plan #E13)
- [ ] 7.5 E14: over `workspace-header`, active not a member · resolve · `{ kind:"move" }` with `index` undefined (test-plan #E14)
- [ ] 7.6 E15: over `workspace-header`, active already a member · resolve · `null` (test-plan #E15)
- [ ] 7.7 E16: active `workspace-folder`, over `pinned-group` or `pinned-tier` · resolve · `{ kind:"move", toWorkspaceId: null }` (test-plan #E16)
- [ ] 7.8 E17: active id === over id · resolve · `null` (test-plan #E17)
- [ ] 7.9 E18: over carries a `wsId` absent from `workspaces` · resolve · `null`, does not throw (test-plan #E18)
- [ ] 7.10 E21: active `type: "session"`, candidates include workspace + folder · `compatibleClosestCenter` · resolves only among `session` candidates (test-plan #E21)
- [ ] 7.11 E22: active `type: "workspace"`, candidates include inner folders/sessions · resolve · resolves to a `workspace` candidate (test-plan #E22)
- [ ] 7.12 E23: active with a type absent from the matrix · resolve · same-type filtering applied, NOT closestCenter over all (test-plan #E23)
- [ ] 7.13 E24: active with no `type` · resolve · closestCenter over all candidates (test-plan #E24)
- [ ] 7.14 P1: synthetic sidebar of 20 workspaces × 20 folders (~420 droppables), folder-like active · 1000 consecutive `compatibleClosestCenter` calls · p95 < 2 ms per call (test-plan #P1)

## 8. Tests — L1 component drags (client)

Exemplar: `packages/client/src/components/__tests__/workspace-drag-reorder.test.tsx` (already asserts which WS message a sidebar drag emits in jsdom).

- [ ] 8.1 F1: pinned dir `/p` + workspace B · drop on B's header · one `move_folder_to_workspace` `{path:/p, toWorkspaceId:B, index:undefined}`, `/p` becomes B's last folder (test-plan #F1)
- [ ] 8.2 F2: folder of ws A, ws B `[x,y,z]` · drop on slot of `y` · message carries `index: 1`, converges to `[x,a,y,z]` (test-plan #F2)
- [ ] 8.3 F3: pinned dir `/p`, ws B `[x,y,z]` · drop on slot of `y` · message carries `index: 1` (test-plan #F3)
- [ ] 8.4 F4: folder of ws A · drop on ws B · exactly ONE WS message sent, `/a` in B only (test-plan #F4)
- [ ] 8.5 F5: folder of ws A, pinned tier non-empty · drop on a pinned group · `{toWorkspaceId: null}` sent (test-plan #F5)
- [ ] 8.6 F6: two folders of the same ws · drag one onto the other · `reorder_workspace_folders` sent, NO `move_folder_to_workspace` (test-plan #F6)
- [ ] 8.7 F7: two pinned dirs · drag one onto the other · `reorder_pinned_dirs` sent, NO `move_folder_to_workspace` (test-plan #F7)
- [ ] 8.8 F8: session card with workspace header + folder rendered · drag session over them and release · no membership message, no workspace mutation (test-plan #F8)
- [ ] 8.9 F9: any folder · press, move below threshold, release on own slot · zero messages sent (test-plan #F9)
- [ ] 8.10 F10: folder `/a` of ws A at position 0 · drop on ws A's own header · zero messages, `/a` still at position 0 (test-plan #F10)
- [ ] 8.11 F14: collapsed ws B spring-expanded during a drag · drop, then drag-cancel in a second drag · no `set_workspace_collapsed` sent, B renders collapsed again both times (test-plan #F14)
- [ ] 8.12 F15: expanded ws A · drag A by its header handle · A renders collapsed for the drag and expanded after, no `set_workspace_collapsed` (test-plan #F15)
- [ ] 8.13 F17: ≥1 pinned directory, folder drag active · observe the pinned tier · `PinnedTierDropZone` absent, single eject target (test-plan #F17)
- [ ] 8.14 F19: folder drag active · hover a workspace header · header shows the drop indicator (test-plan #F19)

## 9. Tests — L3 Playwright (docker harness)

Exemplar: `tests/e2e/directory-home.spec.ts` for sidebar harness glue. Read the harness port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 9.1 F11: collapsed ws B, folder drag active · hover B's header and dwell 600 ms · B renders expanded (test-plan #F11)
- [ ] 9.2 F12: B spring-expanded · move pointer onto one of B's now-visible folders · B stays expanded, over resolves to the hovered folder, no collapse/expand oscillation (test-plan #F12)
- [ ] 9.3 F13: B spring-expanded with folders `[x,y,z]` · drop on slot of `y` inside the revealed body · `index: 1` sent, proving dnd-kit remeasured the mid-drag-mounted droppables (test-plan #F13)
- [ ] 9.4 F16: zero pinned directories, `workspace-folder` drag active · observe the pinned tier · drop zone rendered with computed height ≥ 64px and a drop indicator on hover (test-plan #F16)
- [ ] 9.5 F18: ws folder `/a` whose sessions are all ended · eject to the pinned tier · the `/a` row never unmounts across the transition (MutationObserver) (test-plan #F18)
- [ ] 9.6 F20: collapsed ws B, cursor near the header/first-folder boundary · jitter `over` between B's header and B's folder while dwelling · dwell timer not reset, B expands at 600 ms (test-plan #F20)
- [ ] 9.7 X6: two browser clients connected · eject performed in client 1 · client 2 converges to the same sidebar state without reload (test-plan #X6)

## 10. Manual verification

- [ ] 10.1 M1: inspect the sidebar in each of the 4 themes (studio, earth, athlete, gradient) during a folder drag — drop indicators legible and spring-load motion feels right (test-plan: manual-only)

## 11. Verify

- [ ] 11.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — clean
- [ ] 11.2 `npm run test:e2e` against the docker harness — clean
- [ ] 11.3 `npm run quality:changed` — clean
- [ ] 11.4 `npm run build && curl -X POST http://localhost:8000/api/restart`
- [ ] 11.5 Invoke the `review-code` discipline skill on the full diff before commit
- [ ] 11.6 Invoke `doubt-driven-review` on the implemented store + handler if either diverged from design D1/D2

## 12. Documentation

- [ ] 12.1 Update the `SessionList.tsx.AGENTS.md`, `sidebar-dnd.ts.AGENTS.md`, `SortableWorkspace.tsx.AGENTS.md`, `WorkspaceHeader.tsx.AGENTS.md` rows with `See change: drag-folders-across-workspaces`
- [ ] 12.2 Add a `PinnedTierDropZone.tsx` row to `packages/client/src/components/workspace/AGENTS.md`
- [ ] 12.3 Add rows for the touched server + shared files in their nearest `AGENTS.md`
- [ ] 12.4 Delegate any `docs/` prose (protocol reference in `docs/architecture.md`) to the DocScribe subagent in caveman style
- [ ] 12.5 `kb dox lint` — no `stale` / `missing` rows for the touched files
