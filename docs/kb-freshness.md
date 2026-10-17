# kb freshness budget + cancellation

Scope: `kb_search`, `kb_get`, `kb_neighbors` (kb-extension). Reindex pass runs in background. Tools wait at most budget for it.

## Budget: `KB_FRESHNESS_BUDGET_MS`

Env var only. No config key.

- Default `1500` ms.
- Ceiling `60000`. Larger value clamps to `60000`.
- `0` = never wait. Pass still starts/continues in background.
- Value trimmed before parse.
- Strict non-negative decimal integer honoured. Anything else → default `1500`.
  - Default for: `-1`, `1500.5`, `1e3`, `1500ms`, `abc`, `+5`, `0x10`, empty.
- Resolver: `resolveFreshnessBudgetMs()` in `packages/kb-extension/src/reindex.ts`.

## Budget expiry

- Expiry abandons the wait, not the work.
- Shared in-flight pass keeps running.
- Batches (100 files) already committed stay queryable.

## Model-facing status lines

Text channel only. `details` is rendering-only, not seen by model.

| Condition | Line | Effect on result |
|---|---|---|
| Pass not finished, index has prior data | `(index refresh still running — results may be stale)` | Line prepended before results. Hits returned. |
| Index empty, no pass ever completed for cwd | `(index is still being built — no results available yet; retry shortly)` | Replaces hits / `(not found)` / node list. |
| Pass failed | stale line | Never building line. |
| Esc / AbortSignal | `(cancelled — no results retrieved)` | No hits. No throw. |

Constants: `STALE_LINE`, `BUILDING_LINE`, `CANCELLED_LINE` in `packages/kb-extension/src/reindex.ts`.

## `format:"json"` rule

- Status line (if any) on its own line.
- Then bare hits array, byte-identical to pre-change output, as final line.
- Cold index → building line + `[]`.
- Cancelled → cancelled line + `[]`.
- Not a parse contract.

## Cancellation

- `kb_search`, `kb_get`, `kb_neighbors` observe AbortSignal (Esc) at stage boundaries.
- Abort returns cancelled result. No throw.
- Shared reindex pass NOT cancelled.
- `scope:"git"` gets entry check only. No mid-request abort.

## Event-loop yield

- Walk + gitignore pre-scan yield every `WALK_YIELD_EVERY=500` entries/dirs.
- Counter spans recursion.
- Constant: `packages/kb/src/indexer.ts`.
- Known limit (R10): one huge single directory listing = one blocking call. Not split.

## Verdict rename scan

- `git diff HEAD --name-status -M -z` runs async.
- Timeout `RENAME_SCAN_TIMEOUT_MS=2000` + abort signal.
- Timeout or abort → absent subject reports `GONE` (not `MOVED`).
- Constant: `packages/kb/src/verdict.ts`. See `kb-read-discipline.md` for verdict labels.

## Indexer exclusion: `.worktrees`

- `.worktrees` added to `DEFAULT_EXCLUDE` (`packages/kb/src/indexer.ts`). Same tier as `node_modules`, `dist`.
- No opt-out. Include globs and `!` negations cannot re-admit.
- Migration: non-gitignored `.worktrees/` leaves index on next walk.
  - Move notes out of `.worktrees/`, or
  - configure the path as its own source.

## Measured (this repo, macOS)

- Warm pass ~450 ms.
- Deep tree 50k dirs, cold: 1.6 s.
- Full numbers: `openspec/changes/bound-kb-search-freshness/design.md`.

See change: bound-kb-search-freshness
