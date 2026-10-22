> **In planning (plan-proposal).** Doubt-review cycles 1 and 2 have been reconciled. On 2026-10-22 the operator decided to split the file-family routes into `core-file-cwd-admission`, to use a new `cwd_unknown` code, to keep a single hyphenated `cwd-admission-unavailable` identifier, to accept that sibling worktrees are refused, and to keep the gated openspec write sites on exact membership (no widening there). The dependency `codeql-model-pack-and-mirror` is archived (2026-10-21).

## Why

`validateCwd` (`packages/server/src/routes/git-routes.ts:1116`) checks only that the cwd exists and is a directory, and it touches the raw request path while doing so. Its 19 `/api/git/*` call sites therefore accept any directory on the host. Openspec routes either do not gate a caller `cwd` at all or gate it with exact-string membership, which CodeQL cannot see. Together these feed most of the `js/path-injection` results booked on `git-worktree/*`, `openspec/*` and the two route files.

## What Changes

- **Admission.** Git and openspec routes admit a caller `cwd` through the shared `admitCwd` + `admissionAllows` guard, before any filesystem call on the request value. Operations run on the canonical cwd.
- **Tightening (operator 2026-10-20 / 2026-10-22).** `/api/git/*` refuse directories that are not admitted, with the new code `cwd_unknown` and a pin hint. Unknown paths no longer reveal whether they exist.
- **Openspec.**
  - Ungated sites (reads and tasks-toggle) gain the gate: 403 `cwd_unknown`, global config dir refused. They are widened to worktrees and subdirectories of known repos.
  - Gated write sites (init, workflow-schema, dependencies) run admission *and* keep exact membership, opt-out and their bodies.
- **503.** An indeterminate admission answers with the plugin wire shape `cwd-admission-unavailable` (plus `success` and `code`).
- **Path segments.** Openspec change names are checked with the existing modelled `isPortableProjectName` before a lib joins them (400 `invalid_name`). Lib-owned multi-segment containment in git stays as it is and is booked as residue.
- **Bug fix.** A regular-file cwd is refused, not indeterminate (D6, conditional on a test).
- **Probe gate.** A real-CodeQL probe gate proves these guard forms close results before any route work starts.

## Capabilities

### New Capabilities
- `core-cwd-admission`: admission, known set, gated-write exact membership, openspec refusals, 503, segment guard, and release.

### Modified Capabilities
- `git-operations-api`:
  - ADDED: admission precedes validation (`cwd_unknown`, precedence over `not_a_repo`), and the codes extend the stable sets.
  - MODIFIED: "Four worktree-lifecycle endpoints registered" (`validateCwd` admits), "Read HEAD endpoint", "Create worktree endpoint" (codes), and "Worktree operations anchor…" (admission derivation not counted).
- `worktree-auto-init`: auto-init re-probes `cwd_unknown` every 500 ms for at most 10 s (D7).
- `folder-action-bar`: access control for `POST /api/git/worktree` is the network guard **plus** cwd admission.
- `worktree-lifecycle`:
  - the remove-batch code union (`+ cwd_unknown`, `cwd-admission-unavailable`, `main_checkout_unresolved`), sequential admission and a 10 s batch budget;
  - "removal reachable without a session" now requires an *admitted* cwd;
  - gone rows: `cwd_unknown` for unknown paths.

## Impact

- **Server.**
  - `packages/shared/src/cwd-guard.ts`: non-directory → refuse, only if the D6 test fails.
  - New `packages/server/src/lib/route-admission.ts`.
  - `routes/git-routes.ts`: `validateCwd` becomes async; 19 sites; `remove-batch` admits sequentially.
  - `routes/openspec-routes.ts`: 12 caller-`cwd` sites, including `depGates`.
  - `routes/folder-project-routes.ts`: release moves into a `finally`.
- **Model.** Unchanged. The real-analysis harness gains D0 probe fixtures.
- **Client.**
  - `lib/i18n-en-source.json`: `err.cwd_unknown`, `err.cwd_admission_unavailable`, `err.invalid_name`.
  - `CloseWorktreeDialog` / `ManageWorktreesDialog` must not read `cwd_unknown` as "already gone".
- **Wire contract.** New 400 `cwd_unknown` and 503 `cwd-admission-unavailable` on git and openspec routes. New 403 `cwd_unknown` and 400 `invalid_name` on previously ungated openspec routes. MCP server-plugin tools that wrap these routes surface the new errors.
- **Out of scope.**
  - File-family routes → `core-file-cwd-admission` (stub, blocked by this change).
  - Residue → `triage-codeql-alert-debt`.

## Findings from doubt-review → resolution

Cycles 1–2 (pre-split):

1. 19 `validateCwd` callers → design Context.
2. Status codes → D3 and D4.
3. Gate inventory → design Context (openspec table). The file inventory moved to `core-file-cwd-admission`.
4. Async ripple → `validateCwd` and `depGates` become async. The file ripple moved.
5. Openspec known set → unfiltered, per the requirement.
6. Verdict carve-out → moved with the file routes.
7. Containment precedence → D2 scope: only sites with no containment today.
8. Containment semantics → superseded in cycle 2. D2 uses the modelled segment guard, because libs re-join raw inputs.
9. Release → D1 `finally`, including folder-project.
10. Latency → D5, gated.
11. Superseded wrapper/mirror → dropped.
12. TDD → tasks.

Cycle 3 (this planning, review 1):

- Raw-path `stat` before the guard → admit first (D1).
- `cwd_invalid` read as "already gone" → `cwd_unknown`.
- Two 503 spellings → one identifier (D3).
- Openspec gated sites → keep their bodies (D4).
- Spike overstated → D0 probe gate.
- Batch concurrency → sequential + memo.
- Bench covered only the cheap path → D5 extra cases.
- Unreadable known folder → D3 + scenario.
- `admitCwd` semantics → spec reworded (subdirs admitted, siblings refused).
- Missing deltas → `git-operations-api`, `worktree-lifecycle`; file-family deltas moved.

Cycle 4 (this planning, review 2):

- A route-side join check can't sanitize lib re-joins → D2 segment guard; `admissionContains` dropped.
- D0 twins were vacuous → sinks in a separate lib module; the stub returns a token; a skipped run fails.
- Opt-out bypass and global-config dir → gated write sites keep exact membership (operator).
- Existence oracle overstated → narrowed in Risks.
- File cwd → 503 → D6.
- Vanished sessionless worktree → accepted, with a scenario.
- Pinned non-repo parent → scenario + Risks.
- Main-spec contradictions → `git-operations-api` MODIFIED deltas.
- Raw vs canonical keys → openspec keeps raw guarded `cwd`.
- Batch latency → 10 s budget.
- 403 without a code → `cwd_unknown`.
- Tasks: enumerate all 19 sites; spies exempt the guard; i18n catalog target.

## Discipline Skills

- `security-hardening`: caller-supplied `cwd` and joined paths on git and openspec routes; the tightening; removing the existence oracle.
- `doubt-driven-review`: wire-contract and tightening decisions before they stand.
- `performance-optimization`: async admission on `/api/git/status` and openspec reads (D5).
- `systematic-debugging`: if the D0 probe gate fails.
- `review-code`: before commit.
