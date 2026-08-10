## Why

The KB folder routes (`add-kb-folder-slot`) guard every `/api/kb/*` request by matching the query `cwd` against the host-provided known-folder set (live session cwds ∪ pinned dirs). Investigation of a real worktree (`os-add-tunnel-providers`) traced the reindex/stats failure to that guard: it 403s `cwd not allowed` for a worktree even though the archived spec's **Reindex route** requirement already promises reindexing "a worktree with no attached pi session". Two independent defects:

**Bug 1 — the match is not symlink-canonicalized.** The guard compared `resolve(cwd) === resolve(k)`. `resolve()` normalizes but does NOT follow symlinks. Pins are stored realpath-canonicalized (`safeRealpathSync`, `directory-handler.ts`), while a session cwd or the raw query string may reach the same directory through a symlink (macOS `/tmp`→`/private/tmp`, a symlinked repo root). So the two sides could denote the identical folder yet fail string equality → a live folder spuriously 403s. This is the immediate trigger observed on a live ("Idle") worktree session and reproduced with `/tmp` vs `/private/tmp`.

**Bug 2 — a session-less worktree is unreachable.** A worktree is never pinned (it groups under `gitWorktree.mainPath` and gets no sidebar folder card) and its session is transient. So a worktree's cwd is admissible ONLY while a live session holds its exact cwd. The moment that session ends, every `/api/kb/*` call for the worktree 403s — directly contradicting the archived **Reindex a session-less worktree** scenario. The implementers assumed worktrees would be reachable via pinned dirs; they never are.

The guard's own JSDoc and the design notes admit the hole ("a session-less worktree appears only via pinned dirs, unreachable from the plugin sessionManager surface"), but nothing pins a worktree, so the promised capability was unreachable.

## What Changes

- **Canonicalize both sides of the cwd match.** The guard resolves AND realpath-follows both the query `cwd` and each known folder before comparing, so a folder reached through a symlink matches its canonical known entry (and vice versa). Best-effort: a not-yet-existing path keeps its resolved form.
- **Admit a git worktree whose MAIN repo is a known folder.** When the direct match fails, the guard server-derives the worktree's main working-tree path (`git -C <cwd> rev-parse --path-format=absolute --git-common-dir` → `dirname`) and admits the cwd iff that main path is itself a known folder. The main path is derived server-side via git — never a client-supplied value — so the trust boundary is unchanged: a worktree is admitted only when its parent repo is independently trusted (pinned or session-backed). This makes a **session-less** worktree of a known repo indexable, as the archived spec already required.
- **No change to the host known-folder service, the DB schema, the client, or the wire protocol.** The entire fix lives in the plugin's cwd guard.

## Capabilities

### Modified Capabilities
- `kb-folder-slot`: a new **KB cwd admission** requirement makes the previously-implicit guard explicit and closes both gaps — the folder match is realpath-canonicalized (symlink-equivalent paths match), and a git worktree whose main repo is a known folder is admitted (covering a session-less worktree). The existing per-route "Unknown cwd is rejected" scenarios are unchanged; a truly unknown, non-worktree cwd still 403s.

## Impact

- **Server (plugin only)**: `packages/kb-plugin/src/server/kb-routes.ts` — `rejectCwd` gains `canonPath` (realpath-canonicalize both sides) and `worktreeMainPath` (git-derive a worktree's main repo, admit iff known). Stats/reindex/config routes are otherwise untouched; they all funnel through `rejectCwd`.
- **Tests**: `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts` — a symlinked-alias admission test, a real `git worktree add` admission test (main repo known), and a negative test (worktree whose main repo is NOT known still 403s).
- **Docs**: route JSDoc + the `kb-routes.ts` row in `packages/kb-plugin/src/server/AGENTS.md` record the canonicalization + worktree-of-known-repo admission.
- **Migration / compatibility / rollback**: no schema, protocol, persistence, or client change. The guard only *widens* the admissible set (worktrees of already-trusted repos) and *hardens* matching (symlink equivalence) — no new attack surface. Fully backward-compatible; rollback = revert the one file.
- **Out of scope**:
  - Widening the host `knownFolderCwds` service or pinning worktrees (the parent repo stays the durable trust anchor).
  - Admitting arbitrary subdirectories of a known folder (only git worktrees whose main repo is known).
  - Any change to reindex mechanics, the job registry, stats/config route bodies, or `dox-staleness.json`.

## Discipline Skills

- `security-hardening` — the change touches an authorization guard on an untrusted `cwd`; verify the widened admission (worktree-of-known-repo, symlink canonicalization) does not admit an untrusted path.
