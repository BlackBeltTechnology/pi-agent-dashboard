# Design — Support the worktree-init hook in non-git directories

## Context

`GET /api/git/worktree/init-status` and `POST /api/git/worktree/init` share an
identical prelude in `packages/server/src/routes/git-routes.ts`:

```ts
if (!isGitRepo(validated.cwd)) {
  return { success: false, code: "not_a_repo", error: "not a git repository" };
}
const repoRoot = resolveMainPath(validated.cwd);   // git common-dir → main repo
if (!repoRoot) {
  return { success: false, code: "not_a_repo", error: "unable to resolve git common-dir" };
}
const hook = readInitHook(repoRoot);               // reads <root>/.pi/settings.json
```

`resolveMainPath` (`packages/server/src/git-operations.ts:606`) runs
`git rev-parse --git-common-dir`; it is meaningful only inside a git worktree.
For a non-git dir it returns `null` — but the `isGitRepo` guard already returned
`not_a_repo` before we get there.

## Decision: `resolveConfigRoot(cwd)`

Introduce one helper that answers "which directory holds the config for this
cwd" without assuming git:

```ts
// Uses the LOCAL git-operations helpers already imported by git-routes.ts:
//   isGitRepo(cwd: string): boolean         (git-operations.ts, NOT the shared
//                                            WithCwd→Result variant)
//   resolveMainPath(cwd: string): string | null
export function resolveConfigRoot(cwd: string): string | null {
  if (isGitRepo(cwd)) return resolveMainPath(cwd);   // unchanged git path (may be null)
  return fs.existsSync(path.join(cwd, ".pi", "settings.json")) ? cwd : null;
}
```

Note the git branch returns `resolveMainPath(cwd)` **directly**, which may be
`null` for a corrupt/degenerate git state (`is-inside-work-tree` true but
`git-common-dir` unresolvable). It does NOT fall through to the non-git
`cwd/.pi` check — a git dir is never treated as its own config root. So there is
no path by which a git repo's own `cwd/.pi/settings.json` is read as a non-git
config root; the cwd branch is reachable only when `isGitRepo(cwd)` is false.

- **Git repo / worktree** → `resolveMainPath(cwd)`. Identical to today: a
  worktree maps to its main repo root, so a hook declared on the main checkout
  applies to worktrees. Zero behavior change.
- **Non-git dir with `.pi/settings.json`** → `cwd` itself. The hook lives in the
  directory being viewed.
- **Non-git dir without `.pi/settings.json`** → `null`. Genuinely unconfigured.

### Behavior change on the corrupt-git edge (accepted)

Today, when `isGitRepo(cwd)` is true but `resolveMainPath(cwd)` returns `null`,
both endpoints reply `{ success:false, code:"not_a_repo", error:"unable to
resolve git common-dir" }`. After this change they reply `{ success:true, data:{
hasHook:false } }` (via `resolveConfigRoot` → `null` → the no-root branch).

This is an accepted, harmless shift: an error response becomes a successful
"no hook" response for a degenerate git state that produces no worktree-init
UI either way. Nothing executes (root is `null`, so `readInitHook` is never
called and no gate/run spawns). No caller depends on the `not_a_repo` code from
these two routes (the client fail-opens any `success:false` to `{hasHook:false}`
in `git-api.ts` — same rendered outcome). If a distinct diagnostic is later
wanted for this state, it belongs in a separate change; it is out of scope here.

Rationale for placement: co-locate with `resolveMainPath` in
`git-operations.ts` (already imported by the route module), or in
`worktree-init.ts` next to `readInitHook`. Either keeps the route thin. Prefer
`git-operations.ts` since it owns `resolveMainPath` and `isGitRepo` is already a
shared platform primitive.

## Route change (both endpoints)

Replace the two-step git prelude with:

```ts
// Rename the route-local `repoRoot` → `configRoot`: for a non-git dir it holds a
// cwd, not a repository root. Prevents a future maintainer from bolting
// git-specific logic onto a variable that may not be a git checkout.
const configRoot = resolveConfigRoot(validated.cwd);
if (!configRoot) {
  // init-status:
  return { success: true, data: { hasHook: false } };
  // init: return the EXISTING no-hook envelope verbatim (no new wire shape):
  //   return { success: true, data: { ran: false, skippedReason: "no_hook" } };
}
const hook = readInitHook(configRoot);   // isTrusted(configRoot, hash) etc. unchanged
// ...unchanged: hasHook:false when null, else isTrusted / evaluateGateCached
```

