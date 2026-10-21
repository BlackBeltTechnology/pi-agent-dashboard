> **STUB — not yet planned.** Run `plan-proposal` on this change before implementation. Depends on `codeql-model-pack-and-mirror` (its spike must prove a modelled guard closes a CI alert). `design.md` and `specs/` are cycle-2 drafts carried over from the split of `triage-codeql-alert-debt` and still contain the unresolved findings listed below.

## Why

`validateCwd` (`packages/server/src/routes/git-routes.ts:1111`) checks only that the cwd exists and is a directory. About 20 `/api/git/*` call sites therefore accept any directory on the host. Core file and openspec routes gate on ad-hoc session-membership checks that CodeQL cannot see. Together these produce most of the 71 open `js/path-injection` alerts.

## What Changes

- **Admission.** Core routes admit a caller `cwd` through the shared, modelled `admitCwd` + `admissionAllows` guard.
- **Joined paths.** Paths joined under the cwd are contained via a new modelled `admissionContains(admission, p)`.
- **Widening (accepted by the operator 2026-10-20).** File and openspec routes also admit pinned folders and worktrees / main checkouts of known repositories.
- **Tightening.** `/api/git/*` refuse unknown directories.

## Capabilities

### New Capabilities
- `core-cwd-admission`: draft in `specs/core-cwd-admission/spec.md`.

### Modified Capabilities
- TBD at planning. Candidates: `file-read-containment`, `path-anchor-grants` precedence, `plugin-cwd-admission` (file-routes verdict re-run).

## Impact

TBD at planning.

## Open findings carried from doubt-review cycles 1–2 (resolve during planning)

1. **Count `validateCwd` callers by grep.** There are about 20, not 10; the ones after `:653` include remove, remove-batch, prune, merge, push, pr, pull-requests, from-pr and diff-stat. Add tightening scenarios for the mutating ones.
2. **Status-code contract.** Every git refusal is 400 `cwd_invalid` today (`git-routes.ts:242-260`). An indeterminate → 503 result changes the client contract. Decide, and audit the client callers (`git-api.ts`, `WorktreeSpawnDialog.tsx`, `SessionCard.tsx`, `useInitStatus.ts`).
3. **Gate inventory.** `file-routes.ts` has 9 `listAll` gates (`:158, 344, 385, 480, 884, 991, 1143, 1183, 1402`), and `exists` already admits pinned dirs (`:1060-1089`). Build a per-site old→new matrix and correct the "session-only" premise.
4. **Async ripple.** `:158` `resolveScopedMdPath` is sync, and the global scope (no cwd) must stay unchanged. Making it async ripples to callers.
5. **Openspec known set.** `openspec-routes.ts` `knownCwds()` (`:246-250`) is filtered by `hasOpenSpecRoot`. Pass the full known set to admission and keep the filter as a list predicate. There is no session-membership site in `openspec-routes.ts`.
6. **Unknown-cwd verdict.** The file-route verdict (operator allow → re-run, `openspec/specs/plugin-cwd-admission/spec.md:152`) must be a carve-out from the "unknown directory refused" scenario.
7. **Precedence vs grants.** The joined-path containment rule must state precedence against path-anchor grants and layered containment (`file-routes.ts:1063-1101`, `openspec/specs/path-anchor-grants/spec.md:67`). Containment input changes when cwd widens; add a regression for a pinned cwd plus `../outside` → 403.
8. **`admissionContains` semantics.** Decide lexical vs realpath. Model only the canonical value that reaches the sink. Define Linux case-sensitivity and a TOCTOU fence (cf. `access/cwd-verdict.ts` `admitIfUnchanged`). Add a symlink-escape test.
9. **Token release.** Release the token in `finally` / `onResponse` in every route, including folder-project, whose current release is on `reply.raw` close (`:84`).
10. **Hot-path latency.** `admitCwd` realpaths every known folder plus git probes (cap 4, deadline 3000 ms). Add p99 and an indeterminate-rate budget, not only p50.
11. **Tests first.** Write tests per requirement first (TDD); "suite passes" is not verification.
