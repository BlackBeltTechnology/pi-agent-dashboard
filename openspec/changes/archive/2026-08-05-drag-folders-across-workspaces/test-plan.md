# Test Plan — drag-folders-across-workspaces

Stage: design   Generated: 2026-08-04

Requirements under test:
- **RA** — Drag-to-reorder folders within a workspace (MODIFIED)
- **RB** — Type-aware drag collision detection (MODIFIED)
- **RC** — Drag folders across workspace boundaries (ADDED)
- **RD** — Spring-load collapsed workspaces during a drag (ADDED)

Values resolved at the clarification gate: collision budget **p95 < 2 ms/call**
over a synthetic 20×20 sidebar; `PinnedTierDropZone` **min-height 64 px**;
no-flash verified at **both** L1 (broadcast order) and L3 (row never unmounts).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | RC | BVA | L1 | automated | ws B = `[x,y,z]`, move `/a`, `index: -1` | `moveFolderToWorkspace` | `/a` at position 0; no splice-from-end |
| E2 | RC | BVA | L1 | automated | ws B = `[x,y,z]`, `index: 0` | same | `B.folders === [a,x,y,z]` |
| E3 | RC | BVA | L1 | automated | ws B = `[x,y,z]`, `index: 3` | same | `B.folders === [x,y,z,a]` |
| E4 | RC | BVA | L1 | automated | ws B = `[x,y,z]`, `index: 4` | same | clamped → `[x,y,z,a]` |
| E5 | RC | BVA (invalid) | L1 | automated | `index: NaN` | handler entry | rejected; `B.folders` unchanged; zero broadcasts |
| E6 | RC | EP | L1 | automated | `index` omitted | same | appended at end |
| E7 | RC | EP (invalid) | L1 | automated | `toWorkspaceId: "nope"`, `/a` currently in ws A | same | `A.folders` still contains `/a`; returns false; zero broadcasts |
| E8 | RC | EP (invalid) | L1 | automated | `/a` already in target ws B | same | returns false; `B.folders` order unchanged; zero broadcasts |
| E9 | RC | EP (invalid) | L1 | automated | eject `/a` that is in no workspace | same | returns false; NOT pinned; no side effects; zero broadcasts |
| E10 | RB/RA | decision-table | L1 | automated | active `pinned-group`, over `pinned-group` | `resolveFolderMove` | `{ kind: "reorder-pinned" }` |
| E11 | RA | decision-table | L1 | automated | active + over `workspace-folder`, same `wsId` | same | `{ kind: "reorder-folders" }` |
| E12 | RC | decision-table | L1 | automated | active + over `workspace-folder`, different `wsId` | same | `{ kind:"move", toWorkspaceId: overWs, index: overWs.folders.indexOf(overId) }` |
| E13 | RC | decision-table | L1 | automated | active `pinned-group`, over `workspace-folder` | same | `{ kind:"move", index }` |
| E14 | RC | decision-table | L1 | automated | over `workspace-header`, active not a member | same | `{ kind:"move" }`, `index` undefined |
| E15 | RC | decision-table | L1 | automated | over `workspace-header`, active already a member | same | `null` |
| E16 | RC | decision-table | L1 | automated | active `workspace-folder`, over `pinned-group` \| `pinned-tier` | same | `{ kind:"move", toWorkspaceId: null }` |
| E17 | RC | decision-table | L1 | automated | active id === over id | same | `null` |
| E18 | RC | decision-table (invalid) | L1 | automated | over carries a `wsId` absent from `workspaces` | same | `null`; does not throw |
| E19 | RC | state | L1 | automated | `/a` in ws A; move to ws B | `moveFolderToWorkspace` | `/a` in B only; absent from A (single-membership) |
| E20 | RC | EP | L1 | automated | `path` with trailing separator / case variant | same | canonical form stored once; no duplicate entry |
| E21 | RB | decision-table | L1 | automated | active `type: "session"`, candidates include workspace + folder | `compatibleClosestCenter` | resolves only among `session` candidates |
| E22 | RB | decision-table | L1 | automated | active `type: "workspace"`, candidates include inner folders/sessions | same | resolves to a `workspace` candidate |
| E23 | RB | EP (invalid) | L1 | automated | active with a type absent from the matrix | same | same-type filtering applied (NOT closestCenter over all) |
| E24 | RB | EP | L1 | automated | active with no `type` | same | closestCenter over all candidates (today's behavior) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | RB | timed unit | L1 | automated | synthetic sidebar: 20 workspaces × 20 folders (~420 droppables), folder-like active | p95 < 2 ms per `compatibleClosestCenter` call | 1000 consecutive calls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | RC | state-transition | L1 | automated | pinned dir `/p`, workspace B | drop on B's header | one `move_folder_to_workspace` `{path:/p, toWorkspaceId:B, index:undefined}`; `/p` is B's last folder |
| F2 | RC | state-transition | L1 | automated | folder of ws A, ws B = `[x,y,z]` | drop on slot of `y` | message carries `index: 1`; converges to `[x,a,y,z]` |
| F3 | RC | state-transition | L1 | automated | pinned dir `/p`, ws B = `[x,y,z]` | drop on slot of `y` | message carries `index: 1` |
| F4 | RC | state-transition | L1 | automated | folder of ws A | drop on ws B | **exactly one** WS message sent; `/a` in B only |
| F5 | RC | state-transition | L1 | automated | folder of ws A, pinned tier non-empty | drop on a pinned group | `{toWorkspaceId: null}`; `/a` renders in the pinned tier |
| F6 | RA | state-transition | L1 | automated | two folders of the same ws | drag one onto the other | `reorder_workspace_folders` sent; **no** `move_folder_to_workspace` |
| F7 | RB | state-transition | L1 | automated | two pinned dirs | drag one onto the other | `reorder_pinned_dirs` sent; **no** `move_folder_to_workspace` |
| F8 | RB | state-transition (illegal edge) | L1 | automated | session card, workspace header + folder rendered | drag session over them, release | no membership message; no workspace mutation |
| F9 | RC | state-transition (illegal edge) | L1 | automated | any folder | press, move < threshold, release on own slot | zero messages sent |
| F10 | RC | state-transition (illegal edge) | L1 | automated | folder `/a` of ws A at position 0 | drop on ws A's own header | zero messages; `/a` still at position 0 (does not jump to end) |
| F11 | RD | state-transition | L3 | automated | collapsed ws B, folder drag active | hover B's header, dwell 600 ms | B renders expanded |
| F12 | RD | state-transition | L3 | automated | B spring-expanded | move pointer onto one of B's now-visible folders | B stays expanded; over resolves to the hovered folder; no collapse/expand oscillation |
| F13 | RD | state-transition | L3 | automated | B spring-expanded, B = `[x,y,z]` | drop on slot of `y` inside the revealed body | `index: 1` (dnd-kit remeasured the mid-drag-mounted droppables) |
| F14 | RD | state-transition | L1 | automated | collapsed ws B spring-expanded during a drag | drop, then drag-cancel in a second drag | no `set_workspace_collapsed` sent; B renders collapsed again both times |
| F15 | RA/RD | state-transition (regression) | L1 | automated | expanded ws A | drag A by its header handle | A renders collapsed for the drag, expanded after; no `set_workspace_collapsed` |
| F16 | RC | state-transition | L3 | automated | zero pinned directories, `workspace-folder` drag active | observe the pinned tier | drop zone rendered, computed height ≥ 64 px, drop indicator present on hover |
| F17 | RC | decision-table | L1 | automated | ≥1 pinned directory, folder drag active | observe the pinned tier | `PinnedTierDropZone` absent (single eject target under cursor) |
| F18 | RC | convergence | L3 | automated | ws folder `/a` whose sessions are all ended | eject to pinned tier | the `/a` row never unmounts across the transition (MutationObserver) |
| F19 | RC | state-transition | L1 | automated | folder drag active | hover a workspace header | header shows the drop indicator |
| F20 | RD | state-transition | L3 | automated | collapsed ws B, cursor near the header/first-folder boundary | jitter `over` between B's header and B's folder while dwelling | dwell timer is not reset; B expands at 600 ms |
| M1 | RC/RD | visual/subjective | — | manual-only | sidebar in each of the 4 themes | human inspects drop indicators + spring-load motion | [judgment: indicators legible and the drag "feels right" in studio/earth/athlete/gradient] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | RC | ordering assertion | L1 | automated | — | eject via `handleMoveFolderToWorkspace` | `pinned_dirs_updated` is broadcast **before** `workspaces_updated` |
| X2 | RC | fault-injection | L1 | automated | unknown `toWorkspaceId` | handler invoked | directory NOT pinned; `onDirectoryAdded` NOT called; zero broadcasts |
| X3 | RC | fault-injection | L1 | automated | `ctx.preferencesStore` undefined | handler invoked | returns without throwing; zero broadcasts |
| X4 | RC | fault-injection | L1 | automated | `ctx.directoryService` undefined | eject invoked | still pins + broadcasts; does not throw |
| X5 | RC | fault-injection (concurrency) | L1 | automated | target ws mutated between the client's render and the message | move applied | membership is correct (target ws only); position may differ; store stays internally consistent |
| X6 | RC | convergence | L3 | automated | two browser clients connected | eject performed in client 1 | client 2 converges to the same sidebar state without reload |

---

## Coverage summary

- Requirements covered: 4/4 (RA, RB, RC, RD)
- Scenarios by class: edge 24 · perf 1 · frontend 21 · error 6 — **52 total**
- Scenarios by level: L1 44 · L2 0 · L3 7 · manual-only 1
- Scenarios by disposition: automated 51 · manual-only 1

No L2 rows: this change adds no install/spawn/multi-OS runtime surface — it is
client interaction plus an in-process store mutation.

L1-vs-L3 split for the frontend rows follows the shipped precedent: the existing
`workspace-drag-reorder.test.tsx` already asserts which WebSocket message a
sidebar drag emits in jsdom, so message-assertion rows stay L1. Only rows whose
observable genuinely needs a real browser — spring-load dwell timing, computed
geometry, non-unmount across a re-render, and multi-client convergence — are L3.

## New infra needed

None. All rows land in existing harnesses: vitest beside
`packages/client/src/lib/__tests__/sidebar-dnd.test.ts` and
`packages/server/src/__tests__/`, and Playwright specs in `tests/e2e/` against
the docker harness port read from `.pi-test-harness.json` (`dashboardPort`).
