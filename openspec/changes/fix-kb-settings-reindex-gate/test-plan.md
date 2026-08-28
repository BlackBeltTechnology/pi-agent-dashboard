# Test Plan — fix-kb-settings-reindex-gate

Stage: design   Generated: 2026-08-28

Clarification gate: **passed**. The one open decision (gate the new action on
`sources.length` versus on `origin`) was resolved before drafting and is recorded as
design D1. No `[NEEDS CLARIFICATION]` markers remain.

Level key: **L1** component/unit (vitest + RTL against `KbSettingsPanel`),
**L3** browser E2E (`tests/e2e/`, rendered UI vs the docker harness).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Rebuild an unchanged configuration | decision-table | L1 | automated | panel with `origin=project`, non-empty `sources[]`, pristine form | panel renders | `kb-reindex-now` is present and NOT disabled |
| E2 | Rebuild an unchanged configuration | decision-table | L1 | automated | same | activate `kb-reindex-now` | `reindexKb(cwd)` is called and no `PUT /api/kb/config` is issued |
| E3 | Rebuild regardless of origin | equivalence-partition | L1 | automated | panel with `origin=global`, non-empty `sources[]` | panel renders | `kb-reindex-now` present and enabled, alongside the bootstrap buttons |
| E4 | Rebuild regardless of origin | equivalence-partition | L1 | automated | panel with `origin=defaults`, non-empty `sources[]` | panel renders | `kb-reindex-now` present and enabled |
| E5 | Refused with a reason | boundary | L1 | automated | panel with `sources[] = []` (any origin) | panel renders | `kb-reindex-now` present, `disabled`, `title` names the define-a-source remedy |
| E6 | Refused with a reason | boundary | L1 | automated | same | — | the element is NOT absent from the DOM (guards against re-hiding) |
| E7 | Not gated on dirtiness | decision-table | L1 | automated | panel with non-empty sources, form edited (dirty) | panel renders | `kb-reindex-now` enabled AND `kb-save-reindex` enabled — both paths available |
| E8 | Not gated on dirtiness | decision-table | L1 | automated | panel with non-empty sources, pristine form | panel renders | `kb-save-reindex` disabled (unchanged behaviour) while `kb-reindex-now` is enabled |
| E9 | Existing save path unchanged | regression | L1 | automated | dirty form | activate `kb-save-reindex` | `save({...patch, reindex:true})` called, then `refetchStats()` after the existing delay |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Refused trigger is surfaced | error-guessing | L1 | automated | `reindexKb` rejects | activate `kb-reindex-now` | the panel renders the `reindexError` text |
| X2 | Refused trigger is surfaced | error-guessing | L1 | automated | same | after the rejection settles | `kb-reindex-now` is enabled again (retry is possible) |
| X3 | Poll outage does not mimic a trigger failure | error-guessing | L1 | automated | `/api/kb/stats` fails once while a job runs | poll misses once | no error is rendered and the busy state persists (inherits `MAX_POLL_MISSES`) |

### State / concurrency

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | No double-submit | state-transition | L1 | automated | enabled action | activate once | the action is disabled synchronously, before any server response (optimistic `pending`) |
| S2 | No double-submit | state-transition | L1 | automated | action already activated | activate again during the pending window | `reindexKb` was called exactly once |
| S3 | No double-submit | state-transition | L1 | automated | stats poll reports `indexing:true` | poll resolves | the action stays disabled across the pending→indexing hand-off with no enabled gap |
| S4 | Busy state settles | state-transition | L1 | automated | job completes (`indexing:false`) | poll resolves | the action re-enables |
| S5 | No wedge on a fast job | state-transition | L1 | automated | job settles before the first poll | `REINDEX_GUARD_MS` elapses | the action re-enables rather than staying permanently disabled |

### Orthogonality regression

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | Pill stays state-only | regression | L1 | automated | directory card rendering all four slot pills | card renders | archived `E1` still passes — zero focusable elements in the pill grid beyond pill roots |
| R2 | Pill stays state-only | regression | L1 | automated | same | card renders | archived `E2` still passes — no `mdiRefresh` inside a pill |
| R3 | Card placement unchanged | regression | L1 | automated | KB section at `placement="card"` | it renders | archived `F4` still passes — it registers no folder menu item |
| R4 | Glyph carries one meaning | decision-table | L1 | automated | settings footer with both actions | footer renders | `kb-save-reindex` uses `mdiRefresh`, `kb-reindex-now` uses `mdiDatabaseRefreshOutline` — no glyph appears twice |

### Frontend quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| Q1 | State does not leak between folders | state-transition | L1 | automated | panel mounted for cwd `A` with a pending reindex | navigate to cwd `B` | `kb-reindex-now` for `B` is enabled and no error from `A` is shown |
| Q2 | Reachable from the worktree card | use-case | L3 | automated | dashboard with a worktree session card showing the KB slot | activate the slot `→`, then `Reindex now` | the settings page opens for the worktree cwd and the reindex is accepted |

---

## Coverage notes

- `Q2` is the only L3 scenario and is the one that proves the user-visible complaint
  is fixed end to end: it walks the exact path the card leaves as the sole option.
- `R1`–`R3` re-run archived assertions from `move-slot-actions-to-menu` untouched.
  They are the evidence that this change is orthogonal to it rather than a partial
  revert; if any of them needs editing, the design premise is wrong.
- `S1`–`S5` and `X3` assert behaviour inherited from `useKbStats`. They are included
  because the inheritance is the design decision (D3) — a future refactor that gives
  the panel its own reindex path would silently drop all of it.
