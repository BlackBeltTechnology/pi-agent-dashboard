# Test Plan — enable-workspace-folder-home-page

Stage: apply   Generated: 2026-07-16

## Scenarios

### Edge-case

Requirement: **Directory-eligibility guard** — decision table over
`pinned? × workspace-member?` (both loaded), plus the guard's ready-gate.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | eligibility guard | decision-table | L1 | automated | cwd in `workspaceFolders`, NOT in `pinnedDirectories`; both loaded flags true | `DirectoryHomeView` mounts | prompt surface renders; `directory-home-not-pinned` notice absent |
| E2 | eligibility guard | decision-table | L1 | automated | cwd in `pinnedDirectories`, NOT a workspace member; both loaded true | mount | prompt surface renders (existing pinned behavior unchanged) |
| E3 | eligibility guard | decision-table | L1 | automated | cwd neither pinned nor workspace member; both loaded true | mount | guard-miss notice renders with pin CTA; no prompt |
| E4 | eligibility guard | decision-table | L1 | automated | cwd BOTH pinned AND workspace member; both loaded true | mount | prompt surface renders (either-set membership suffices) |

### Frontend-quirk

Requirement: **cold-load ordering** (`pinned_dirs_updated` before
`workspaces_updated`) and the **sidebar affordance** render condition.

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | cold-load no-flash | state-transition | L1 | automated | workspace-only cwd; `pinnedDirectoriesLoaded=true`, `workspacesLoaded=false` | render in the between-messages window | loading state renders; guard-miss notice NEVER renders in that window |
| F2 | cold-load no-flash | state-transition | L1 | automated | continuation of F1 | `workspacesLoaded` flips true (workspaces arrive) | converges to prompt surface; notice never appeared |
| F3 | sidebar affordance | decision-table | L1 | automated | unpinned workspace-folder row (`DirectoryGroup.pinned=false`, rendered with `inWorkspace=true`) | row renders | open (`mdiOpenInNew`) affordance present (`folder-open-home-<cwd>`) |
| F4 | sidebar affordance | state-transition | L1 | automated | expanded unpinned workspace-folder row | activate the open affordance | `navigate(buildFolderHomeUrl(cwd))` called; collapse state unchanged; no drag started |
| F5 | sidebar affordance | decision-table | L1 | automated | pinned non-workspace row (regression) | row renders | affordance still present and navigates (existing behavior unchanged) |
| F6 | end-to-end reachability | state-transition | — | manual-only | live dashboard, an unpinned workspace folder | click ⧉, then hard-refresh the `/folder/<enc>` URL | home page renders with centered prompt; no notice flash on refresh [judgment: visual no-flash across a real network round-trip] |

## Coverage summary

- Requirements covered: 2/2 (eligibility guard; sidebar affordance)
- Scenarios by class: edge 4 · perf 0 · frontend 6 · error 0
- Scenarios by level: L1 9 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 9 · manual-only 1

## New infra needed

- none — E1–E4 extend `DirectoryHomeView.test.tsx`; F1–F5 extend
  `DirectoryHomeView.test.tsx` / `SessionList.test.tsx` (existing vitest suites).
  F6 is a human no-flash check, deferred post-merge.

## Notes

- No error-handling/performance class: this change adds no dependency, network
  path, or latency budget — it flips two render predicates and adds one loaded
  flag. Fault-injection/soak scenarios would be manufactured, not real.
- F1/F2 are the load-bearing scenarios (they pin the blocker-2 fix); E1 + F3 pin
  blocker-1. F5 + E2 guard the "existing pinned behavior unchanged" contract.
