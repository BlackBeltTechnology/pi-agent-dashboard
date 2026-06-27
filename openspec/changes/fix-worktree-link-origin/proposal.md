# fix-worktree-link-origin

## Why

Follow-up to `git-root-file-containment` (see its **Out of Scope** note). That
change *legalized* worktree sessions reading parent-tree files, but did not fix
the underlying **link-origin defect** it exposed:

A git-worktree session has its *own* `node_modules/vitest/package.json`, yet the
UI emitted the **parent-root** absolute path for the file link. The renderer
pointed at the wrong tree — the parent checkout's copy — instead of the
worktree's own copy.

`git-root-file-containment` made that mis-targeted read succeed (the parent copy
is within the git common root), masking the symptom. The link origin is still
wrong: a worktree session SHOULD reference its own tree by default.

## What Changes

- Correct the link-origin logic so a worktree session emits **its own** tree's
  absolute path for file links, not the git common root / parent checkout copy.
- The git-root containment widening stays as a safety net; this change removes
  the dependence on it for the common worktree case.

## Impact

- Affected code: the renderer / linkifier that resolves file paths for session
  links (origin tree selection). Exact site TBD during design.
- Affected tests: add a worktree-session case asserting the emitted path roots
  at the worktree cwd, not the parent checkout.
- Relationship: depends on `git-root-file-containment` (already shipped); this
  change narrows reliance on the widening for the worktree case.
