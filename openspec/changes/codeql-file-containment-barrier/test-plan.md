# Test Plan — codeql-file-containment-barrier

Stage: design   Generated: 2026-10-24

Levels: `L1` = vitest (`packages/*/src/**/__tests__/*.test.ts`, `scripts/__tests__/*.test.mjs`). The real-analysis rows (R1–R6) use the real CodeQL CLI and self-skip when `codeql` or the pinned packs are absent (CI has neither); they run on developer machines and in ship-it worktrees.

No gap: every slot filled from design D1–D7; no clarification asked. No performance scenario: the predicate is an O(1) string compare and `decidePassive` repeats today's `isAllowed`/`isGrantAdmitted` calls one-for-one.

Fixture notation: **K** = temp git repo that is a session cwd; `K/a.txt`, `K/b.txt` files; **G** = a grant covering `OUT/x.txt` outside K; **OUT** = temp dir outside every anchor.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | file-read-containment: decisions bound to the path | EP (same / different path) | L1 | automated | decision from `evaluateContainment("K/a.txt", [K])` | `containmentAllows(d, "K/a.txt")` and `containmentAllows(d, "K/b.txt")` | `true`, then `false` |
| E2 | same | BVA (spelling) | L1 | automated | decision for `K/a.txt` | `containmentAllows` with `K/a.txt/`, `K/./a.txt`, `K/A.txt`, `""` | all `false` (exact string equality only) |
| E3 | same | EP (refused) | L1 | automated | decisions refused for `OUT/x.txt` (no grant) and for a dashboard-secret path | `containmentAllows(d, <its own resolved>)` | `false`; each decision's `resolved` equals the path passed in |
| E4 | same (every return carries `resolved`) | decision table (secret / layer allow / grant allow / refusal / `allowGrant: false` refusal / quiet refusal / post-hold allow) | L1 | automated | one call per outcome of `evaluateContainment` | read `decision.resolved` | equals the first argument in all seven outcomes |
| E5 | same (operator-approved held read) | state-transition (suspend → allow → re-evaluate) | L1 | automated | `OUT/x.txt` refused, `hold` supplied, resolution `allow` and `reEvaluate` true | `evaluateContainment` then `containmentAllows(d, "OUT/x.txt")` | `d.allowed` true, `d.viaGrant` true, `d.resolved` set, predicate `true` |
| E6 | same (`decidePassive` consumes grants) | decision table (`allowGrant` × covered-by-grant × inside-anchor) | L1 | automated | G covers `OUT/x.txt`; paths `K/a.txt`, `OUT/x.txt`, `OUT/y.txt` | `decidePassive(p, [K], { allowGrant: true | false })` | inside anchor: allowed both ways; `OUT/x.txt`: allowed only with `allowGrant: true`; `OUT/y.txt`: refused; denial ledger gains 0 rows |
| E7 | same (grep filter keeps behaviour) | regression | L1 | automated | grep matches in `K/a.txt` and `OUT/x.txt` (G) and `OUT/y.txt` | `GET /api/grep` through the route | matches for `K/a.txt` and `OUT/x.txt` kept, `OUT/y.txt` filtered; response shape unchanged |
| E8 | same (mention keeps behaviour) | regression | L1 | automated | mentions of `K/a.txt`, `OUT/x.txt` (G), `OUT/y.txt` | `resolveFileMention` | first two resolve, third returns `null` |
| E9 | same (raw site order preserved) | decision table (inside anchor / artifact-root image / grant / refused) | L1 | automated | `GET /api/file/raw` for `K/a.png`, an image under an artifact root, `OUT/x.png` (G), `OUT/y.png` | route `inject` | 200 / 200 (no `evaluateContainment` call) / 200 `viaGrant` / 403 `"path outside working directory"` with the existing remedy fields |
| E10 | same (refusal bodies unchanged across migrated sites) | regression | L1 | automated | the existing file-routes and session-routes containment tests | unchanged suite | passes with no edit to expected strings or statuses |
| E11 | same (only `containment-gate.ts` makes decisions) | contract (source shape) | L1 | automated | non-test sources under `packages/server/src` and `packages/shared/src` | scan for `as PathDecision` / a decision literal with `resolved` | exactly one module (`containment-gate.ts`) contains it |
| E12 | design D3 (model row contract) | contract | L1 | automated | `.github/codeql/extensions/cwd-guard.model.yml` | existing `codeql-model-contract.test.ts` plus a row-presence assertion | `containmentAllows` rows present, dotted type single-quoted, dot-free alias present |

### Real-analysis probes (design D5)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | model recognises the guard | probe pair | L1 (real CodeQL) | automated | mini monorepo with the repo model file; handler: `evaluateContainment` → `if (!containmentAllows(d, resolved)) return` → `fs.readFile(resolved)` | `codeql-local.mjs` analysis | the guarded read is not reported |
| R2 | twins still reported | negative probes | L1 (real CodeQL) | automated | (b) unguarded twin; (c) decision for path A, sink on path B; (d) decision never branched on | same | all three reported as `js/path-injection` |
| R3 | filter shape | probe | L1 (real CodeQL) | automated | `if (containmentAllows(d, p)) return m` filter then use | same | outcome recorded: silent, or listed as expected residue in `evidence/codeql.md` (the test asserts the recorded outcome, not a hoped one) |
| R4 | cross-function shape | probe | L1 (real CodeQL) | automated | guarded `resolved` returned from a gate helper and read in another module | same | outcome recorded as above |
| R5 | raw `||` shape | probe | L1 (real CodeQL) | automated | `if (!(containmentAllows(d, p) \|\| isArtifactRoot(p))) return` then sink | same | outcome recorded as above; if reported, the raw site is residue |
| R6 | model absence is detected | regression | L1 (real CodeQL) | automated | same handler as R1, model file removed | same | the guarded read IS reported (proves R1 depends on the model) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | hold flow unchanged | state-transition (suspend → deny) | L1 | automated | refused read, operator denies | `GET /api/file` with `hold` | 403 with the existing body and remedy fields; `containmentAllows` false |
| X2 | wrong-path use fails closed | fault (refactor bug) | L1 | automated | a handler test double decides path A then calls `containmentAllows(d, B)` | call | `false`; the helper under test refuses (no read of B) |
| X3 | after-merge alert closure | procedural, live GitHub | — | manual-only | merge commit analysed on `develop` | `gh api …/code-scanning/alerts?ref=refs/heads/develop&state=open` | none of the pruned baseline keys has an open alert; residue matches `evidence/codeql.md` |

## Coverage summary

- Requirements covered: 1/1 added requirement (all scenarios) plus the model contract (D3) and probes (D5).
- Scenarios by class: edge 12 · probes 6 · error 3 · perf 0 · frontend 0.
- By disposition: automated 20 · manual-only 1.

## New infra needed

- none. R1–R6 extend `scripts/__tests__/codeql-local-real.test.mjs` and its fixture helpers.
