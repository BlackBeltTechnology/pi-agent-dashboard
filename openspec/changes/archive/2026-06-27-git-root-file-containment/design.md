# Design — git-root-file-containment

## Context

Five guard sites enforce path containment against the single request `cwd`:

| Site | Route | Purpose |
|------|-------|---------|
| `file-routes.ts:124` | `GET /api/file` | read file / list dir |
| `file-routes.ts:172` | `GET /api/file/exists` | existence probe — **anchor incl. pinned dirs**, strings `"unknown cwd"` / `"path outside cwd"` |
| `file-routes.ts:222` | `GET /api/file/raw` | raw inline stream |
| `file-routes.ts:325` | `GET /api/file/render` | rendered preview |
| `system-routes.ts:174` | system file op | open-editor target etc. |

Four of these hand-roll `resolved.startsWith(cwd + sep) || resolved === cwd`
with the `"path outside working directory"` string. `/api/file/exists` is
**different**: its known-cwd set also includes
`preferencesStore.getPinnedDirectories()`, and it rejects with `"unknown cwd"` /
`"path outside cwd"`. The helper must therefore be **parameterized**, not a
single fixed predicate — it takes the anchor set + the rejection string so each
site preserves its current behavior (see D6, D7).

## The layered containment decision

```
isAllowed(resolved, cwd):

  ① within(resolved, cwd)?           ──► ALLOW   (pure string op, no spawn)
        │ no                               ▲  ~all reads stop here
        ▼                                  │
  ② root = gitRoot(cwd)                    │
     root !== cwd && within(real(resolved), root)? ──► ALLOW
        │ no                                          worktree → parent reads
        ▼
     REJECT  → "path outside working directory"
```

```
within(p, base) := p === base || p.startsWith(base + path.sep)
```

### Why ordering is a performance choice, not a security one

Allow-set = `cwd-subtree ∪ gitRoot-subtree`. Since `cwd ⊂ gitRoot`, the union
*equals* `gitRoot-subtree`. Layered-fallback and a flat git-root check allow the
**exact same files**. The fallback just evaluates lazily: layer ① is the
existing zero-cost string op and catches ~every real read; git is spawned only
when a read actually escapes the cwd (rare). No aggressive caching needed for
correctness — the hot path never calls git.

## Decisions

### D1 — Anchor = git **common** root (worktree-aware)

`git -C <cwd> rev-parse --path-format=absolute --git-common-dir` returns the
shared `.git` for both the main checkout and every worktree
(`…/pi-agent-dashboard/.git`). `dirname` of that = the repo root that contains
all worktrees. Verified on this repo: main checkout and the
`os-extend-…` worktree both report the same common dir.

### D2 — Fail-closed fallback to `cwd`

`gitRoot(cwd)` returns `cwd` itself on any error (non-repo dir, git not on PATH,
spawn failure, unexpected output). Layer ②'s `root !== cwd` guard then short-
circuits → containment collapses to today's cwd-only rule. **A degraded git
environment narrows access; it never widens it.**

### D3 — `realpath` in layer ② only

Symlink risk: `worktree/node_modules → /elsewhere/store` could let a logical
path pass `startsWith` while the real path sits outside the root. Layer ②
resolves `fs.realpath(resolved)` before comparing to the (also real-path'd)
root. Layer ① stays logical — it matches today's behavior exactly (the symlink
risk there is pre-existing and unchanged by this proposal), and keeps the hot
path free of an fs call. The widening happens only in ②, so the stricter check
lives exactly where the new exposure is introduced.

### D4 — C-strict cross-repo isolation

Layer ② widens only to the git root of the cwd's *own* repo. Two sessions on
unrelated repositories never gain read access to each other. Costs nothing extra
over C-loose here (single repo) but keeps multi-repo deployments isolated.

### D6 — No guard *inside* the repo; trust boundary is the git root (Q1)

The repository is one shared trust domain. Any caller that cleared `networkGuard`
to reach a session may read anything within that session's repo — loopback,
trusted-network, and authenticated-remote callers alike. So layer ② widening is
**unconditional** (no loopback gate). `networkGuard` stays the gate for reaching
the route; this change only decides which paths a reached request may read. The
only boundary that still holds is the repo edge: outside the git common root
stays rejected.

