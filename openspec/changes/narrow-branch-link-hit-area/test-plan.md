# Test Plan — narrow-branch-link-hit-area

Stage: design   Generated: 2026-11-23

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | link bounded to icon+text; `title` only on link | decision-table (url allowed) | L1 | automated | session `gitBranch: "develop"`, `gitBranchUrl: "https://github.com/o/r/tree/develop"` | render `SessionCard` | `[data-testid="session-card-git-row"]` holds a wrapper span with tokens `flex grow basis-[6ch] min-w-0` and none of `truncate`/`overflow-hidden`/`title`; inside it one `<a>` with tokens `min-w-0 truncate focus-ring` and no `grow`/`basis-[6ch]`, `title="develop"`, containing the branch icon svg + text |
| E2 | non-link branch path unchanged | decision-table (no url) | L1 | automated | `gitBranch: "develop"`, no `gitBranchUrl` | render `SessionCard` | branch is a `<span title="develop">` with tokens `grow basis-[6ch] min-w-0 truncate`, direct child of the git row; no `<a>` in the row's branch slot |
| E3 | blocked relayed URL stays inert | decision-table (url blocked) | L1 | automated | `gitBranch: "develop"`, `gitBranchUrl: "data:text/html,x"` | render `SessionCard` | no `<a>` for the branch; inert element with text `develop` sits inside the wrapper span; existing relayed-links assertions still pass |
| E4 | trailing-pill wrap unchanged (no extra flex item) | EP (row composition) | L1 | automated | worktree session, `gitBranchUrl` set, `gitPrNumber: 812`, `gitStatus.dirtyCount: 5` | render `SessionCard` | git row has exactly 4 element children in order: `worktree-pill`, branch slot, `worktree-pr-segment`, `git-dirty-pill` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | scenario "Branch link is clickable only on its text" (geometry) | BVA (wide card) | L3 | automated | 480 px card; `gitBranch: "develop"`, seeded `gitBranchUrl`, `dirtyCount: 5` (git-status stub) | page load, measure | link `getBoundingClientRect().right` within 1 px of the text range end; `git-dirty-pill` right edge within 1 px of git-row content-box right edge; `document.elementFromPoint` at the midpoint between link right and pill left is not, and is not inside, any `a`/`button` below the card root |
| F2 | dead-space click selects the session, no new tab | state-transition (click target) | L3 | automated | same as F1, second session also seeded and selected | click the F1 midpoint | no `popup` event within 1 s; clicked session becomes the selected session (its card gets the selected state) |
| F3 | scenario "Long linked branch still ellipsizes inside the link" | BVA (narrow card) | L3 | automated | 260 px card; 60-char `gitBranch`, seeded `gitBranchUrl`, open PR, `dirtyCount: 12` | page load, measure | link `scrollWidth > clientWidth`; link width within 1 px of wrapper width; link width ≥ 6ch; link `title` = full branch; pills inside card content box (existing F2 still green) |
| F4 | 6ch floor belongs to the slot, not the link | BVA (below 6ch) | L3 | automated | 480 px card; `gitBranch: "b"`, seeded `gitBranchUrl` | page load, measure | wrapper width ≥ 6ch; link width < wrapper width; link right edge within 1 px of text end |
| F5 | scenario "Focused branch link shows its focus ring" | state-transition (focus) | L3 | automated | 260 px card; 60-char branch, seeded `gitBranchUrl` | keyboard Tab until the branch link is `document.activeElement` | link computed `outline-style: solid`, `outline-width: 2px`; every element from the link's parent up to the git row has computed `overflow: visible` |
| M1 | layout parity across themes | visual/subjective | — | manual-only | real dashboard, a card with branch link + PR + dirty pill | switch through studio / earth / athlete / gradient themes | [judgment: git row looks unchanged vs before; dirty pill right-aligned; underline only under the branch text on hover] |

---

## Coverage summary

- Requirements covered: added rule + 3 added scenarios of "Git row orders worktree first and truncates only the branch" (existing scenarios guarded by unchanged tests + F3)
- Scenarios by class: edge 4 · perf 0 · frontend 6 · error 0
- Scenarios by level: L1 4 · L2 0 · L3 5 · manual 1
- Scenarios by disposition: automated 9 · manual-only 1

## New infra needed

- none (L3 extends `tests/e2e/compact-session-card-header.spec.ts` seed with a `gitBranchUrl` field; existing harness + git-status stub reused)
