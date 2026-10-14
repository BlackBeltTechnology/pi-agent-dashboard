# Local vs GitHub CodeQL results (task 3.1, test-plan #M5)

Commit `d739f4bdce4ff624f15e7eccf101e7a7b5ab8692` = `origin/develop` = commit of the
latest GitHub `develop` analyses (`javascript-typescript` 179 results, `actions` 26,
`python` 2; CLI 2.27.2; packs `codeql/javascript-queries@2.4.7+a7057b83…`,
`codeql/actions-queries@0.6.37+a7057b83…` — **identical to the local pins**, same pack sha).

Local: `node scripts/codeql-local.mjs --write-baseline` on a clean detached worktree of that
commit (config copied in), CLI 2.27.2, ~90 s wall clock (5m52s CPU, 8 threads), network on.
Compared the SARIF of the two GitHub analyses (python excluded — not analyzed locally)
with the local run, keyed by (rule, file, start line) — also identical by (rule, file,
primaryLocationLineHash).

| | count |
|---|---|
| GitHub results, javascript-typescript + actions | 205 |
| of which in paths the shared config ignores (tests / e2e / mockups) | 26 |
| GitHub results in scope | 179 |
| local results | 179 (153 JS/TS + 26 actions) |
| matched | 150 |
| local-only | 29 (16.2 % of 179) |
| GitHub-only | 29 (16.2 % of 179) |

Unmatched share is far above the 5 % gate. The counts are equal; the SETS differ:

- **GitHub-only (29)** — all in plugin server code: `js/path-injection` ×23
  (`packages/automation-plugin/src/server/{automation-writer,scanner,run-store}.ts`,
  `packages/team-plugin/src/server/{paths,records,projects}.ts`,
  `packages/kb-plugin/src/server/kb-routes.ts`), `js/missing-rate-limiting` ×5,
  `js/tainted-format-string` ×1.
- **Local-only (29)** — client / spike code: `js/xss` ×8, `js/request-forgery` ×9,
  `js/client-side-unvalidated-url-redirection` ×7, `js/resource-exhaustion` ×2,
  `js/xml-bomb`, `js/unvalidated-dynamic-method-call`, `js/regex-injection` ×1 each.

Ruled out as the cause (local experiments, same commit):

| hypothesis | experiment | result |
|---|---|---|
| dependencies not installed locally | symlinked the repo's `node_modules` into the source root | 153 JS results, unchanged |
| `.github/codeql/extensions/cwd-guard.model.yml` applied by GitHub only | built a model pack from it and analysed with `--model-packs` | 153 results, `js/path-injection` 100, unchanged |
| different query-pack content | compared pack versions + sha in both SARIFs | identical |

Cause remains unknown (same finding as the earlier spike at `aa451c6e9`).

## Consequence for the baseline

The ratchet compares local results with a LOCAL baseline, so the disagreement does not
affect the gate itself; it affects (a) the `github-dismissed` join of D9 (a dismissal can
only be cited for a key both sides report) and (b) how much the PR's GitHub analysis can
differ from the local verdict. Decision recorded in the change thread (see tasks 3.1/3.2).
