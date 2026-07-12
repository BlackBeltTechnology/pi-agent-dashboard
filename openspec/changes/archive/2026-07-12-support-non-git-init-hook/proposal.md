# Support the worktree-init hook in non-git directories

## Why

The worktree-init hook (`.pi/settings.json#worktreeInit`) is the mechanism that
tells the dashboard whether a checkout is "configured" and how to initialize it.
Both endpoints that read it — `GET /api/git/worktree/init-status` and
`POST /api/git/worktree/init` (`packages/server/src/routes/git-routes.ts`) —
short-circuit with `not_a_repo` **before** ever calling `readInitHook` when the
cwd is not a git repository:

```
validateCwd → isGitRepo? ──no──▶ return not_a_repo    ◀── short-circuit
                  │yes
                  ▼
         resolveMainPath (git common-dir)   ← the only "config root" resolver
                  │
                  ▼
         readInitHook(repoRoot)             ← never reached for a non-git dir
```

Consequence: a fully-configured non-git directory (valid `AGENTS.md` +
`.pi/settings.json#worktreeInit`, e.g. a personal `~/Documents` archive) is
reported as `not_a_repo`. The client (`packages/client/src/lib/git-api.ts`)
fail-opens `success:false` → `{ hasHook: false }`, so `WorktreeInitButton`
renders the amber **Initialize** (project-init scaffolder) button as if the
directory were unconfigured — even though its hook is present and valid.

The hook engine itself (`readInitHook`, `evaluateGate`, TOFU trust,
`runInitHook`) is already git-agnostic; it only needs a directory root. Two
guards couple it to git: the `isGitRepo` entry gate, and using
`resolveMainPath` (git common-dir) as the sole way to find the config root.

## What Changes

Split "where is the config root" from "is this git", for the init-status / init
pair **only**. Worktree *creation* routes keep requiring git.

- Introduce `resolveConfigRoot(cwd)` (server): return `resolveMainPath(cwd)` when
  `cwd` is a git repo (unchanged behavior); otherwise return `cwd` when
  `cwd/.pi/settings.json` exists; otherwise `null`.
- In `GET /init-status` and `POST /init`, replace the `isGitRepo` guard +
  `resolveMainPath` call with `resolveConfigRoot`. When it returns `null`,
  report `{ hasHook: false }` (init-status) / return the existing no-hook
  envelope `{ ran: false, skippedReason: "no_hook" }` (init) — no new wire shape.
  `null` occurs only for a non-git dir with **no** `.pi/settings.json`; a non-git
  dir that has `.pi/settings.json` but no (or a malformed) `worktreeInit` still
  resolves a root and reports `hasHook: false` via the existing `readInitHook`
  fail-open, exactly as a git repo without a hook does today.
- **No upward walk.** For a non-git dir the config root is exactly `cwd`. A
  non-git directory never inherits a parent's `.pi/settings.json`. (Git worktrees
  keep their existing main-repo mapping via `resolveMainPath`.)
- TOFU trust is unchanged — it already keys off `repoRoot + hookDefHash`, which
  works identically when the root is a non-git `cwd`.

## Non-goals

- Loosening the git requirement on worktree **creation** / lifecycle routes
  (`/worktree`, `/worktree/create`, remove, etc.). Those still return
  `not_a_repo` for non-git dirs — worktrees are a git concept.
- Upward `.pi/settings.json` discovery / inheritance for non-git dirs.
- Any change to the client fail-open mapping or the project-init scaffolder.

## Capabilities

### Modified Capabilities

- `worktree-init-hook`: config-root resolution decoupled from git so the
  init-status / init endpoints read a declared hook in a non-git directory.

## Impact

- **Backward compatible.** Git repos and git worktrees resolve exactly as today
  via `resolveMainPath`; only the previously-`not_a_repo` branch gains behavior.
  For a non-git dir the *response for a given input changes* — `not_a_repo`
  (error) becomes an existing success envelope (`{hasHook:false}` /
  `{ran:false, skippedReason:"no_hook"}`). The client fail-opens any
  `success:false` to `{hasHook:false}`, so the rendered outcome is identical; an
  external caller that switches on `response.success`/`code` for these two routes
  on a non-git dir would observe the flip.
- **Files:** `packages/server/src/routes/git-routes.ts` (two guard sites), plus a
  new `resolveConfigRoot` helper (in `git-operations.ts` alongside
  `resolveMainPath`, or `worktree-init.ts`). No NEW protocol message types or
  wire shapes (existing envelopes reused), no client code changes, no
  persistence changes.
- **Migration / rollback:** pure server logic, jiti-loaded — restart to apply,
  revert to roll back. No data or schema migration.
- **Security:** the git gate is removed only for the two read/gated-run
  endpoints; TOFU still blocks executing a repo-declared gate/run until the user
  trusts the hook, so a non-git dir cannot auto-execute code on mere viewing.
  TOFU gates *execution*, not *reading*: these routes read `.pi/settings.json`
  and the untrusted `POST /init` returns the hook body. This change widens the
  readable set from git repos to any `validateCwd`-accepted dir with
  `.pi/settings.json`, bounded by the same `networkGuard` + `validateCwd`
  controls that already front every arbitrary-path endpoint. Accepted for the
  local single-user default; see design.md "Disclosure surface".

## Discipline Skills

- `security-hardening` — the change moves a trust-boundary guard (`isGitRepo`)
  that fronts execution of repo-declared bash; verify TOFU still fully gates the
  non-git path.
