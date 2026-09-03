# Test Plan — fix-kb-settings-reindex-gate

Stage: design   Generated: 2026-08-28

Clarification gate: **passed (hard gate)**. Three unfillable observable slots were
raised via `ask_user` and resolved before this file was written:

- **C1** — the disabled-action reason is **visible inline text** beside the action, not
  a `title` tooltip. Blocks `E16`; a tooltip on a disabled button is unreliable across
  browsers and invisible to a sight-based assertion.
- **C2** — the single error region's precedence is
  `bootstrapErr ?? reindexError ?? error ?? statsError` (user-initiated before
  ambient). Blocks `X5`/`X6`; without it the observable degrades to "some error shows".
- **C3** — `:221` becomes two variants keyed on `resolvedSources`, keeping the strong
  "nothing will be indexed" wording only when it is true. Blocks `E14`/`E15`.

No `[NEEDS CLARIFICATION]` markers remain.

Requirement keys used below (from `specs/kb-folder-slot/spec.md`, this change):
**R1** enabled iff resolved sources non-empty and nothing in flight ·
**R2** independent of `origin` and of form dirtiness ·
**R3** page never predicts "indexes nothing" while sources resolve ·
**R4** no double-submit · **R5** errors surfaced with a fixed precedence ·
**R0** pre-existing behaviour preserved.

Level key: **L1** `packages/kb-plugin/src/client/__tests__/*.test.tsx` (vitest + RTL) ·
**L3** `tests/e2e/*.spec.ts` (Playwright vs the docker harness, port read from
`.pi-test-harness.json` `dashboardPort` — never hardcoded).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | decision-table | L1 | automated | `origin=project`, `resolvedSources` 1 entry, form pristine, no job running | panel renders | `kb-reindex-now` is in the DOM and not `disabled` |
| E2 | R1 | decision-table | L1 | automated | as E1 | activate `kb-reindex-now` | `POST /api/kb/reindex?cwd=C` fired exactly once AND no `PUT /api/kb/config` fired |
| E3 | R1 | BVA (lower, invalid) | L1 | automated | `resolvedSources` length 0 | panel renders | `kb-reindex-now` present and `disabled` |
| E4 | R1 | BVA (lower+1, valid) | L1 | automated | `resolvedSources` length 1 | panel renders | `kb-reindex-now` present and enabled — the 0↔1 boundary flips exactly here |
| E5 | R2 | equivalence-partition | L1 | automated | `origin=global`, `resolvedSources` non-empty | panel renders | `kb-reindex-now` enabled AND `kb-copy-parent` + `kb-create-config` still present |
| E6 | R2 | equivalence-partition | L1 | automated | `origin=defaults` (⇒ `resolvedSources` necessarily empty) | panel renders | `kb-reindex-now` present and `disabled` — no test asserts defaults-with-sources, a state the server cannot produce |
| E7 | R2 | decision-table | L1 | automated | `resolvedSources` non-empty, form pristine | panel renders | `kb-save-reindex` `disabled` AND `kb-reindex-now` enabled |
| E8 | R2 | decision-table | L1 | automated | `resolvedSources` non-empty, form dirty | panel renders | BOTH `kb-save-reindex` and `kb-reindex-now` enabled |
| E9 | R1 | decision-table (false-enable guard) | L1 | automated | `resolvedSources` empty, user has typed a source into the form (dirty, unsaved) | panel renders | `kb-reindex-now` STILL `disabled` — gate follows disk, not the form |
| E10 | R1 | decision-table (false-disable guard) | L1 | automated | `resolvedSources` non-empty via legacy `roots[]`, `edit.sources` empty | panel renders | `kb-reindex-now` ENABLED |
| E11 | R1 | decision-table | L1 | automated | `resolvedSources` non-empty, a config save in flight (`saving` true) | panel renders | `kb-reindex-now` `disabled` |
| E12 | R3 | decision-table | L1 | automated | `origin=global`, `resolvedSources` non-empty, mock includes `resolvedSources` | panel renders | `kb-bootstrap-note` ABSENT — this is the existing `KbSettings.test.tsx` assertion inverted by a faithful mock |
| E13 | R3 | decision-table | L1 | automated | `origin=defaults`, `resolvedSources` empty | panel renders | `kb-bootstrap-note` PRESENT |
| E14 | R3 | decision-table | L1 | automated | `edit.sources` empty, `resolvedSources` non-empty | panel renders | the sources notice reads "(no sources defined)" and does NOT contain "nothing will be indexed" |
| E15 | R3 | decision-table | L1 | automated | `edit.sources` empty, `resolvedSources` empty | panel renders | the sources notice DOES contain "nothing will be indexed" |
| E16 | R1 (C1) | decision-table | L1 | automated | `resolvedSources` empty | panel renders | the define-a-source explanation is present as VISIBLE text near the action — asserted on rendered text, and NOT satisfied by a `title` attribute alone |
| E17 | R0 | regression | L1 | automated | form dirty | activate `kb-save-reindex` | `PUT /api/kb/config` with `reindex:true`, then `refetchStats()` after the existing 300ms hand-off — unchanged |
| E18 | R0 | decision-table (glyph audit) | L1 | automated | footer rendering both actions | panel renders | `kb-save-reindex` carries `mdiRefresh`, `kb-reindex-now` carries `mdiDatabaseRefreshOutline`, and no glyph appears on both |
| E19 | R1 | type-assertion (fails-closed) | L1 | automated | `KbConfigResponse.config` retyped as `ResolvedConfig` | type-check | `config.resolvedSources` type-checks AND `resolvedSources[0].identity` is a type ERROR — proving the narrow `config.ts` shape was used, not the wide `sources.ts` re-export. The negative arm MUST be verified to fail before it is trusted |
| E20 | R0 | regression (orthogonality) | L1 | automated | archived `E1` in `FolderKbSection.test.tsx:108` | run UNEDITED | still green — zero focusable elements in the pill grid beyond pill roots |
| E21 | R0 | regression (orthogonality) | L1 | automated | archived `E2` in `FolderKbSection.test.tsx:108` | run UNEDITED | still green — no `mdiRefresh` inside a pill |
| E22 | R0 | regression (orthogonality) | L1 | automated | archived `F4` in `FolderKbSection.test.tsx:122` | run UNEDITED | still green — card placement registers no folder menu item |

