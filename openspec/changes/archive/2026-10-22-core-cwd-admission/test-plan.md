# Test Plan — core-cwd-admission

Stage: design   Generated: 2026-10-22

Hard gate: one clarification (auto-init ordering) was resolved with the operator before this file was written → design D7.

Fixture notation:
- **K-session**: a temp git repo that is a session cwd.
- **K-pinned**: a temp git repo that is pinned.
- **W**: a linked worktree.
- **U**: a temp dir that is not known.
- Route tests use Fastify `inject` with the known set seeded through the `host.knownFolderCwds` provider.
- Lib/op spies wrap the git-operation and openspec lib functions.
- "No raw fs call" means an `fs` spy records no call on the request value outside `admitCwd`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | core: Known session cwd admitted without git probes | EP (direct-match partition) | L1 | automated | K-session; injected git runner spy | `GET /api/git/status?cwd=<K-session>` | 200 with status data; admission runner spy: 0 git spawns |
| E2 | core: linked worktree of a pinned repo admitted (git) | EP (derived-admit partition) | L1 | automated | W of K-pinned, no session | `GET /api/git/status?cwd=<W>` | 200 with status data |
| E3 | core: siblings, main checkout, child of pinned non-repo, symlink-to-unknown refused | EP (refuse partitions) | L1 | automated | (a) only W1 is a session, ask W2; (b) only W1 is a session, ask main checkout M; (c) pinned non-repo P, ask repo `P/r`; (d) symlink inside K-pinned pointing to U | `GET /api/git/status` for each | each 400 `{code:"cwd_unknown"}` with the pin message; op spy 0 calls |
| E4 | git-operations-api: admit before validation, all 23 sites | decision table (23 routes × unknown dir) | L1 | automated | U (existing dir) | each of the 19 `validateCwd` routes + `branches`, `checkout`, `init`, `stash-pop` | every response 400 `cwd_unknown`; op spy 0 calls; no raw fs call outside the guard; after `POST /api/git/init`, `U/.git` does not exist |
| E5 | git-operations-api: cwd validation codes | BVA over cwd states | L1 | automated | (a) omitted; (b) deleted session cwd; (c) missing unknown path; (d) regular file inside K-pinned; (e) pinned non-repo dir on `head`; (f) omitted on `branches` | git request per case | (a) 400 `cwd_invalid` "cwd required"; (b) 400 `cwd_invalid` "cwd does not exist"; (c) 400 `cwd_unknown`; (d) 400 `cwd_unknown`, status ≠ 503; (e) `not_a_repo`; (f) its pre-change presence code and message, unchanged |
| E6 | core: operation on canonical cwd (git) | EP | L1 | automated | pinned symlink L → K-pinned | `GET /api/git/status?cwd=<L>` | the git-op spy receives `realpath(K-pinned)`, not L |
| E7 | core: ungated openspec routes refuse unknown cwd | decision table (8 sites) | L1 | automated | U | `openspec-archive`, `pi-resources/commands`, `tasks`, `tasks/toggle`, and caller-supplied cwd on `config` GET/POST, `update` and `pi-resources` | each 403 `{success:false, code:"cwd_unknown", error:"cwd not allowed", reason, hint}`; lib spy 0 calls |
| E8 | core: gated openspec writes keep exact membership | decision table (4 sites × refusal kind) | L1 | automated | (a) U; (b) W of K-pinned, W not itself known, on `init`; (c) `<opted-out>/sub` on dependencies GET; (d) pinned symlink → opted-out dir on `workflow-schema` | the gated route per case | (a) `workflow-schema` 400 `untracked`, dependencies GET/PUT 403 `cwd-not-tracked`, `init` 400 with the existing message; (b) `init` 400 existing message; (c) 403 `cwd-not-tracked`; (d) the existing opt-out refusal body; CLI spy 0 calls in all cases |
| E9 | core: global-config dir refused | EP | L1 | automated | (a) `HOME/.config` pinned (its `openspec/` = `GLOBAL_OPENSPEC_DIR`); (b) pinned symlink → `HOME/.config` | `POST /api/openspec/tasks/toggle` for (a); `GET /api/openspec/tasks` for (b) | both 403 `cwd_unknown`; no file written under `GLOBAL_OPENSPEC_DIR` |
| E10 | core: unfiltered known set, fallbacks, shape checks first | EP | L1 | automated | (a) pinned dir without `openspec/`; (b) no cwd; (c) `update {all:true}`; (d) relative cwd `foo` | (a) `GET /api/openspec/tasks`; (b) `GET /api/openspec/config`; (c) `POST /api/openspec/update`; (d) `GET /api/pi-resources/commands?cwd=foo` | (a) normal no-openspec result; (b) config read for `knownCwds()[0] ?? process.cwd()`; (c) iterates only `hasOpenSpecRoot` dirs and the admission spy records 0 calls; (d) existing 400, admission spy 0 calls |
| E11 | core: request path segments | BVA on segment | L1 | automated | change ∈ {`""`, `.`, `..`, `../../outside`, `a/b`, `aux`, `name.`, 256-byte name, `valid-name`, 255-byte name} | `GET /api/openspec/tasks?cwd=<K-pinned>&change=<v>` | invalid values → 400 `{code:"invalid_name"}` with lib spy 0 calls; `valid-name` and the 255-byte name reach the lib |
| E12 | design D1: openspec keys stay raw | EP | L1 | automated | pinned symlink L → K-pinned with `openspec/` | `POST /api/openspec/update {cwd:L}`; `POST /api/openspec/tasks/toggle {cwd:L}` | `setOpenSpecUpdateSignature` and `refreshOpenSpec` / `onOpenSpecChanged` are called with L (raw), not the realpath |
| E13 | worktree-lifecycle: batch memo, canonical classification, code pass-through | decision table | L1 | automated | (a) 50 items (cap), all one cwd; (b) 2 items: `K-pinned` and symlink L → K-pinned; (c) 2 items: a file path in K-pinned and U | `POST /api/git/worktree/remove-batch` | (a) admission spy called once; (b) classification spy called once; (c) item codes `cwd_unknown` (file, D6) and `cwd_unknown` (U), never hard-coded `cwd_invalid`; a known deleted cwd item reports `cwd_invalid` |
| E14 | git-operations-api MODIFIED: anchor resolved once | regression guard | L1 | automated | W of K-pinned, no session | `POST /api/git/worktree/remove {cwd:W}` | the operation's own `checkoutRoots` call count for W ≤ 1 (admission's derivation excluded) |
| E15 | core: spawned worktree admitted for auto-init | state-transition (unknown → session registered) | L1 | automated | W created via `POST /api/git/worktree` from cwd W0, where only W0 is a session; then a session registered at W | `GET /api/git/worktree/init-status?cwd=<W>` before and after registration | before: 400 `cwd_unknown`; after: 200 |
| E16 | design D0: CodeQL recognises the shipped guard shapes | guarded vs twin | L1 | automated | mini-monorepo fixtures (a) `admissionAllows` → lib sink on `cwd` and `token.canonCwd`; (b) `isPortableProjectName` → lib join sink; (c) helper returning `{cwd: canonCwd}` → caller sink; each with an unguarded twin | real CodeQL analysis (packs cached) | guarded sink lines: 0 `js/path-injection` results; every twin line: ≥ 1 result; a skipped suite counts as failure; versions + table in `evidence/codeql-probe.md` |
| E17 | proposal Goal: alerts drop | before/after diff | ci | automated | `codeql-baseline.json` + local run before/after; PR CodeQL analysis | `npm run codeql`; PR analysis | no new results; `js/path-injection` count lower on the cwd-fed files listed in `evidence/site-matrix.md`; the PR analysis shows the same per-file drop |
| E18 | client: localized codes | EP | L1 | automated | codes `cwd_unknown`, `cwd-admission-unavailable`, `invalid_name` | `resolveServerMessage({code})` | returns the `err.cwd_unknown` / `err.cwd_admission_unavailable` / `err.invalid_name` catalog text, not the raw code; `npm run i18n:parity` passes |
| E20 | core: subdirectory of a known repo admitted (openspec) | EP (derived-admit partition) | L1 | automated | `<K-session>/src` (no `openspec/` of its own) | `GET /api/openspec/tasks?cwd=<K-session>/src` | 200 or the normal no-openspec result; never 403 |
| E19 | integration: live instance | smoke | — | manual-only | the running dashboard after `/api/restart` | git status on a session cwd; on an unknown dir; openspec tasks on a pinned repo | [judgment on the live operator instance: 200 / 400 `cwd_unknown` / 200] |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D5: direct-match latency | tail-latency | L1 | automated | `GET /api/git/status` and `GET /api/openspec/tasks` on a K-session cwd; known set of 1 vs max(30, current `listAll()` size) distinct dirs; `PI_BENCH=1` | p50 ≤ +2 ms and p99 ≤ +15 ms (30-set vs 1-set) | warm-up 20, then 200 sequential requests |
| P2 | design D5: derivation path never indeterminate when healthy | threshold | L1 | automated | `GET /api/git/status` on W of K-pinned (no session), real git; `PI_BENCH=1` | 0 responses with 503 / `cwd-admission-unavailable` | 200 sequential requests |
| P3 | design D5: recorded cases | record | L1 | automated | 8 concurrent derivation-path requests; one EACCES pinned entry (`chmod 000`) plus an unknown cwd; `PI_BENCH=1` | `evidence/latency.md` has a row per case with p50/p99 and the 503 count; the EACCES case yields 503 for U and 200 for K-session | one 200-request run per case |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | worktree-lifecycle: dialog must not report removal | state-transition | L1 | automated | `CloseWorktreeDialog` for W; mocked remove → `{ok:false, code:"cwd_unknown"}` (also the vanished-sessionless case) | user confirms | the dialog stays open and shows the localized `cwd_unknown` text; `onRemoved` is not called |
| F2 | worktree-lifecycle: per-item outcome text | decision table | L1 | automated | `WorktreeList` in manage mode; mocked batch result items `cwd_unknown`, `cwd-admission-unavailable`, `cwd_invalid` | batch remove | the rows show the respective localized messages; only `cwd_invalid` reads as "already gone" |
| F3 | worktree-auto-init MODIFIED: re-probe until admitted | async convergence (fake timers) | L1 | automated | pref ON; init-status mock returns `cwd_unknown` until t=1.5 s, then `{hasHook:true, needsInit:true, trusted:true}` | `maybeAutoInitWorktreeOnSpawn(W)` | probes at 500 ms cadence; exactly 1 `POST /api/git/worktree/init` after t ≥ 1.5 s |
| F4 | worktree-auto-init MODIFIED: give up at 10 s | async convergence (fake timers) | L1 | automated | pref ON; init-status always `cwd_unknown` | `maybeAutoInitWorktreeOnSpawn(W)`; advance to 10.5 s | 0 init calls; no probe after t > 10 s; no error toast; resolves `false` |
| F5 | worktree-auto-init: pref OFF | EP | L1 | automated | pref OFF | `maybeAutoInitWorktreeOnSpawn(W)` | 0 init-status probes |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | core: indeterminate → 503 shared identifier (git) | fault-injection (abort) | L1 | automated | injected git runner fails every probe with a non-`exit` error | `GET /api/git/status?cwd=<U>` | 503, `Retry-After: 1`, body `{success:false, code:"cwd-admission-unavailable", error:"cwd-admission-unavailable", message, retryAfterMs:1000}`; op spy 0 calls |
| X2 | core: unreadable known folder | fault-injection (EACCES) | L1 | automated | injected realpath: one pinned entry → EACCES | requests for U and for K-session | U → 503 `cwd-admission-unavailable`; K-session → 200 |
| X3 | worktree-lifecycle: indeterminate item | fault-injection (abort, per item) | L1 | automated | runner fails only for item 2 of 3 | `POST /api/git/worktree/remove-batch` | HTTP 200, no `Retry-After`; item 2 `cwd-admission-unavailable`; items 1 and 3 processed |
| X4 | worktree-lifecycle: exhausted batch budget | fault-injection (delay) | L1 | automated | runner delays every derivation by 2.9 s; 6 distinct sessionless W items | `POST /api/git/worktree/remove-batch` | total admission time ≤ 10 s; undecided items `cwd-admission-unavailable`; git-op spy 0 calls for them |
| X5 | core: release after request (git) | state-transition | L1 | automated | admission token captured via the `admitOptions` seam | (a) git status success; (b) git op throws | `isAdmissionLive(token) === false` after each response |
| X7 | core: indeterminate → 503 shared identifier (openspec) | fault-injection (abort) | L1 | automated | injected git runner fails every probe | `GET /api/openspec/tasks?cwd=<U>` | 503, `Retry-After: 1`, the same body as X1; lib spy 0 calls |
| X8 | core: release after request (openspec) | state-transition | L1 | automated | token captured via the seam; openspec lib stub throws | `GET /api/openspec/tasks?cwd=<K-pinned>&change=x` | error response sent; `isAdmissionLive(token) === false` |
| X9 | core: release after request (folder-project) | state-transition | L1 | automated | token captured; (a) `run` throws; (b) client disconnects before `run` settles | `GET /api/folder/project?cwd=<K-pinned>` | `isAdmissionLive(token) === false` after the error response (a) and right after the disconnect (b) |
| X6 | design D1: folder-project 503 body unchanged | regression guard | L1 | automated | injected indeterminate admission | `GET /api/folder/project?cwd=<U>` | 503 body deep-equals the pre-change `{error:"cwd-admission-unavailable", message, retryAfterMs}` |

---

## Coverage summary

- Requirements covered:
  - `core-cwd-admission`: 8/8.
  - `git-operations-api`: ADDED 2/2, MODIFIED 4/4 (four-endpoints and create are covered via E4/E5).
  - `worktree-lifecycle`: MODIFIED 3/3.
  - `worktree-auto-init`: MODIFIED 1/1.
  - `folder-action-bar`: MODIFIED 1/1 (prose-only access-control note; covered by E4 worktree create).
- Scenarios by class: edge 20 · perf 3 · frontend 5 · error 9.
- Scenarios by level: L1 35 · ci 1 · — 1.
- Scenarios by disposition: automated 36 · manual-only 1.

## New infra needed

- None. The bench follows the existing `PI_BENCH=1` opt-in pattern (`packages/server/src/__tests__/provider-auth-fallback.bench.test.ts`). The CodeQL probe extends the existing real-analysis harness.
