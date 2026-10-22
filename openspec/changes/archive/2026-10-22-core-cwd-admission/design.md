# Design

## Context

See proposal.md (Why). Constraints, with citations:

- **Shared guard** (`packages/shared/src/cwd-guard.ts`):
  - `admitCwd(cwd, known, opts)` (`:405`) returns `admit {token {canonCwd, rawCwd}}` | `refuse` | `indeterminate`.
  - `decideAdmission` (`:446-477`):
    1. realpath;
    2. `.git` segment → refuse;
    3. canonical cwd ∈ canonical known set → admit (a **missing** known entry matches lexically, `:379-393`);
    4. a missing unknown cwd → refuse with no git;
    5. otherwise derive the main checkout (`deriveOnce` `:335-358`): admit iff the cwd's main checkout is known.
  - Consequences:
    - Subdirectories and linked worktrees of a known main checkout are admitted.
    - A session inside linked worktree W does **not** admit the main checkout or sibling worktrees.
    - A known entry that fails realpath for any reason other than ENOENT makes a non-match `indeterminate` (`:394`, `:476`).
  - Budgets: cap 4 concurrent derivations, probe 1000 ms, deadline 3000 ms, no cross-request cache.
  - `admissionAllows` (`:187`), `releaseAdmission` (`:167`).
- **CodeQL evidence** (`archive/2026-10-21-codeql-model-pack-and-mirror/evidence/spike.md:23-55`):
  - The fixed model suppresses `isAllowedCwd`- and `isPortableProjectName`-guarded sinks, with local/CI parity PASS.
  - The `admissionAllows`-guarded probe sink was already silent on the control. The spike calls that cell "not informative" and native guard handling "a hypothesis, not verified".
  - That probe's sink consumed the raw guarded value. No probe covered a `token.canonCwd` sink, a `path.resolve(cwd, input)` sink, or `admissionContains`.
- **Lib joins.** Libs build paths from the raw `cwd` and request segments themselves:
  - `openspec-tasks.ts:102` builds `path.join(cwd, "openspec", "changes", change, "tasks.md")`.
  - `orphanCleanup` (`git-operations.ts:1696-1780`) and `assertPathsInside` (`:237-241`) contain their own inputs.

  A route-side join check therefore cannot sanitize what reaches a lib sink. Only a guard on the *input value itself* can.
