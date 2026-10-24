# Tasks — codeql-file-containment-barrier

Order: probe first (design D5), then tests red, then code. Do not edit a route before group 1 is green or its outcomes are recorded.

## 1. Real-analysis probe (the gate)

- [x] 1.1 Add the `containmentAllows` model row (plus dot-free alias) to `.github/codeql/extensions/cwd-guard.model.yml` and a stub `packages/shared/src/containment-guard.ts` exporting `containmentAllows` and the branded `PathDecision` type. Verify: `packages/shared/src/__tests__/codeql-model-contract.test.ts` passes, extended with a row-presence assertion (test-plan #E12). See `packages/shared/src/__tests__/codeql-model-contract.test.ts`.
- [x] 1.2 Probes R1, R2, R6 first. Triple: mini monorepo using the repo model file; handler `evaluateContainment` → `if (!containmentAllows(d, resolved)) return` → `fs.readFile(resolved)`, plus unguarded / wrong-path / never-branched twins and a model-less control · `codeql-local.mjs` analysis · guarded silent; the three twins and the model-less control reported (test-plan #R1, #R2, #R6). See `scripts/__tests__/codeql-local-real.test.mjs` (`#E4 the quoted .js model suppresses…`, `#E5`).
- [x] 1.3 Probes R3, R4, R5 (filter, cross-function, raw `||`). Triple: the three shapes of design D5 · analysis · the observed outcome is recorded; a reported shape is written to `evidence/codeql.md` as expected residue with its reason (test-plan #R3, #R4, #R5). If R1 fails, stop and change the predicate shape before any route edit.

## 2. Decision carries the path (tests red first)

- [x] 2.1 Test first, red before 2.2. `packages/server/src/access/__tests__/` (extend the nearest containment-gate test; see `access-denials.test.ts`). Triple: one call per outcome of `evaluateContainment` (secret refusal, layer allow, grant allow, refusal, `allowGrant: false` refusal, quiet refusal, post-hold allow) · read `decision.resolved` · equals the argument in all seven (test-plan #E4); plus the held-then-allowed case (test-plan #E5) and the held-then-denied case (test-plan #X1).
- [x] 2.2 Test first, red before 2.3, in `packages/shared/src/__tests__/containment-guard.test.ts` (new; see `packages/shared/src/__tests__/cwd-guard.test.ts` for the style). Triple: decisions for `K/a.txt`, refused decisions, the spelling variants `K/a.txt/`, `K/./a.txt`, `K/A.txt`, `""` · `containmentAllows` · true only for the same exact string (test-plan #E1, #E2, #E3, #X2).
- [x] 2.3 Implement: brand + `containmentAllows` in `packages/shared/src/containment-guard.ts`; the private `decision()` constructor in `containment-gate.ts`, every return point of `evaluateContainment` (`:238, :244, :246, :248`, the `allowGrant: false` return, the `quiet` return, `:320` and the final spread) set `resolved`. Verify: 2.1 and 2.2 green.
- [x] 2.4 Test first, red before 2.5. Source-shape contract (see `packages/shared/src/__tests__/no-electron-execpath-spawn.test.ts`). Triple: non-test sources under `packages/server/src` and `packages/shared/src` · scan for `as PathDecision`, `as unknown as PathDecision` (regex `/as\s+(unknown\s+as\s+)?PathDecision/`) or a decision literal · only `containment-gate.ts` matches (test-plan #E11). Implement as part of 2.3 if it is already green; the task is closed when the test exists and passes.

## 3. Passive decisions

- [x] 3.1 Test first, red before 3.2, in the containment-gate test. Triple: G covers `OUT/x.txt`; paths `K/a.txt`, `OUT/x.txt`, `OUT/y.txt` · `decidePassive(p, [K], { allowGrant, grantSubjects })` (grep passes the hoisted subjects) · inside anchor allowed both ways, `OUT/x.txt` allowed only with `allowGrant: true`, `OUT/y.txt` refused, 0 denial rows (test-plan #E6).
- [x] 3.2 Add `decidePassive` to `containment-gate.ts`. Verify: 3.1 green.
- [x] 3.3 Regression guards, green before and after 4.x: grep filter (see `packages/server/src/__tests__/grep.test.ts` and the route tests), mention resolution (see the existing `resolve-file-mention` test), raw site order (see the existing raw route test in `packages/server/src/__tests__/`). Triples as test-plan #E7, #E8, #E9.

## 4. Migrate the sites

- [x] 4.1 `file-routes.ts` `evaluateContainment` sites (`:393, :442, :550, :958, :1172, :1268, :1491`, including the `gateFilePath` / `gateOfficeFile` helpers) and `session-routes.ts:544`: branch on `containmentAllows(decision, resolved)`; keep one `resolved` variable per site and every refusal string and status. Verify: 3.3 and the existing file-routes / session-routes suites pass with no expected-value edit (test-plan #E10).
- [x] 4.2 Passive sites: `resolve-file-mention.ts:83`, `grep-routes.ts:77`, raw pre-check `file-routes.ts:1266` use `decidePassive` + `containmentAllows`; the raw site keeps layers ①/② → artifact-root → grant order. Verify: 3.3 green.
- [x] 4.3 Run the probes again against the migrated shapes, then `npm run codeql -- --json`. Triple: the worktree · analysis · per-file before/after in `evidence/codeql.md` (rule, file, before, after, reason for any residue). Then `node scripts/codeql-local.mjs --prune` and `--check-baseline-diff origin/develop` exits 0; removals are only keys that no longer report.

## 5. Docs and closure

- [x] 5.1 Through DocScribe (caveman style): update `docs/code-quality.md` (the barrier convention: a sync, path-bound predicate modelled as a guard) and the AGENTS rows for `containment-gate.ts`, `containment-guard.ts`, the model file and the touched route files. Verify: `node scripts/dox-byte-gate.mjs` and `node scripts/check-conventions.mjs --base origin/develop` exit 0.
- [x] 5.2 Post-merge closure check (test-plan: manual-only, #X3). Verify: on the analysed merge commit, no pruned key has an open alert; residue matches `evidence/codeql.md`; hand the residue list to `triage-codeql-alert-debt`.
