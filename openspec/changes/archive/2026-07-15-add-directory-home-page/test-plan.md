# Test Plan — add-directory-home-page

Stage: design   Generated: 2026-07-15

No clarifications outstanding — every scenario's Triple slots are concrete; the one
subjective slot (visual centering) is routed `manual-only`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Centered prompt spawns a session | decision-table | L1 | automated | home page for pinned `<cwd>`, prompt text `"do X"` | user sends | `handleSpawnSession` called with args `(<cwd>, undefined, { initialPrompt: "do X" })` — 2nd arg is `undefined`, not an options object |
| E2 | Centered prompt spawns a session | BVA (empty boundary) | L1 | automated | prompt = `""` / whitespace-only | user activates send | no `spawn_session` sent |
| E3 | Centered prompt spawns a session | state-transition (illegal edge) | L1 | automated | a spawn from this page already in flight (not yet correlated) | user activates send again | send control disabled; no second `spawn_session` issued |
| E4 | Pinned-directory guard | decision-table | L1 | automated | `pinnedDirectories = ["/a"]` loaded, route cwd `/b` | page renders | not-pinned notice + pin CTA render; no prompt surface |
| E5 | Pinned-directory guard (cold load) | state-transition | L1 | automated | `pinnedDirectoriesLoaded = false`, route cwd `/a` (in fact pinned) | page renders before snapshot arrives | loading state renders; not-pinned notice does NOT render; after `loaded=true` with `/a` pinned → prompt renders |
| E6 | Bare directory route | state-transition (illegal edge) | L1 | automated | path `/folder/<enc>/terminals` | route matching evaluated | bare `/folder/:encodedCwd` match is false while the `/terminals` match is true (no shadowing) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Bare directory route + Centered prompt + Navigate | state-convergence | L3 | automated | dashboard on a pinned folder with the sidebar visible | user activates the pinned row "open" affordance → types `"hello"` → sends | converges to URL `/session/<newId>` for a newly created session in `<cwd>` whose first user prompt is `"hello"` |
| F2 | Sidebar open affordance | state-transition | L1 | automated | expanded pinned folder row | user activates the "open" affordance | `navigate("/folder/<enc>")` called; folder collapsed-state unchanged (event did not reach the collapse toggle) |
| F3 | Directory home content | decision-table | L1 | automated | pinned `<cwd>` with 2 existing sessions | page renders | folder-name header, the 2 sessions, and terminals/editor/settings quick actions all present alongside the prompt |
| F4 | Directory home content (empty state) | state-transition | L1 | automated | pinned `<cwd>` with 0 sessions | page renders | centered prompt present; session list empty; no second onboarding/LandingPage surface rendered |
| F5 | Bare directory route (mobile) | state-transition | L3 | automated | mobile viewport, navigated to `/folder/<enc>` from the sidebar | user triggers back | pops to the predecessor surface (home page treated at correct depth, not depth-0) |
| F6 | Directory home content (layout) | visual/subjective | — | manual-only | rendered directory home, empty folder | human looks | [judgment: prompt is vertically centered and reads as the focal "start here" — no automatable observable] |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 6 · perf 0 · frontend 6 · error 0
- Scenarios by level: L1 9 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 11 · manual-only 1

## New infra needed

- none — L1 uses existing vitest component tests under `packages/client/src/components/__tests__/`; L3 uses the existing Playwright docker harness (`tests/e2e/`, port from `.pi-test-harness.json`).
