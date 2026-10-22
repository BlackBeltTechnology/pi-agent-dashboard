# CodeQL before/after (task 1.1 / 8.1, test-plan #E22)

Tool: CodeQL CLI 2.27.2, `codeql/javascript-queries` 2.4.7, models sha256 `d93b86d7…ea43` (`npm run codeql`, local ratchet). "Before" = the committed `codeql-baseline.json` (develop scan); "after" = this change, then `node scripts/codeql-local.mjs --prune`.

Result: `pass` — **0 new results**; 12 baseline entries closed.

| Rule | File | Before | After |
|---|---|---|---|
| `js/path-injection` | `packages/server/src/canvas/canvas-settings.ts` | 4 | 0 |
| `js/path-injection` | `packages/server/src/lib/grep.ts` | 3 | 0 |
| `js/path-injection` | `packages/server/src/lib/md-candidates.ts` | 1 | 0 |
| `js/path-injection` | `packages/server/src/lib/writable-md-target.ts` | 1 | 0 |
| `js/path-injection` | `packages/server/src/lib/writable-handler-target.ts` | 2 | 1 |
| `js/prototype-polluting-assignment` | `packages/server/src/pi/resource-entry-ownership.ts` | 2 (untriaged) | 0 |
| `js/path-injection` | `packages/server/src/routes/file-routes.ts` | 19 | 19 |

The two untriaged `js/prototype-polluting-assignment` alerts on `resource-entry-ownership.ts` also disappeared from the analysis (not investigated: a different rule on a file this change does not edit; the prune removed them because their count fell to 0). The ratchet only checks that the baseline does not grow.

Dismissal #463 (`writable-handler-target.ts`, justification cited the removed `file-write-binary-routes.ts sessionManager.listAll` check) left with its entry; the remaining entry (#464) does not mention the check. `--prune` printed the removal.

Residue handed to `codeql-file-containment-barrier` (path-fed sinks: `path.resolve(cwd, relPath)` → async containment, unmodelled):
- `routes/file-routes.ts` 19 (14 `operator-authz`, 5 dismissed #334–#338)
- `lib/resolve-file-mention.ts` 1, `lib/office-preview.ts` 1, `lib/eml.ts` 1, `lib/writable-handler-target.ts` 1 (#464)
- `browse.ts` 6 — the cwd-less folder browser, out of scope.

PR CodeQL analysis (same per-file drop expected): recorded at ship time in the PR.