Key point: a non-git dir with **no** hook now returns `success:true,
{hasHook:false}` instead of `success:false, not_a_repo`. This is strictly better
for the client — same rendered outcome (Initialize scaffolder button) but via
the intended "no hook" path, not an error fail-open.

The `POST /init` null-root branch SHALL reuse the endpoint's existing no-hook
response `{ success: true, data: { ran: false, skippedReason: "no_hook" } }` (see
`git-routes.ts`, current `if (!hook)` branch). No new response shape is
introduced, honoring the "no protocol changes" constraint. Likewise, the
untrusted path is unchanged: a non-git dir with an untrusted hook returns the
existing `{ success: false, code: "init_untrusted", data: { hook, hash } }`.

## Why not the alternatives

```
                        touches      correct for      TOFU        effort
                        server?      non-git dir?     preserved?
 ─────────────────────────────────────────────────────────────────────────
 A. git init the dir    no           side-effect ✗    yes         trivial
 B. resolveConfigRoot   yes          yes ✓            yes         moderate   ◀ chosen
 C. client treats       yes(client)  partial ✗        n/a         small
    not_a_repo=unknown
 D. do nothing          no           n/a              yes         zero
```

- **A** pollutes a personal archive with a `.git`; unacceptable for a 1000+ file
  non-repo directory.
- **C** only masks the symptom in the UI; the server still can't read or run the
  hook, so the "run my hook" button (change-A path) never appears for non-git
  dirs. Doesn't actually enable init in non-git dirs.
- **D** leaves the product gap.

## Trust boundary

The `isGitRepo` guard is **not** a security control — TOFU is. `resolveConfigRoot`
only decides *where to read a config file*; it never executes anything. Executing
the repo-declared `gate`/`run` still requires `isTrusted(repoRoot, hookDefHash)`,
unchanged. A non-git dir with an untrusted hook reports `{hasHook:true,
trusted:false}` and runs nothing until the user confirms — same as a git repo.

**Disclosure surface (accepted, bounded).** TOFU gates *execution*, not
*reading*. Both endpoints read `<root>/.pi/settings.json` and the untrusted
`POST /init` path returns the hook body (`init_untrusted → { hook, hash }`).
This change widens the set of directories whose hook body is readable via these
two routes from *git repos only* to *any directory `validateCwd` accepts that
contains `.pi/settings.json`*. This is bounded by the same two controls that
already front every arbitrary-path server endpoint (file reads, diffs): the
`networkGuard` preHandler (loopback-only by default; gated to trusted networks
when exposed) and `validateCwd`. It is not a new *class* of exposure —
`validateCwd`-fronted file reads already exist — but it is a wider *instance*,
and callers on a network-exposed dashboard could enumerate hook bodies in
arbitrary dirs. Accepted for the single-user local default; flagged here so a
future network-hardening change can scope it if needed.

## Precondition: git on PATH (unchanged from today)

`resolveConfigRoot`'s git branch depends on `isGitRepo` / `resolveMainPath`,
which shell out to `git`. If `git` is absent from the server's PATH, `isGitRepo`
returns `false` for every directory (`tryRun` swallows the spawn error), so even a
git repo takes the non-git branch. This is not a regression: today the same
missing-`git` state makes both routes return `not_a_repo`, which the client
fail-opens to `{hasHook:false}` — the identical rendered outcome (project-init
button) to the post-change `{hasHook:false}`. Worktree features require `git`
regardless, so a git worktree cannot exist on a server without `git`. No new
failure mode; noted so the precondition is explicit.

## Scope guard: creation routes untouched

`resolveConfigRoot` is used **only** by init-status and init. The worktree
create/remove/lifecycle routes keep their `isGitRepo` → `resolveMainPath` guards;
`not_a_repo` there is correct because worktrees require git.
