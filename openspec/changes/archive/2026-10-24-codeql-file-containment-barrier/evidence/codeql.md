# CodeQL before/after (tasks 1.2, 1.3, 4.3; test-plan #R1–#R6)

Tool: CodeQL CLI 2.27.2, `codeql/javascript-queries` 2.4.7, models sha256 `d93b86d7…` (+ the new `containmentAllows` rows), `npm run codeql`. "Before" = committed `codeql-baseline.json` on `origin/develop` (131 results, 0 stale at `1be485dc1`); "after" = this change, then `node scripts/codeql-local.mjs --prune`.

Result: `pass`, **0 new results**; 131 → 117 results; 14 baseline entries closed; `--check-baseline-diff origin/develop` ok.

## Probe outcomes (real analysis, mini monorepo with the repo model file)

| id | shape | outcome |
|---|---|---|
| R1 | production shape: `await evaluateContainment` → `if (!containmentAllows(d, resolved)) return` → read | silent |
| R2 (b) | unguarded twin | reported |
| R2 (c) | decision and predicate for A, sink on B | reported |
| R2 (d) | predicate result never branched on | reported |
| R3 | filter shape `if (containmentAllows(d, r)) return fs.read(r)` (grep-routes) | silent |
| R4 | guarded `resolved` returned from a gate helper, read in another module (`eml.ts`, `office-preview.ts`) | silent |
| R5 | `containmentAllows(d, p) \|\| <unmodelled admission>` then read (raw artifact-root branch) | **reported** — expected residue |
| R6 | R1 without the model file | reported (R1 depends on the model) |

Note on R2 (c): the model blesses the variable passed as `Argument[1]`; a call `containmentAllows(dA, B)` guards `B` for CodeQL and fails closed only at runtime (strict equality). The static probe therefore uses "predicate on A, sink on B".

## Closed entries (pruned)

| Rule | File | Before | After |
|---|---|---|---|
| `js/path-injection` | `packages/server/src/routes/file-routes.ts` | 15 `operator-authz` | 4 |
| `js/path-injection` | `packages/server/src/lib/resolve-file-mention.ts` | 1 | 0 |
| `js/path-injection` | `packages/server/src/lib/office-preview.ts` | 1 | 0 |
| `js/path-injection` | `packages/server/src/lib/eml.ts` | 1 (`github-dismissed` #331) | 0 |
| `js/path-injection` | `packages/server/src/access/verified-read.ts` | 1 of 3 (`github-dismissed` #330) | 2 remain |

## Residue handed to `triage-codeql-alert-debt`

- `file-routes.ts`: 4 `operator-authz` entries (sinks reached through paths the barrier does not dominate, e.g. the raw site's artifact-root branch, R5).
- `lib/writable-handler-target.ts`: 1 `github-dismissed` (does its own `realpath` containment; out of scope).
- `access/verified-read.ts`: 2 `github-dismissed` (the containment/verification guard itself).
- `browse.ts`: 6 (cwd-less folder browser, non-goal).

The two closed `github-dismissed` alerts (#330, #331) will close as fixed in GitHub's next analysis of `develop`; no dismissal is changed by this change.
