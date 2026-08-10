# Test Plan — fold-oversized-agents-directories

Stage: design   Generated: 2026-07-17

Falsify-first scenario catalog. The genuinely-new automatable behavior is the
`dox.ts` lint change (inline-row count + byte/row severity split); the foldering
increments are behavior-preserving and are covered by regression + structural
lint assertions. No performance or rendered-UI surface in this change.

L1 exemplar: `packages/kb/src/__tests__/kb.test.ts` (existing `kb dox lint` cases)
· `packages/kb/src/__tests__/migrate-file-index.test.ts`.
L2 exemplar: `qa/tests/02-server-start.sh`.
String-ref regression exemplar: `packages/shared/src/__tests__/no-managed-dir-reference.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Req1 inline count | BVA | L1 | automated | fixture `AGENTS.md` under `# DOX` with exactly 40 inline rows, byte size < 30000 | run `countInlineRows` / `doxLint` | no `over-threshold` issue (inline count 40 == cap, not `>`) |
| E2 | Req1 inline count | BVA | L1 | automated | fixture with 41 inline rows, < 30000 bytes | `doxLint` | one `over-threshold` issue, `arm:"rows"`, reported count 41 |
| E3 | Req1 inline count | BVA | L1 | automated | fixture with 45 total rows where 6 carry `→ see \`X.AGENTS.md\`` (39 inline), < 30000 bytes | `doxLint` | NO `over-threshold` row-arm issue (promoted pointers excluded from count) |
| E4 | Req1 regex precision | EP (valid/invalid) | L1 | automated | fixture: row A purpose `… → see \`Foo.AGENTS.md\`` (true pointer) + row B purpose `documents the Foo.AGENTS.md sidecar` (prose mention, no `→ see`) | `countInlineRows` | row A excluded, row B counted inline — detection matches only `/→ see \`[^\`]+\.AGENTS\.md\`/`, no false-positive on prose |
| E5 | Req2 severity | decision-table (byte×row cell 1) | L1 | automated | fixture inline ≤40 AND bytes <30000 | `doxLint` | no `over-threshold` issue at all |
| E6 | Req2 severity | decision-table (cell 2) | L1 | automated | fixture bytes >30000 AND inline ≤40 | `doxLint` | exactly one `over-threshold`, `arm:"bytes"`, detail names sidecar-split remedy (actionable) |
| E7 | Req2 severity | decision-table (cell 3) | L1 | automated | fixture inline >40 AND bytes <30000 | `doxLint` | exactly one `over-threshold`, `arm:"rows"`, detail marked informational (advisory) |
| E8 | Req2 severity | decision-table (cell 4) | L1 | automated | fixture inline >40 AND bytes >30000 | `doxLint` | two `over-threshold` issues for the file: one `arm:"bytes"`, one `arm:"rows"` |
| E9 | Req1 missing-check preservation | state (invariant) | L1 | automated | fixture where file `Foo.tsx`'s ONLY row is a sidecar-pointer row (`→ see \`Foo.tsx.AGENTS.md\``) and `Foo.tsx` exists on disk | `doxLint` + `parseRowPaths` | NO `missing` raised for `Foo.tsx`; `parseRowPaths` return array still includes `Foo.tsx` (inline exclusion applies to count only, not path collection) |
| E10 | Req5 marginal | EP | L1 | automated | real `hooks/`,`extension/src/`,`shared/src/`,`tests/e2e/` `AGENTS.md` after all folds, each < 30000 bytes | `doxLint` on repo | each reports `arm:"rows"` informational OR no `over-threshold` (if inline ≤40); NONE reports `arm:"bytes"`; no source files in them were moved |

### Error-handling / structural

| id | requirement | technique | level | disposition | fault / input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------------|---------|---------------------|
| X1 | Req3 rollup decomposition | state-transition (structural) | L1 | automated | fixture tree: parent `AGENTS.md` carries rows for files under `sub/` which has NO `AGENTS.md` (qa-like rollup) | scaffold `sub/AGENTS.md`, move the `sub/*` rows down, re-run `doxLint` | no `missing`/`orphan`/`broken-pointer` for the moved files; parent inline count == root-only file count; moved rows retain purpose + `See change:` verbatim |
| X2 | Req4 fold idempotency | state (invariant) | L1 | automated | post-fold tree: `SessionCard.tsx` moved to `session/`, documented in `session/AGENTS.md`, row removed from `components/AGENTS.md` | run `kb dox init` again | ZERO new rows added for `SessionCard.tsx` (owned by `session/AGENTS.md`; not re-homed to parent) — `doxInit` `ensure()` keys on path, no double-add |
| X3 | Req4 string-ref update | fault-injection (missed reference) | L1 | automated | move a source file named as a string in a `no-*.test.ts` allowlist (e.g. `packages/server/src/<file>.ts`) WITHOUT updating the string | run `npm test` (shared package) | the allowlist test FAILS on the now-missing path — proves string-literal refs are load-bearing and `tsc` alone is insufficient (gates task 4.3/5.3/6.3) |

### Regression (behavior-preservation)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X4 | Req4 components fold | regression + structural | L1 | automated | `components/` fold increment complete (files absorbed into existing subfolders where they fit, else new non-colliding subfolder) | `tsc --noEmit` + `npm test` + `npm run build`; `doxLint` on `components/` subtree | all green; `components/AGENTS.md` inline ≤40; each new/affected subfolder `AGENTS.md` inline ≤40 (or a >40 domain nested a further level / documented accepted-informational) |
| X5 | Req4 server/src fold | regression + process | L2 | automated | `server/src/` fold increment complete | `tsc --noEmit` + `npm test`; start dashboard | all green; server boots, `GET /api/health` returns 200; `server/src/AGENTS.md` + subfolders inline ≤40 |
| X6 | Req4 lib fold | regression + structural | L1 | automated | `lib/` fold increment complete | `tsc --noEmit` + `npm test` + `npm run build`; `doxLint` on `lib/` subtree | all green; `lib/AGENTS.md` + subfolders inline ≤40; every repo-wide importer of `lib/*` resolves |

### Manual-only

| id | requirement | technique | level | disposition | surface | human check | observable |
|----|-------------|-----------|-------|-------------|---------|-------------|------------|
| M1 | Req4 grouping cohesion | subjective review | — | manual-only | the new subfolder taxonomy per increment | reviewer confirms each new subfolder is a **cohesive domain**, not an arbitrary ≤40 bucket | [judgment: "grouping is sensible" — no automatable observable; row-count ≤40 is the automatable proxy, cohesion is not] |

---

## Coverage summary

- Requirements covered: 5/5 (Req1 inline count, Req2 severity split, Req3 rollup, Req4 fold, Req5 marginal).
- Scenarios by class: edge 10 · perf 0 · frontend 0 · error/structural 3 · regression 3 · manual 1.
- Scenarios by level: L1 12 · L2 1 · L3 0 · manual —(1).
- Scenarios by disposition: automated 16 · manual-only 1.

## New infra needed

- none. L1 extends `packages/kb/src/__tests__` (existing dox cases); L2 reuses `qa/tests/02-server-start.sh`; X3 extends an existing `no-*.test.ts`.
