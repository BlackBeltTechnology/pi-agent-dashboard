# Local vs CI CodeQL — post-switch re-measurement (design D2 steps 0–3)

Measured 2026-10-17, one machine (macOS arm64, CodeQL CLI 2.27.2, packs cached).
Commit: `ce50677ee` (develop, post advanced-setup switch). Both causes of the
local/CI gap are isolated; every comparison below is exact key-level equality.

## Method

- Local: detached worktree at `ce50677ee`; `node scripts/codeql-local.mjs --json`
  (script from this change; analysis path unchanged from `add-local-codeql-ratchet`).
  SARIF copied from the state dir `run-<pid>/`.
- Variations re-analyse the same local database directly:
  `codeql database analyze <db> codeql/javascript-queries@2.4.7:codeql-suites/javascript-code-scanning.qls --format=sarif-latest --rerun`
  (i.e. the script's command minus `--threat-model=remote`).
- No-ignore variant: worktree-local `codeql-config.yml` with `paths-ignore: []`
  (uncommitted; the snapshot includes it), then restored.
- CI: SARIF via `gh api -H "Accept: application/sarif+json" repos/BlackBeltTechnology/pi-agent-dashboard/code-scanning/analyses/<id>`.
  - post-switch `ce50677ee`: javascript-typescript `1972336193` (124), actions `1972328095` (26), workflow run `39020559220`.
  - pre-switch default setup `d739f4bd`: javascript-typescript `1954189767` (179).
  - python (`1972328996`, 2) excluded — the local run does not cover python.
- Equality (D2 step 3): multiset of (rule, file, `primaryLocationLineHash`);
  (rule, file, start line) only for results without a line hash. Per-key counts compared.

## Results

| # | Local configuration | Local | Compared with | Local-only | CI-only |
|---|---|---|---|---|---|
| 1 | shipped: `paths-ignore` + `--threat-model=remote` | 179 | post-switch CI 150 | 29 | 0 |
| 2 | `paths-ignore` + no `--threat-model` | 150 | post-switch CI 150 | **0** | **0** |
| 3 | no `paths-ignore` + `--threat-model=remote` (js only) | 213 | pre-switch CI 179 | 34 | 0 |
| 4 | no `paths-ignore` + no `--threat-model` (js only) | 179 | pre-switch CI 179 | **0** | **0** |

Rows 2 and 4 are exact matches. The two causes are independent.

## Cause 1 — local-only 29 (client code): explicit `--threat-model=remote`

- Every local-only result has a `fetch(...)` response as its taint source
  (`packages/client/src/lib/api/fetch-json.ts:91,111`, `pi-core-api.ts:25`,
  `client-utils/src/identity/login-flow.ts:78`, `access-grants/preview-provenance.tsx:33`, …).
- Rules: `js/request-forgery` 9, `js/xss` 8, `js/client-side-unvalidated-url-redirection` 7,
  `js/resource-exhaustion` 2, `js/xml-bomb` 1, `js/unvalidated-dynamic-method-call` 1, `js/regex-injection` 1.
- Same database, flag removed → exactly those 29 (34 without ignores) disappear, nothing else changes.
- CI never passes a threat model: repo default-setup record says `threat_model: remote`,
  workflow `codeql.yml` sets none, generated `user-config.yaml` sets none. The explicit
  CLI flag selects more source kinds (fetch responses) than the action's default.

## Cause 2 — the 29 server results lost at the default→advanced switch: `paths-ignore`

- Lost: 55 (pre `1954189767` → post `1972336193`), 0 gained. 26 sit in ignored paths (expected).
- In scope 29: `js/path-injection` 23 (`automation-plugin/src/server/automation-writer.ts` 7,
  `run-store.ts` 5, `scanner.ts` 2; `team-plugin/src/server/paths.ts` 5, `records.ts` 4),
  `js/missing-rate-limiting` 5 (automation `routes.ts` 2, blackhole, hermes-memory, roles 1 each),
  `js/tainted-format-string` 1 (goal-plugin `routes.ts`).
- Their sources (pre-switch SARIF codeFlows) are the Fastify `req` in each plugin's
  `routes.ts` / `index.ts`. Those modules take `fastify: FastifyInstance` via a
  type-only import; production loads plugins dynamically, so CodeQL cannot resolve the
  parameter to a Fastify server from production code.
- The only resolvable call path is in test files that build a real `Fastify()` and call
  the registrar: `packages/automation-plugin/src/__tests__/routes-stop.test.ts:12`,
  `routes-create-action-kind.test.ts:30`, `packages/team-plugin/src/server/__tests__/harness.ts:145`.
  All match `**/__tests__/**` (shared `paths-ignore`), so with exclusions the route
  handlers are no longer recognised as sources.
- Rows 3/4: without `paths-ignore` the local run reproduces all 179 pre-switch results.
  So the loss is a property of the shared configuration (both local and CI), not of
  advanced setup itself. Source files unchanged `d739f4bd..ce50677ee`.

## Variations (D2 step 2)

| Var | Check | Finding |
|---|---|---|
| (a) | extractor file coverage: CI log `Done extracting` lines (3759) vs local DB `src.zip` filtered by `paths-ignore` (3864) | identical per extension for every repo file; local-only = 110 `.js` CodeQL externs under `/opt/homebrew`; CI-only = 5 extensionless `packages/*/bin/*` scripts (no results). `packages/client` 696/696, `client-utils` 37/37. Not a cause. |
| (b) | with / without `LGTM_INDEX_FILTERS` (`paths-ignore`) | cause 2 (rows 3/4). |
| (c) | query suite | CI `database run-queries` resolves `codeql/javascript-queries/2.4.7` code-scanning queries (Xss, RequestForgery, TaintedPath … all interpreted); local pins `javascript-code-scanning.qls` at 2.4.7. Row 2 equality → same effective suite. |
| (d) | `--threat-model` default vs `remote` | cause 1 (rows 1/2). |
| (e) | alerts/analyses API vs SARIF | API `results_count` 124 / 26 / 179 = SARIF result counts. Not a cause. |
| (f) | tool + pack versions | CLI 2.27.2 both sides; `codeql/javascript-queries@2.4.7`, `javascript-all@2.10.3`, `threat-models@1.0.59`, `actions-queries@0.6.37`, `actions-all@0.6.3`, all `+a7057b836bf29767461026718b14d20790b9085f`, identical CI/local. |
| (g) | CI auto-loads `.github/codeql/extensions/cwd-guard.model.yml`? | CI SARIFs list `generated/extension-pack@0.0.0` (pre and post); local has none. Rows 2/4 match exactly without it → no observable effect on results at this commit. |

Pre-switch controls re-run post-switch: `node_modules` (absent on both sides, equality holds),
`cwd-guard` (see g), pack shas (see f).

## Implications for the decision (D2 step 4)

- (a)-align option for cause 1: drop `--threat-model=remote` from the local analysis
  → local = CI exactly (row 2). Cost: the ratchet stops gating 29 fetch-response
  client results that CI never reports anyway.
- Cause 2 coverage is lost on both sides; restoring it needs a shared-config change
  (e.g. stop ignoring `**/__tests__/**`, or model the plugin registrar entry point via a
  data extension), each its own MODIFIED delta.

## Decision (task 3.2, 2026-10-17, user via ask_user)

- Cause 1 → **(a) align.** A follow-up change drops `--threat-model=remote` from the
  local analysis so local == CI. It needs its own MODIFIED delta of `codeql-local-ratchet`
  (local analysis arguments), plus a baseline prune for the 29 fetch-response entries
  and a dismissal re-check after its CI run. No config change lands in this change.
- Cause 2 → **restore coverage in a follow-up.** Candidates: stop ignoring `**/__tests__/**`
  (about 26 extra test-path results, shared `paths-ignore` edit) or add a data-extension model
  that marks the plugin route registrars' `fastify` parameter as a Fastify server. Each
  touches the shared configuration and is planned as its own MODIFIED delta.
- Until the follow-ups land, the gate stays as shipped. The local gate covers the 29
  fetch-response client results, which CI does not report. Neither side covers the 29 plugin-server results.
