# Test Plan — add-folder-action-banner

> **Apply blocker (`fix-reliable-live-control-events`):** Scenario E3 assumes main-checkout inheritance that `resolveConfigRoot(cwd)` no longer provides. Reconcile expected behavior before implementation.

Stage: design   Generated: 2026-08-14

Clarification gate: **passed**. Three unfillable slots were resolved and folded
back into the spec as requirements — the scaffold-completion trigger (spawned
session reaching status `ended`), the running-state presentation (in-place
content swap, no re-rank), and the perf question (no threshold; the checklist is
cached, and cache correctness is covered functionally by X4 rather than by a
timing row). No `[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Checklist replaces the boolean | EP | L1 | automated | directory with `openspec/` present and `AGENTS.md` absent | init-status probed | checklist reports `openspec` present, `agents` absent; response does not collapse this to `configured:false` |
| E2 | Exactly one required artifact | decision-table | L1 | automated | the five-entry artifact set | checklist built | exactly one entry, `settings`, carries `required: true` |
| E3 | Checklist resolves at config root | BVA (worktree boundary) | L1 | automated | git worktree whose own dir lacks `.pi/settings.json`, main checkout has it | init-status probed for the worktree | `settings` reported **present** |
| E4 | Checklist computed on every response | decision-table | L1 | automated | directory whose config root declares a `worktreeInit` hook | init-status probed | response carries the checklist alongside the hook fields |
| E5 | Banner gated on required only | decision-table | L1 | automated | `.pi/settings.json` present, `AGENTS.md` + `openspec/` absent | card renders | no banner renders; menu tally reports `3/5` |
| E6 | Two setup states only | EP | L1 | automated | `.pi/settings.json` absent | card renders | banner reads "Not a pi project yet" at info severity with a `Set up →` action |
| E7 | Two setup states only | EP | L1 | automated | every artifact present | card renders | no setup banner renders |
| E8 | One banner max, fixed ladder | decision-table | L1 | automated | directory with BOTH a failed init run and a revoked hook trust | card renders | exactly one banner renders, the init-failure one |
| E9 | Cleanup is not a banner | decision-table | L1 | automated | 3 broken sessions, no blocking init state | card renders | no banner renders; menu `DIRECTORY` group offers `folder-menu-cleanup-broken-<cwd>` naming 3 |
| E10 | Cleanup item hidden at zero | BVA (zero boundary) | L1 | automated | folder with 0 broken sessions | menu opens | no cleanup item renders |
| E11 | Project-root rows only | decision-table | L1 | automated | row for a non-git directory the user never pinned or added to a workspace | card renders | no "not a pi project" banner renders |
| E12 | Permanent menu item + tally | EP | L1 | automated | directory whose checklist reports every artifact present | menu opens | `DIRECTORY` group contains `Project setup… 5/5` |
| E13 | Drift badge driven by setupOutdated | decision-table | L1 | automated | synthetic init-status payload with `setupOutdated: true` | menu opens | `Project setup…` item carries a `● update` badge |
| E14 | Drift badge absent by default | decision-table | L1 | automated | payload omitting `setupOutdated` | menu opens | item carries no badge |
| E15 | Drift never banners | decision-table | L1 | automated | payload with `setupOutdated: true` and all artifacts present | card renders | no banner renders |
| E16 | Severity tokens, no new property | decision-table | L1 | automated | banner rendered at each of info/warning/error | card renders | every colour resolves from an existing `--severity-*` triple; no custom property added by this change |
| E17 | Glyph distinctness on the rendered card | decision-table | L1 | automated | a card rendering the folder glyph, the menu trigger and a setup banner | card renders | no two rendered glyphs are identical |

### Performance

None. The clarification gate resolved that the widened probe (≈5 `existsSync`
calls behind a cache) does not warrant a threshold. Cache **correctness** — the
failure mode that actually bites — is covered functionally by X4, not by timing.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Banner placement with a git row | state-transition | L3 | automated | git-backed directory qualifying for a banner | card renders | banner renders below the git row and above the slot-pill grid |
| F2 | Banner placement without a git row | state-transition | L3 | automated | non-git pinned directory qualifying for a banner | card renders | banner renders directly below the header row and above the slot pills |
| F3 | Git row is facts-only | decision-table | L3 | automated | directory with a pending initialization | card renders | git row carries only branch/dirty affordances; the init control is inside the banner |
| F4 | Banner clears after its own action | state-convergence | L3 | automated | directory showing the setup banner | spawned project-init session reaches status `ended` having written `.pi/settings.json` | init-status is re-probed and the banner converges to absent with no other user action |
| F5 | Abandoned setup leaves the banner | state-transition (illegal edge) | L3 | automated | directory showing the setup banner | spawned session reaches `ended` WITHOUT writing `.pi/settings.json` | re-probe fires and the banner remains rendered |
| F6 | Running replaces content in place | state-transition | L3 | automated | directory whose banner offers an init action | user starts the run from the banner | running state renders inside the same banner element; the banner's position does not change |
| F7 | Init progress and failure live in the banner | state-transition | L3 | automated | init run in flight, then failing | run progresses then fails | progress and the failure summary render inside `folder-banner-*-<cwd>`; a Retry action is present; the stderr tail stays behind an opt-in disclosure; no auto-dismiss |
| F8 | Trust revocation banners at warning | state-transition | L3 | automated | directory whose hook definition changed since last trusted | card renders | a warning-severity banner renders with a `Review…` action that opens the trust-confirm dialog |
| F9 | Banner action does not collapse or navigate | state-transition (illegal edge) | L3 | automated | expanded folder header whose row navigates to the directory home | user activates the banner's action | the action fires; the folder does not collapse; no navigation to the directory home |
| F10 | Banner is keyboard reachable | state-transition | L3 | automated | card rendering a banner | user tabs through the card | the banner action receives focus with a visible focus ring |
| F11 | Polite, non-repeating announcement | state-convergence | L3 | automated | card rendering an unchanged failure banner | the card re-renders and init-status is refetched | the live region announces once on appearance and not again while identity and message are unchanged |
| F12 | Banner visual weight at tier 0 | visual/subjective | — | manual-only | a sidebar with several directories, one unconfigured | human looks at the sidebar | [judgment: the banner reads as urgent without swamping the card, and many banners do not make the sidebar unusable — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Probe failure fails open | fault-injection (abort) | L1 | automated | the artifact probe throws | init-status returned | the checklist field is omitted from the response; no artifact is reported absent |
| X2 | Absent checklist is not an absent project | fault-injection (missing data) | L1 | automated | response whose checklist field is absent — the client's own fail-open shape | card renders | no banner renders; absence is not read as "zero artifacts present" |
| X3 | Checklist outranks the legacy boolean | decision-table | L1 | automated | transitional payload where `configured` and the checklist disagree | banner state derived | the checklist is used and the boolean ignored |
| X4 | Cache invalidated after a scaffold | fault-injection (stale cache) | L1 | automated | cached checklist reporting `.pi/settings.json` absent | a project-init session completes in that directory | the next probe reports it present and does not serve the stale entry |
| X5 | Stale client degrades to silence | fault-injection (unparseable input) | L1 | automated | init-status payload the client cannot interpret | card renders | no banner renders |

---

## Coverage summary

- Requirements covered: 20/20 across the eight delta specs
- Scenarios by class: edge 17 · perf 0 · frontend 12 · error 5
- Scenarios by level: L1 22 · L2 0 · L3 11 · manual-only 1
- Scenarios by disposition: automated 33 · manual-only 1

No L2 rows: the change touches one HTTP route and the client. There is no
install, spawn or multi-OS runtime surface for the VM smoke tier.

## New infra needed

None, with one caveat for the L3 author: F4/F5 need a spawned session driven to
`ended` with and without a `.pi/settings.json` write. Check `tests/e2e/` for an
existing spawn-and-end helper before building one — if none exists, that is
fixture work inside the existing docker harness, not a new level. The harness
port comes from `.pi-test-harness.json` (`dashboardPort`), never hardcoded.