### Performance

None. This change adds no latency, throughput, memory or soak budget: the reindex job
is server-owned and already non-blocking, and the new control only changes when a
button is enabled. Inventing a perf row here would be a smoke test wearing a
performance label.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R4 | state-transition | L1 | automated | enabled `kb-reindex-now` | activate once | the action becomes `disabled` synchronously, before any server response resolves (optimistic `pending`) |
| F2 | R4 | state-transition | L1 | automated | enabled action | activate twice inside the pending window | `reindexKb` called exactly once |
| F3 | R4 | state-convergence | L1 | automated | pending active | `/stats` poll resolves `indexing:true` | the action stays `disabled` across the pending→indexing hand-off, with no intermediate enabled render |
| F4 | R4 | state-transition | L1 | automated | job in flight | `/stats` poll resolves `indexing:false` | the action converges to enabled |
| F5 | R4 | state-transition | L1 | automated | job settles before the first poll observes it | `REINDEX_GUARD_MS` (4000) elapses | the action converges to enabled — no permanent wedge |
| F6 | R4 | state-transition | L1 | automated | pending reindex on cwd `A` | navigate the panel to cwd `B` | `B` renders enabled with no error carried over from `A` |
| F7 | R1, R2 | use-case (end-to-end) | L3 | automated | docker harness with a worktree session card exposing the KB slot, worktree has resolvable sources | activate the slot `→`, then `Reindex now` | the settings page for the WORKTREE cwd opens, the action is enabled, and the reindex POST is accepted — the reported complaint, proven fixed on the only path the card offers |
| F8 | R0 | visual/subjective | — | manual-only | the footer rendering `Save + Reindex` and `Reindex now` together | a human looks at it | [judgment: the two actions read as distinct and it is obvious which applies — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 | fault-injection (abort) | L1 | automated | `POST /api/kb/reindex` rejects (no job starts) | activate `kb-reindex-now` | `kb-settings-error` renders the reindex trigger error text |
| X2 | R5 | fault-injection (abort) | L1 | automated | as X1 | after the rejection settles | the action returns to enabled so a retry is possible |
| X3 | R5 | fault-injection (delay) | L1 | automated | a single `/api/kb/stats` poll fails during a running job | that one poll misses | no error is rendered and the busy state persists — one blip never trips the threshold |
| X4 | R5 | fault-injection (abort) | L1 | automated | `/api/kb/stats` fails `MAX_POLL_MISSES` (3) consecutive times during a job | the page settles | `kb-settings-error` surfaces the outage rather than presenting an unexplained idle action |
| X5 | R5 (C2) | decision-table | L1 | automated | a reindex trigger rejection AND a stats outage both outstanding | panel renders | `kb-settings-error` shows the REINDEX trigger error (user-initiated outranks ambient) |
| X6 | R5 (C2) | decision-table | L1 | automated | a bootstrap failure AND a reindex trigger rejection both outstanding | panel renders | `kb-settings-error` shows the BOOTSTRAP error (leftmost in the precedence chain) |

---

## Coverage summary

- Requirements covered: 6/6 (R0–R5)
- Scenarios by class: edge 22 · perf 0 · frontend 8 · error 6 — **36 total**
- Scenarios by level: L1 34 · L2 0 · L3 1 · manual-only 1
- Scenarios by disposition: **automated 35 · manual-only 1**

Notes on deliberate omissions:

- **No "defaults origin with non-empty sources" row.** `DEFAULTS.sources` is `[]` and
  `origin=defaults` means no config file resolved, so that state is unreachable. A row
  for it could only pass against a mock that lies about the server.
- **No L2 (qa VM smoke) rows.** Every observable here is either a rendered-UI fact or
  pure client logic; a process/CLI smoke tier cannot assert either without violating
  the rendered-UI boundary.
- **E12 is also the fixture fix.** `KbSettings.test.tsx:92`/`:99` currently asserts the
  bootstrap note IS present for `origin: "global"`, passing only because the mock omits
  `resolvedSources`. E12 is that assertion corrected against a faithful mock, not an
  additional case.

## New infra needed

None. L1 rows extend the existing sibling suites
`packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx` and
`FolderKbSection.test.tsx`. The single L3 row copies harness glue from the existing
`tests/e2e/kb-folder-slot.spec.ts`.
