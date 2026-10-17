## 1. File format and validator (pure)

- [ ] 1.1 Write failing tests for `parseDependenciesFile(text)` in `packages/shared/src/openspec-dependencies.ts`: shorthand and long form, empty lists, 64 KiB cap, aliases rejected, wrong shape → `invalid-file`; verify `npx vitest run packages/shared/src/__tests__/openspec-dependencies.test.ts` is red
- [ ] 1.2 Implement the parser with `yaml` safe parse (`maxAliasCount: 0`); verify 1.1 green
- [ ] 1.3 Write failing tests for name resolution (active / archived `YYYY-MM-DD-<name>` / external set / unknown) and validation issues (`self-reference`, `cycle` with path via SCC, `unknown-change`, `conflicting-entry`, `duplicate-capability`); verify red, implement, verify green

## 2. Inference

- [ ] 2.1 Write failing L1 tests from real wording: `Depends on`/`Builds on` → blocked_by; `Follow-up`/`Consumers` → inverse; `Sibling`/`Out of scope (tracked under …)`/`distinct` → related; acme ↔ tailscale mutual mention yields exactly one edge; non-change backticked tokens (`pi-core-version-ui`) yield nothing; `## Dependencies` section lines take precedence; verify red
- [ ] 2.2 Implement the L1 classifier; verify 2.1 green
- [ ] 2.3 Write failing L2/L3 tests on fixture changes (ADDED-new-capability vs MODIFIED → directed edge; both ADD → `duplicate-capability`; shared MODIFIED → `overlaps` only); verify red, implement, verify green
- [ ] 2.4 Write failing merge tests: declared beats inferred, `not_blocked_by` suppresses both, edges carry `source` + `reason`, output sorted, and a byte-identical determinism check over two runs; verify red, implement, verify green

## 3. Graph, waves, poll integration

- [ ] 3.1 Write failing tests for waves (chain a→b→c, archived blocker satisfied, external blocker ≥ wave 2 flagged, cycle → `wave: null`, name tie-break) and computed `blocks`; verify red, implement, verify green
- [ ] 3.2 Add `OpenSpecChange.dependencies` to `packages/shared/src/types.ts`; compute it in `packages/server/src/openspec/openspec-poll-worker.ts` after the `status --all` build; verify worker tests green
- [ ] 3.3 Resolve `external` names on the main thread in `directory-service.ts` across known cwds sharing the git common dir (set lookup, no extra spawn); test with two cwds; verify green
- [ ] 3.4 Add `dependencies.yaml` to every change's watcher filter and gate tracked paths; test that writing it on a `spec-driven` change triggers one debounced re-poll; verify green
- [ ] 3.5 Benchmark graph + inference on this repo's 100+ changes inside the worker (target < 20 ms on macOS); record the number in design.md Context; add one debug-line field set (edges by source, issue counts)

## 4. Schema patch v2

- [ ] 4.1 Write failing tests: CURRENT_PATCH 2 inserts the `dependencies` artifact before `tasks` with the template and instruction, sets `tasks.requires` to `[specs, design, dependencies]`, `schema validate` passes, and a patch-1 stamp reports `schema-stale`; verify red, implement in `workflow-schema.ts`, verify green
- [ ] 4.2 Integration test with the real CLI in a temp repo: a new change shows `dependencies: ready`, `tasks: blocked` until `dependencies.yaml` exists; verify green (skip only when the CLI is absent)

## 5. REST

- [ ] 5.1 Write failing route tests for `GET`/`PUT /api/openspec/dependencies`: admission gates with zero fs access on rejection, `../` traversal rejected, change not in list rejected, slug validation, 64 KiB body cap, atomic write, response echoes the new computed entry after re-poll; verify red
- [ ] 5.2 Implement both routes in `packages/server/src/routes/openspec-routes.ts`; verify 5.1 green

## 6. Board UI

- [ ] 6.1 Write failing component tests for card chips (blocked-by error tone, blocks, overlaps muted, wave badge, issues badge, inferred vs declared styling, hidden when not adopted per visibility rule); verify red, implement, verify green
- [ ] 6.2 Write failing tests for the Execution-order view toggle (sort by wave then name, cycle last, drag disabled, `groups.json` untouched); verify red, implement, verify green
- [ ] 6.3 Write failing tests for the Dependencies dialog (remove declared, "Not a dependency" → `not_blocked_by`, add from active + archived picker, error surfacing, keyboard + labels); verify red, implement, verify green and `npm run build` succeeds

## 7. ship-it gate

- [ ] 7.1 Add the entry dependency gate to `.pi/skills/ship-it/SKILL.md` (REST first, file fallback; errors → `SHIP_IT_BLOCKED.md`; open blockers → ask interactively / report headless); verify with a dry-run on a fixture change that has a cycle (blocked) and one with an open blocker (warned)

## 8. Docs and closeout

- [ ] 8.1 Delegate to DocScribe: `docs/architecture.md` dependency-graph section (file format, inference layers, resolution table, waves) and a `docs/faq.md` entry "How do I declare that one change depends on another?"; verify `grep -n "dependencies.yaml" docs/`
- [ ] 8.2 Update AGENTS.md rows for every new or touched file; verify `kb dox lint` is clean for them
- [ ] 8.3 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and confirm no failures