- **Modelled segment guard:** `isPortableProjectName(name)` (`shared/src/project-name.ts:40`; model `Member[isPortableProjectName].Argument[0]`, spike-proven) admits a single portable path segment.
- **Git spawn on a file cwd:** `checkoutRootsClassifiedAsync` (`platform/git.ts:981-1027`) treats every non-`exit` probe error as `failed`. A cwd that is a regular file may therefore come back `indeterminate`, not `refuse` (unverified; task 1.3).
- **Real-analysis harness:** `scripts/__tests__/codeql-local-real.test.mjs` (#E4/#E5 guarded vs unguarded-twin fixtures; opt-in when packs are cached). Pitfall: a guard body of the form `known().includes(cwd)` is itself a native sanitizer, so fixtures use opaque bodies.
- **Plugin precedent** (`folder-project-routes.ts:65-84`; specs `folder-project-identity:100`, `plugin-cwd-admission:10`):
  - indeterminate → `503` + `Retry-After: 1`, body `{error:"cwd-admission-unavailable", message, retryAfterMs}`;
  - refuse → 403;
  - release on `reply.raw` close.
- **Git routes** (`git-routes.ts`):
  - `validateCwd` (`:1116-1135`) calls `safeRealpathSync(raw)` + `fs.statSync` on the **raw** request value. All failures are 400 `cwd_invalid` (`cwd required` / `cwd does not exist` / `cwd is not a directory`).
  - 19 call sites: `:242, 263, 288, 329, 375, 396, 421, 495, 601, 658, 729, 814, 856, 875, 911, 943, 991, 1025, 1067`.
  - `remove-batch` (`:800-852`) maps items synchronously and answers 200 with per-item codes. Its classification memo is keyed by the validated cwd. The per-item failure code is hard-coded to `cwd_invalid` (`:815`).
  - **4 more routes take a raw `cwd` without `validateCwd`:** `/api/git/branches` `:174` (`listBranches`), `/api/git/checkout` `:195`, `/api/git/init` `:217` (`gitInit`, which writes) and `/api/git/stash-pop` `:1091`. Each keeps its own presence codes. That makes **23 git sites** in total.
- **Known-set provider:** plugin routes already admit against `host.knownFolderCwds` (`server.ts:1592-1597`: `sessionManager.listAll()` cwds ∪ pinned dirs).
- **Git clients** read `json.code` and resolve text through `errKeyForCode` → `err.<code>` in `packages/client/src/lib/i18n-en-source.json` (`server-error.ts:26-45`):
  - `CloseWorktreeDialog.tsx:66-70` and `ManageWorktreesDialog.tsx:278-279` read `cwd_invalid` as "already gone".
- **Openspec routes** (`openspec-routes.ts`) have 12 caller-`cwd` sites:

  | Site | Today |
  |---|---|
  | `GET`/`POST /api/openspec/config` `:162/:279` | cwd optional; fallback `knownCwds()[0] ?? process.cwd()` |
  | `POST /api/openspec/update` `:324` | `body.cwd`, or `all` → `knownCwds()` |
  | `POST /api/openspec/workflow-schema` `:448` | gated: 400 `untracked`, `:472` |
  | `GET`/`PUT /api/openspec/dependencies` `:570/:645` | gated via `depGates`: 403 `cwd-not-tracked`, `:538` |
  | `POST /api/openspec/init` `:698` | gated: 400 `cwd is not a known session or pinned directory`, `:707-709` |
  | `GET /api/openspec-archive` `:862` | ungated |
  | `GET /api/pi-resources` `:877` | cwd optional; fallback `process.cwd()` |
  | `GET /api/pi-resources/commands` `:920` | ungated |
  | `GET /api/openspec/tasks` `:991` | ungated |
  | `POST /api/openspec/tasks/toggle` `:1015` | ungated |

  - The gated sites use `knownInitTargets()` (`:360-365`: sessions ∪ pinned, excluding the dir whose `openspec/` is `GLOBAL_OPENSPEC_DIR`) with exact string membership.
  - `workflow-schema` (`:476-480`) and `depGates` (`:540-545`) also refuse `optOutDirectories` by exact `pathKey(cwd)`.
  - Dependencies validate `change` with the unmodelled `KEBAB_ID_REGEX` (`:575, 602, 608, 618`).
  - `knownCwds()` (`:255`) is filtered by `hasOpenSpecRoot`.
  - `GET /api/pi-resource-file` `:949` takes no `cwd` (a path allowlist) and is out of scope.
  - The MCP server plugin exposes these routes as agent tools (`mcp-server-plugin/src/server/generated/tools.ts:81-85,153,161`). New refusals surface there as tool errors.
- **Anchor requirement** (`git-operations-api` "Worktree operations anchor at the resolved main checkout"): main-checkout resolution happens at most once per distinct `cwd` per request.
- **Alert distribution** (`codeql-baseline.json`, `js/path-injection`): most entries sit in lib modules fed by these routes. Examples: `git-worktree/git-operations.ts` 13 (+ 8 dismissed), `worktree-init.ts` 4, `openspec-tasks.ts` 5, `openspec-archive.ts` 4, `dependencies-file.ts` 2, `workflow-schema.ts` 1, `routes/git-routes.ts` 3, `routes/openspec-routes.ts` 1.

## Goals / Non-Goals

**Goals**
- Close the `js/path-injection` results fed by git and openspec routes with guards CodeQL verifiably recognises.
- Git and openspec routes share the plugin routes' admission semantics and 503 identifier.

**Non-Goals**
- File-family routes. Split out to `core-file-cwd-admission` (operator decision 2026-10-22).
- Widening the gated openspec write sites (`init`, `workflow-schema`, dependencies). Operator decision 2026-10-22: they keep exact membership.
- Triage, dismissal and mirroring (owned by `triage-codeql-alert-debt`).
- Lib-module signature changes.
- The openspec no-`cwd` fallbacks.
- `GET /api/pi-resource-file`.
- A new path-containment guard. Lib-owned containment checks (`orphanCleanup`, `assertPathsInside`) stay as they are and are booked as residue.

## Decisions

### D0 — CodeQL probe gate before route work
Extend `scripts/__tests__/codeql-local-real.test.mjs` with fixtures in a mini-monorepo. Guard bodies are opaque. The fixture's `admitCwd` returns a token that carries its argument. **Every sink sits in a separate lib module.**

- **(a) Route shape.** Raw `cwd` → `await admitCwd(cwd)` → `if (!admissionAllows(adm, cwd)) return` → a lib sink on `cwd`, and a lib sink on `adm.token.canonCwd`. The twin calls the same lib sink with the raw `cwd` without `admissionAllows`.
- **(b) Segment shape.** Request `change` → `if (!isPortableProjectName(change)) return` → a lib sink on `path.join(guardedCwd, "openspec", "changes", change, "tasks.md")`. The twin is the same join without the segment guard.

- **(c) Helper shape (as shipped).** The guard runs inside a helper (like `validateCwd` / `depGates`) that returns `{ ok, cwd: token.canonCwd }`. The sink is in the caller on the returned value. Admission goes through a wrapper like `admitRouteCwd`. The twin is the same caller without the helper.

**Gate:** guarded sinks report nothing and every twin is reported.
- **Named fallback if (c) reports:** every site branches inline on `admissionAllows(adm, rawCwd)`, and sinks use the guarded raw value, plus a git-side `realpath` of that value. No new model row.
- Results are recorded in `evidence/codeql-probe.md`: CLI and pack versions, plus the per-line result table.
- A skipped run (packs not cached) fails the task; it is not a pass.
- CI parity for these shapes is confirmed on the PR's CodeQL analysis (task 6.2).

**On a failure:** run `systematic-debugging` and re-plan before group 2.

### D1 — Admission at the route boundary, guard visible in the route
```ts
const admission = await admitRouteCwd(cwd)          // admitCwd(cwd, knownAll, opts) + onIndeterminate log
if (admission.kind === "indeterminate") → 503 (D3)
if (!admissionAllows(admission, cwd)) → refusal (D4)
try { …operation… } finally { releaseAdmission(admission.token) }
```

- **Same variable.** `cwd` is the **unmodified request value**, the same variable passed to `admitRouteCwd`. `admissionAllows` compares strings exactly (`tokenAllows`, `cwd-guard.ts:178-181`), so a normalized or decoded variant would refuse.
- **Branch placement.** The branch sits in the handler or in the one function that already validates (`validateCwd`, `depGates`). It is never inside a callback-taking wrapper.
- **`admitRouteCwd`** (`packages/server/src/lib/route-admission.ts`) reuses the **same** known-set provider as plugin routes (`host.knownFolderCwds`, extracted to one exported function; no third copy). It also owns the `admitOptions` seam and reuses the existing throttled indeterminate logger.
- **Shape checks first.** Existing presence, type and absolute-path checks (e.g. `pi-resources/commands` `:924-927`) stay *before* admission, so a relative cwd is never resolved against the server's `process.cwd()`.
- **Git sinks consume `token.canonCwd`.** Git already ran on the realpath, so behaviour is unchanged and a later swap of the raw path cannot redirect the operation.
- **Openspec sinks and keys keep the guarded raw `cwd`.** Signatures, broadcasts and opt-out keys are stored raw (`:343`, `:1035-1037`), and the guard sanitizes the variable itself.
- **Git `validateCwd`** becomes async, in this order:
  1. `cwd required` (unchanged);
  2. `admitRouteCwd(raw)`, with no filesystem call on the raw value outside the guard;
  3. indeterminate → 503;
  4. refuse → 400 `cwd_unknown`;
  5. `fs.stat(token.canonCwd)` → `cwd does not exist` / `cwd is not a directory` as `cwd_invalid`, unchanged;
  6. return `{ ok, cwd: canonCwd, admission }`.

  All 19 callers, plus the 4 unvalidated routes (`branches`, `checkout`, `init`, `stash-pop`, which keep their own presence codes), branch and release in `finally`.
- **`remove-batch`:**
  - Items are admitted **sequentially**, memoized per distinct raw cwd (`tokenAllows` needs the exact string), under a **whole-batch admission budget of 10 s**. Each admission gets `deadlineMs = min(3000, remaining)`, so the budget is never overshot.
  - The budget covers admission only; removal stays synchronous, as today.
  - Items not decided within the budget report `cwd-admission-unavailable`. A direct-match item is still decided, because it needs no derivation.
  - The classification memo is keyed by `token.canonCwd`, so two spellings of one directory resolve once.
  - Each item reports the actual `validateCwd` code (`cwd_unknown` / `cwd_invalid` / `cwd-admission-unavailable`), not a hard-coded `cwd_invalid`.
  - Tokens are released in one `finally`. The envelope stays 200 with no `Retry-After`.
- **Main-checkout resolution count.** Admission's derivation (`deriveOnce`) is a guard probe, not the operation's anchor resolution. The `git-operations-api` anchor requirement is amended to say so (MODIFIED delta). Threading admission's derived main checkout into the operation is out of scope, because `admitCwd` does not expose it.
- **Openspec, gated write sites** (`init`, `workflow-schema`, dependencies GET/PUT): admission runs (it is the modelled guard) **and** the existing exact `knownInitTargets().includes(cwd)` and opt-out checks stay. There is no widening. The opt-out and global-dir checks additionally compare `token.canonCwd`, so a symlink spelling cannot slip past a raw `pathKey` match.
- **Openspec, ungated sites** (`config` GET/POST with a caller cwd, `update` with `cwd`, `openspec-archive`, `pi-resources` with a caller cwd, `pi-resources/commands`, `tasks`, `tasks/toggle`): admission only, which widens them. A cwd whose canonical `openspec/` equals the realpath of `GLOBAL_OPENSPEC_DIR` (or whose raw form matches lexically) is refused with the D4 body. Server-chosen fallbacks and `update {all}` stay unchanged.
- **Folder-project:** adds a `finally` release and keeps the `reply.raw` close listener (release is idempotent), so a disconnect still ends the token early. Its 503 body stays unchanged (`{error, message, retryAfterMs}`, no `code`); its clients read `error`. This is a documented exception to D3.
- **Tightening (operator 2026-10-20 / 2026-10-22).** Git routes refuse what `admitCwd` refuses, including:
  - a repo known only through a session in a sibling linked worktree;
  - the main checkout when only a linked worktree is known;
  - child repos of a pinned non-repo parent folder, unless pinned or session-backed.

### D2 — Request path segments: modelled single-segment guard
A request value that a lib joins under the cwd as one path segment (an openspec change name) is checked at the route with `isPortableProjectName(value)` before the lib call. A miss answers `400 { success: false, code: "invalid_name" }` with no read or write.

- This is the existing modelled, spike-proven guard; no new predicate or model row is needed.
- Where `KEBAB_ID_REGEX` already applies (dependencies), it stays, and the modelled guard is added next to it.
- Multi-segment git `path` inputs (`orphan-cleanup`, `from-pr`, commit `files[]`) keep their lib-owned containment. They are listed in `evidence/site-matrix.md` as residue candidates.
- The `workflow-schema` `changes[]` / `pinTo` / `previousDefault` inputs (lib joins at `workflow-schema.ts:732,796`) keep their existing validation (`validateSchemaName`) and the gated-site body. They are booked as residue.
- `isPortableProjectName` also refuses Windows-reserved names (`aux`, `con`, …), trailing dots and edge whitespace. Change names of that form become unreadable on `tasks` / `toggle`. This is accepted and goes in the CHANGELOG.
- Task 1.1's matrix lists every path-like input with its owner.

### D3 — Indeterminate → 503 with the plugin identifier (operator decision 2026-10-22)
- **Body.** `503`, `Retry-After: 1`, `{ success: false, code: "cwd-admission-unavailable", error: "cwd-admission-unavailable", message: "cwd admission could not be decided right now", retryAfterMs: 1000 }`.
  - This is the plugin body plus `success` and `code`.
  - Unlike git-route convention, `error` carries the identifier. Clients resolve text by `code` through `err.cwd_admission_unavailable`.
- **Batch.** A `remove-batch` item reports `code: "cwd-admission-unavailable"`.
- **Client.** No automatic retry.
- **Unreadable known folder.** A known entry that fails realpath with EACCES/ELOOP turns every non-matching request into 503 until it is fixed. A request that matches a resolvable known entry is still admitted with no git probe. The indeterminate log names the failed probe.

### D4 — Refusal bodies; `cwd_unknown` is the core "not admitted" code
- **Git:** 400 `{ success: false, code: "cwd_unknown", error: "cwd is not a known folder; pin the repository to allow git operations" }`. `cwd_invalid` keeps `cwd required`, and `cwd does not exist` / `cwd is not a directory` for admitted cwds only.
- **Openspec, gated sites:** today's status and body, unchanged.
- **Openspec, ungated sites:** 403 `{ success: false, code: "cwd_unknown", error: "cwd not allowed", reason: "cwd is not a known session or pinned directory.", hint: "Pin this directory to allow it, or open a session rooted in it." }`.

### D5 — Latency budget (operator decision 2026-10-22)
An opt-in, pre-merge bench (not part of CI) on `GET /api/git/status` and `GET /api/openspec/tasks`, with 1 vs 30 known folders, warm-up 20, 200 requests, same host.

- **Gate (direct match, the hot path):** at max(30, current `listAll()` size) known folders, p50 ≤ +2 ms and p99 ≤ +15 ms.
- **Gate (derivation path):** 0 `indeterminate` over 200 requests on a sessionless worktree of a pinned repo in a healthy environment.
- **Recorded:**
  - derivation-path latency, bounded only by the 3000 ms deadline;
  - 8 concurrent requests;
  - one EACCES known entry.
- **On a miss:** run `performance-optimization` before any cache. A cache must stay request-scoped.

### D6 — A non-directory cwd is refused, not indeterminate
Task 1.3 tests `admitCwd` on a regular file inside a known repository.

- If it yields `indeterminate`, `decideAdmission` gains a guard-local `stat` of the canonical cwd before derivation: non-directory → `refuse`, with no git spawn. This is a bug fix that also applies to plugin routes; `plugin-cwd-admission` gains a scenario delta if its spec is affected.
- If it already yields `refuse`, no code changes.

### D7 — Auto-init re-probes until the spawned session registers (operator decision 2026-10-22)
`maybeAutoInitWorktreeOnSpawn` (`client/src/lib/git/auto-init-worktree.ts:48`) handles `cwd_unknown` from init-status by re-probing every 500 ms for at most 10 s. A registered session makes the new worktree a known cwd, and therefore admitted. Past the deadline it gives up silently; the manual `WorktreeInitButton` stays available. There is no coupling to the client session store.

- Applies only while `autoInitWorktreeOnSpawn` is ON.
- The probing does not change the TOFU flow.
- Delta: `worktree-auto-init` "Trusted hook auto-runs after spawn".

## Risks / Trade-offs

- **[Tightening blocks git on repos admitCwd refuses]** (sibling-worktree-only, main checkout of a known worktree, children of a pinned non-repo parent). → `cwd_unknown` + pin hint, spec scenarios, CHANGELOG. Operator-accepted.
- **[A sessionless worktree that vanished between listing and click]** now gets `cwd_unknown` in `CloseWorktreeDialog`, not "already gone" (the path is missing and unknown, so no derivation runs). → Accepted. The dialog shows the error, and the refreshed list routes the row to prune. A scenario covers it.
- **[Residual oracles]** Unknown paths no longer get an existence *message*. Still revealed:
  - existence, via timing (git derivation only for existing paths) and 503 on an EACCES request path;
  - **membership, by design**: an unknown missing path gets `cwd_unknown`, while a known deleted path gets `cwd_invalid` "cwd does not exist" (required to keep the known-path messages).

  → Accepted; loopback / trusted-network callers only.
- **[Unreadable known folder ⇒ 503 storm]** Quarantining failing entries was rejected, because it would change `admitCwd` semantics for plugin routes too.
- **[Auto-init after a worktree spawn]** `maybeAutoInitWorktreeOnSpawn(path)` runs concurrently with the session spawn (`SessionList.tsx:3228`, `App.tsx:3611`). When the repository is known only through a sibling worktree, the first probe gets `cwd_unknown`. → D7.
- **[New codes `cwd_unknown` / `cwd-admission-unavailable`]** → i18n `err.*` keys added. MCP tool callers see the error text.
- **[Admission→operation race]** → Accepted; the token lives only for the request.
- **[CodeQL does not honour these guard shapes]** → D0 gate before route work; PR analysis confirms.
- **[Residual unmodelled checks]** (`KEBAB_ID_REGEX`, lib-owned containment) → `evidence/codeql.md`, for `triage-codeql-alert-debt`.

## Migration Plan

- No data migration.
- Deploy: server restart (jiti) and a client build (i18n keys).
- Rollback: revert the commits. No persisted state changes. Closed alerts re-open on the next `develop` scan.
