## Context

`git-root-file-containment` (archived 2026-06-27) widened file-read containment
to the git common root so a worktree session could read parent-tree files. Its
**Out of Scope** note filed this follow-up: the same repro exposed a
**link-origin defect** the widening only *masked*.

Current link path flow (all client-side, browser-safe string ops):

| Site | File | Behavior |
|------|------|----------|
| tokenizer | `packages/client/src/lib/linkify-tool-output.ts` | POSIX-absolute (`file_posix`), Windows-drive (`file_win`), and `file://` tokens are flagged `absolute: true`. Relative tokens carry no flag. |
| link render | `packages/client/src/components/tool-renderers/FileLink.tsx` | `resolved = absolute ? path : resolveAgainstCwd(cwd, path)`. Absolute tokens pass **verbatim** — never re-rooted. |
| click | `FileLink.tsx` handler | calls `openFile(path, line)` with the **raw token `path`**, NOT `resolved`. |
| open/preview | `useFileOpenRouting.ts` → `POST /api/open-editor` or `FilePreviewOverlay` | server re-resolves `path.resolve(cwd, file)`; absolute input stays absolute. |

The defect: a tool emits an **absolute** path rooted at the parent checkout
(e.g. `…/pi-agent-dashboard/node_modules/vitest/package.json`) while the session
is a worktree (`…/pi-agent-dashboard/.worktrees/<slug>`). The token is
`absolute: true`, so `FileLink` shows it verbatim AND `openFile` sends the
parent-rooted path. The renderer points at the **parent checkout's copy**, not
the worktree's own `node_modules/vitest/package.json`. The git-root containment
made that read succeed, hiding the wrong-tree target.

Relative tokens are NOT affected: they already anchor to the session `cwd` (the
worktree) via `resolveAgainstCwd` and server `path.resolve(cwd, file)`.

## Goals / Non-Goals

**Goals:**

- A worktree session re-roots an **absolute** file-link token that points into
  the parent checkout onto the worktree's own tree — for the tooltip, the
  preview overlay, AND the open-in-editor target.
- Derive the parent-checkout root from the worktree `cwd` alone (string op); no
  new server payload, no new session metadata, no git spawn on the client.
- Keep server git-root containment as a safety net; remove reliance on it for
  the common worktree case.

**Non-Goals:**

- Relative-token resolution (already correct).
- Worktrees created outside the dashboard's `.worktrees/<slug>` convention
  (parent root not derivable from cwd) — those fall back to today's verbatim
  behavior (no regression).
- Submodules, `--separate-git-dir`, and other layouts the prior change already
  documented as degrade-closed.
- Server-side validation changes — `/api/file*` containment stays as shipped.

## Decisions

### D1 — Derive parent-checkout root from the worktree cwd (string op)

Dashboard worktrees always live at `<parentRoot>/.worktrees/<slug>` (see
`packages/shared/src/git-worktree-helpers.ts`). The renderer derives
`parentRoot` by stripping a trailing `/.worktrees/<slug>` (or `\.worktrees\<slug>`
on Windows) segment from the session `cwd`. Pure string op, browser-safe,
mirrors the existing `resolveAgainstCwd` approach — no `node:path`, no server
round-trip, no new session field.

*Alternative considered:* add `worktreeParentRoot` to the session payload /
`ToolContext`. Rejected — extra protocol surface for data already encoded in the
cwd path; the `.worktrees/<slug>` shape is the dashboard's own deterministic
convention.

### D2 — Re-root only absolute tokens under the parent root

A new pure helper `resolveLinkOrigin(cwd, path, absolute)` returns the path that
links/opens SHOULD target:

```
resolveLinkOrigin(cwd, path, absolute):
  if !absolute            → resolveAgainstCwd(cwd, path)   # unchanged
  parentRoot = stripWorktreeSegment(cwd)
  if parentRoot === undefined          → path             # cwd not a worktree
  if path under cwd                    → path             # already worktree-rooted
  if path under parentRoot             → cwd + path.slice(parentRoot.length)
  else                                 → path             # foreign absolute, verbatim
```

`under(p, base) := p === base || p.startsWith(base + sep)`. Only an absolute
token rooted in the parent checkout (but not already in the worktree) gets its
prefix swapped `parentRoot → cwd`. Everything else passes through unchanged.

### D3 — Apply the remap to the OPEN target, not just the tooltip

Today the click handler calls `openFile(path, …)` with the raw token path; the
`resolved` string only feeds the `title` tooltip. The fix MUST hand the
re-rooted path to `openFile` (and thus to `/api/open-editor` and the preview
overlay), so the actually-opened file is the worktree copy — not only the
tooltip text. `resolveLinkOrigin` output replaces `path` at the open/preview
boundary and feeds the tooltip.

### D4 — Fail-open to verbatim; never widen

Every non-matching branch returns the original path. A non-worktree cwd, a
foreign absolute path, or a non-`.worktrees` worktree layout all degrade to
exactly today's behavior. The change can only **redirect a parent-rooted path to
the sibling worktree path**; it never grants a new target the server would
reject (worktree subtree ⊂ git common root, already allowed).

### D5 — Server containment unchanged; safety net retained

`/api/file*` and `system-routes` keep the git-root containment from the prior
change. If a remapped worktree path does not exist (parent-only artifact), the
server returns 404 for the worktree path — the correct-tree miss, not a
wrong-tree hit. No client-side `stat` (browser cannot).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Remapped worktree path does not exist (file is parent-only, e.g. an untracked build artifact) → 404 | Accepted: 404 on the correct tree beats a silent read of the wrong tree. Open question Q1 tracks an optional existence probe. |
| Worktree created outside `.worktrees/<slug>` → parentRoot not derivable | Falls back to verbatim (D4); no regression. Out of scope. |
| Windows separator / drive-case: `cwd` and token may differ in `\` vs `/` | `stripWorktreeSegment` + `under()` normalize separators before compare (mirror prior change D8). Add a Windows-path unit case. |
| Nested `.worktrees` in a token path falsely matched | Strip only a **trailing** `/.worktrees/<slug>` anchored at end of `cwd`; token matching uses prefix `under(path, parentRoot)`, not a search for `.worktrees`. |

## Open Questions

- **Q1:** Should the renderer existence-probe (`GET /api/file/exists`) the
  remapped path and fall back to the parent path on 404, or always prefer the
  worktree path? Default decision: always prefer worktree (D2/D5); probe is a
  possible later refinement, not in this change.