### D9 — Widening scope is all subdir sessions, not just worktrees (G1, resolved)

The anchor is the git common root, so layer ② widens **every** session whose
cwd is a strict subdirectory of a repo — verified: `git -C packages/server` →
root `…/pi-agent-dashboard`. Such a session can read root-level files (`.env`,
top-level configs). This is intentional under Q1 (repo = one trust domain), not a
worktree-only fix. It is called out explicitly in the proposal so approval
covers the real surface. No mitigation — accepted by decision.

### D7 — Preserve per-site behavior; helper is parameterized (Q2)

The shared helper does NOT homogenize the sites. It accepts the caller's anchor
set and rejection string:
- `/api/file`, `/api/file/raw`, `/api/file/render`, `system-routes` → anchor
  `{cwd}` (+ git-root layer ②), string `"path outside working directory"`.
- `/api/file/exists` → anchor `{cwd} ∪ pinnedDirs` (+ git-root layer ②), strings
  `"unknown cwd"` / `"path outside cwd"`.

This change does **not** fold the pinned-dir grant onto read/raw/render — that
would be a separate, larger widening. The git-root layer ② applies to every
site (it is the worktree fix); only the pinned-dir anchor stays exists-only.

### D5 — `gitRoot` caching keyed by `.git`, not bare cwd (G3)

Layer ② is a cold path (fires only on cwd-escape), so caching is a minor
optimization, not a correctness need. A naive module-level `cwd → root` cache
living for the whole server lifetime can **over-allow**: if a path is deleted
and reused for a *different* repo within one server run, a stale entry returns
the old, possibly broader root. Mitigation: either skip caching entirely, or key
the cache by `realpath(--git-common-dir)` so a new `.git` invalidates the entry.
Do NOT key by bare `cwd` alone.

### D8 — Platform-normalize before the containment compare (G2)

`git rev-parse --path-format=absolute --git-common-dir` emits **forward slashes**
(`C:/repo/.git`) while `path.resolve` emits native separators
(`C:\repo\node_modules\…`). A raw `startsWith` compare fails on Windows purely on
separator (and drive-letter case), so layer ② would silently never fire. The
helper SHALL normalize both `resolved` and `gitRoot` to native separators and
canonical drive-letter case (e.g. `path.resolve` the git output) before
`within()`. Windows is a supported platform (the linkifier already handles `C:\`
drive paths).

## Known limitations (G4)

- **Submodules:** `dirname(--git-common-dir)` for a submodule session is
  `<superproject>/.git/modules/<name>` — a path inside `.git` containing no
  working-tree files. Layer ② therefore matches nothing and degrades to
  cwd-only. Fails closed (never wider); the worktree widening simply does not
  apply to submodule sessions.
- **`git init --separate-git-dir`:** when `.git` is not directly under the
  worktree root, `dirname(--git-common-dir)` ≠ worktree root. Layer ② may
  under-contain (never over-contain). Rare; accepted.

## Risks

| Risk | Mitigation |
|------|------------|
| Blast radius → whole repo incl. sibling worktrees + parent uncommitted files | Accepted: localhost-only + `networkGuard`; single user, single machine |
| `git` spawn latency per escaping read | Layer ① short-circuits ~all reads; cache keyed by `.git` (D5) |
| Stale cache over-allows on path reuse | D5 — key cache by `realpath(--git-common-dir)`, or skip caching |
| Windows separator/drive-case mismatch → layer ② never fires | D8 — normalize both sides to native sep + drive case before `within()` |
| Symlink escape via widened root | D3 `realpath` in layer ② |
| Masks the link-origin defect (wrong-tree path) | Out-of-scope follow-up filed in proposal |
| Five sites drift | D-pre: single shared helper, all sites routed through it |

## Alternatives considered

- **B — anchor = any known session cwd.** Allow if resolved is under *any* live
  session's cwd. Works only when the main-repo session happens to be registered;
  brittle (depends on which sessions are open). Rejected for git-root, which is
  deterministic.
- **C-loose — flat git-root check, no cwd fast path.** Same allow-set, but pays
  a git spawn (or cache lookup) on *every* read instead of only on cwd-escape.
  Layered ①→② is a strict perf win with identical semantics.
