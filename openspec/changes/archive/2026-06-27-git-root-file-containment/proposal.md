# git-root-file-containment

## Why

The file-read/preview/raw routes contain every request to the **single session
`cwd`** passed in the request:

```js
// packages/server/src/routes/file-routes.ts (×4 sites) + system-routes.ts (×1)
const resolved = path.resolve(cwd, relPath);
if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd)
  return { success: false, error: "path outside working directory" };
```

This breaks **git-worktree** sessions. A worktree cwd is a descendant of the
main repo root; files that legitimately live in the parent tree are *ancestors*
of the worktree, so they fail `startsWith(cwd)`:

```
/Users/robson/Project/pi-agent-dashboard/                 ← git common root
├── node_modules/vitest/package.json   ◄── opened by UI → "path outside
└── .worktrees/                              working directory" (403)
    └── os-extend-…/   ← session cwd (worktree)
```

Concrete repro: a worktree session opened
`…/pi-agent-dashboard/node_modules/vitest/package.json` (parent-root copy) and
the preview overlay returned `path outside working directory`.

Containment SHOULD follow the **git common root**, not the leaf worktree, so a
worktree session can read sibling trees within the same repository.

**Trust boundary = the git common root.** A repository is a single shared trust
domain: any caller who has already cleared `networkGuard` to reach a session may
read anything *within that session's repo*. There is therefore no additional
guard *inside* a repo — the widening applies to every request (loopback,
trusted-network, and authenticated-remote alike). The boundary that still holds
is the repo edge: paths outside the git common root stay rejected. (`networkGuard`
remains the gate for *reaching* the route at all; this change only governs which
paths a reached request may read.)

**Scope is every repo-subdir session, not only worktrees (intentional).** The
anchor is the git common root, so the widening applies to ANY session whose cwd
is a subdirectory of a repo — a worktree (`.worktrees/x`), a package dir
(`packages/server`), anything. Such a session gains read of the **whole repo**,
including root-level files like `.env`. This is the deliberate consequence of
treating the repo as one trust domain (decision Q1); it is not limited to the
worktree case that motivated it. Reviewers MUST approve this broader scope, not
just "worktree access."

## What Changes

- Extract a single shared containment helper
  (`packages/server/src/lib/path-containment.ts`) and route the guard sites
  through it. The helper is **parameterized** (caller passes its anchor set and
  its rejection-error string) so each site **preserves its existing behavior**:
  `/api/file/exists` keeps its pinned-directory anchor and its `"unknown cwd"` /
  `"path outside cwd"` strings; `/api/file`, `/api/file/raw`, `/api/file/render`,
  and the `system-routes` target keep `"path outside working directory"`. This
  change does NOT fold the pinned-dir grant onto the read/raw/render routes.
- Containment is **layered (fast cwd gate first, git-root fallback on miss)**:
  1. resolved under session `cwd`? → allow (pure string op, no spawn — the hot
     path; ~all reads stop here).
  2. else resolved under `gitRoot(cwd)`? → allow (git invoked only on miss,
     result cached per cwd).
  3. else → reject (`path outside working directory`, unchanged).
- `gitRoot(cwd)` = `dirname(git -C cwd rev-parse --path-format=absolute
  --git-common-dir)`. On any failure (not a repo / git absent / spawn error) it
  **falls back to `cwd`**, collapsing layer 2 into a no-op → behavior degrades
  to today's cwd-only containment. A broken git environment can never *widen*
  access, only narrow to the safe default.
- Layer 2 resolves the **real path** (`fs.realpath`) before the `startsWith`
  compare so a symlink that escapes the git root cannot pass. Layer 1 stays
  logical-path only (matches today's behavior; no regression, no extra fs call
  on the hot path).
- **Cross-repo isolation (C-strict):** layer 2 only widens to the git root of
  the cwd's *own* repository. Sessions registered against unrelated repos stay
  mutually isolated.

## Impact

- Affected specs: `file-read-containment` (new capability spec; codifies the
  layered rule the routes already implement informally).
- Affected code:
  - `packages/server/src/lib/path-containment.ts` (new shared helper + git-root
    cache).
  - `packages/server/src/routes/file-routes.ts` (4 guard sites → helper).
  - `packages/server/src/routes/system-routes.ts` (1 guard site → helper).
- Affected tests:
  - `file-absolute-containment.test.ts` — `/etc/passwd` still rejected (outside
    git root): no security regression. Add worktree-allow + symlink-escape +
    git-absent-fallback cases.
  - `file-raw-render-endpoints.test.ts` — same containment string, route via
    helper.

## Out of Scope (tracked separately)

The repro also exposed a **link-origin defect**: the worktree has its *own*
`node_modules/vitest/package.json`, yet the UI emitted the **parent-root**
absolute path. This change *legalizes* that read but does not fix the renderer
that pointed at the wrong tree. File a follow-up to correct the link origin so
worktree sessions reference their own tree by default.
