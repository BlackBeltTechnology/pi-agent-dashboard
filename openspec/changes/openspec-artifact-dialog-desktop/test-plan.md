# Test Plan — openspec-artifact-dialog-desktop

Stage: design   Generated: 2026-07-16

Source: proposal.md + design.md + specs/openspec-artifact-reader/spec.md.
Boundary values from `useMobile()` = `matchMedia("(max-width:767px),(max-height:599px)")`
(mobile when width ≤ 767 **OR** height ≤ 599).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | gate: non-mobile → dialog | decision-table | L1 | automated | `openArtifact("/w","ch","proposal")`, `useMobile()`=false | call | `setArtifactDialog({cwd,changeName,artifactId})` invoked; `navigate` NOT called |
| E2 | gate: mobile → navigate | decision-table | L1 | automated | same call, `useMobile()`=true | call | `handleReadArtifact`→`navigate(buildOpenSpecPreviewUrl("/w","ch","proposal"))`; `artifactDialog` stays null |
| E3 | useMobile width boundary (not mobile) | BVA | L1 | automated | vw=768, vh=800 | badge click | dialog path (not-mobile) |
| E4 | useMobile width boundary (mobile) | BVA | L1 | automated | vw=767, vh=800 | badge click | navigate path (mobile) |
| E5 | useMobile height boundary — short wide window IS mobile | BVA | L1 | automated | vw=1400, vh=599 | badge click | navigate path (full-page route), NOT dialog |
| E6 | useMobile height boundary (not mobile) | BVA | L1 | automated | vw=1400, vh=600 | badge click | dialog path |
| E7 | all 5 wiring sites gated | decision-table | L3 | automated | non-mobile; badge on SessionList (bare-ref), board, mobileActions menu, SessionHeader, ComposerSessionActions ArtifactChip | click P on each surface | dialog opens on every surface (none navigates) |
| E8 | archive isolation (non-goal guard) | decision-table | L3 | automated | archived change badge inside ArchiveBrowserView | click P | archive reader renders (`archive=true`); no `OpenSpecArtifactDialog`, no navigate |
| E9 | mobile route unchanged (non-goal guard) | state-transition | L3 | automated | `useMobile()`=true | click P | full-page preview route at `buildOpenSpecPreviewUrl`; browser Back closes it |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | dialog over current view, URL unchanged, tabs | state-transition | L3 | automated | non-mobile, change "ch" with 4 artifacts, active view = a session | click P | dialog mounted; underlying view still in DOM; `location.href` unchanged; tab bar shows P/D/S/T with P active |
| F2 | tab switch = local state, no history push | state-transition | L3 | automated | dialog open on P | click D tab | content = design artifact; `history.length` unchanged; `location.href` unchanged |
| F3 | flex-wrapper full-height render (regression guard) | state-convergence | L3 | automated | dialog open | render | header + tab bar + content area all visible; content area boundingRect height > 0 (not collapsed) |
| F4 | close via Esc / backdrop / back reveals view | state-transition | L3 | automated | dialog open (3 edges) | press Esc · click backdrop · activate reader back | dialog unmounted each way; underlying view revealed unchanged |
| F5 | focus returns to triggering badge on close | state-transition | L3 | automated | dialog opened from badge B | close dialog | `document.activeElement` === badge B |
| F6 | resize into mobile auto-closes | state-transition (illegal edge) | L3 | automated | dialog open at vw=1000 | resize to vw=700 (`useMobile()`→true) | dialog unmounted (`artifactDialog`=null) |
| F7 | ephemeral — no reload survival (accepted trade) | state-transition | L3 | automated | dialog open | reload page | after reload: no dialog, base view; URL is the base route |
| F8 | letter cursor hint | static | L1 | automated | hover a badge letter | hover | computed `cursor: pointer` |
| F9 | nested-dialog focus-trap sanity | manual/static | — | manual-only | any badge surface | human/audit check | no badge surface renders inside an already-open Dialog (latent-collision guard) — human judgment |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | cold-load convergence | fault-injection (delay) | L3 | automated | `openspecMap` has no entry for cwd yet | click badge, then WS replay populates map | dialog shows loading state, then converges to artifact content; no crash |
| X2 | not-found = dedicated message | fault-injection (missing) | L1 | automated | populated map, change "ch" absent | render dialog for "ch" | explicit not-found copy shown (NOT generic "Failed to fetch" from the reader) |
| X3 | change removed mid-dialog | state-transition | L3 | automated | dialog open on "ch" | WS update drops "ch" from active map | dialog flips to not-found; no exception thrown |

---

## Coverage summary

- Requirements covered: 8 spec scenarios + design invariants (gate location, flex wrapper, not-found, resize, archive isolation, ephemeral trade)
- Scenarios by class: edge 9 · perf 0 · frontend 9 · error 3
- Scenarios by level: L1 8 · L3 11 · manual-only 1
- Scenarios by disposition: automated 20 · manual-only 1

## New infra needed

- **OpenSpec fixture (added during apply):** the docker harness `sample-git`
  fixture shipped no `openspec/` project, so badges never rendered. Added
  `docker/fixtures/sample-git/openspec/` — an active change `e2e-artifact-demo`
  (all 4 artifacts) + an archived change — so `openspec list` yields P/D/S/T
  badges for the L3 specs. (Original plan's "none" was inaccurate.)
- L1 (vitest) + L3 (Playwright docker harness) frameworks already existed.
- **X1/X3 landed at component-integration level, not L3.** Their states are
  UI-unreachable through a real badge click: badges only render once
  `openspecMap` is populated (so cold-load X1 has no click window), and no
  runtime endpoint deletes an active change (so mid-dialog removal X3 can't be
  triggered in-harness). Both are covered deterministically in
  `OpenSpecArtifactDialog.test.tsx` by driving the `openspecMap` prop — the
  exact source the component derives from — asserting the same observables
  (loading→content; not-found flip, no crash).

## Notes

- No performance class: this change adds no latency/throughput budget. The
  pre-existing uncancelled-`fetch` inefficiency (documented in design) is
  correctness-safe and explicitly out of scope — not tested here.
- HARD gate passed with no clarifications: every Triple slot is concrete
  (boundary values derived from `useMobile` source; not-found/cold-load
  observables are measurable). No spec gap to force.
