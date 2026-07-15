# Design — fix-session-diff-open-nongit-and-preview

## Root cause (traced)

```
  ChangeSummaryBlock row              SessionDiff API (server)
  ────────────────────                ────────────────────────
  path = args.path  (RAW)             extractFileChanges()
  = /Users/…/proposal.md                → normalizePath()
         │                                → "openspec/changes/…/proposal.md"
         │  onOpenFile(absPath)                   │  (RELATIVE, posix)
         ▼                                         ▼
  openDiffTab(absPath)  →  diff:absPath    data.files keyed by REL path
         │                                         │
         ▼                                         │
  DiffViewer:  data.files.find(f => f.path === relPath)
                          "/Users/…/…"  ≠  "openspec/…"
                                          │
                                          ▼
                            "No changes for this file"  ← blank
```

- Server side already normalizes (`session-diff.ts::normalizePath`): absolute-under-cwd →
  relative-posix; absolute-outside-cwd → dropped; relative → kept.
- Client side (`lineDelta.ts::toolPath`) does **not** normalize. So the two surfaces
  disagree only when a tool call used an absolute path — which is why some sessions work
  (relative paths) and others blank (absolute paths).

## Decision 1 — normalize at the client source

Introduce one shared helper (mirrors the server rule):

```ts
// absolute && under cwd → relative posix; else unchanged
normalizeUnderCwd(rawPath: string, cwd: string): string
```

Apply where the client first materializes a changed-file path so BOTH the displayed row
and the diff-open lookup use the normalized form:

- Preferred site: `ChatView.openDiffFile` already has `splitWs.cwd` — normalize there
  before `openDiffTab`. Also normalize the path used for the row `title`/display so the
  rendered row and the lookup can never diverge.
- `DiffViewer` lookup gains a defensive fallback: if an exact match misses, retry with the
  cwd-normalized path (belt-and-suspenders for any other caller).

Rejected: normalizing only inside `DiffViewer.find` (Option B alone) — hides the mismatch
and leaves the displayed row absolute while the lookup is relative. Normalizing at source
keeps display and lookup consistent.

## Decision 2 — git ⇒ gitDiff, else session-derived diff

Make the precedence a stated contract in `DiffPanel`:

1. If a specific change is selected → render that change's derived texts (Path A, existing).
2. Else if `file.gitDiff` present (git repo: real or synthetic-for-untracked) → render
   git hunks (Path B, existing).
3. Else (non-git, or git absent, or untracked-with-no-synthetic) → derive from the file's
   own session change payload (last Write `content` / Edit ops) and render as all-additions
   / edit diff. Never blank when the file exists in `data.files`.

Server behavior is unchanged: git repo yields `gitDiff` (incl. the untracked `--- /dev/null`
synthetic); non-git yields no `gitDiff`. The guarantee that the panel still renders lives in
the client (it already holds the change payload). This keeps the server free of
prior-content reconstruction for edits (which it cannot do without a VCS).

## Decision 3 — first-class file preview in split diff tab

`DiffPanel` already has a `Diff / File` view toggle (File → `/api/session-file`, syntax
highlighted). In the split `DiffViewer` tab, surface preview as a first-class control so a
reviewer can flip to the whole current file without hunting the diff-only toolbar. Options:

- (a) Keep the toggle but ensure it is always visible/reachable in the split tab.
- (b) Add a dedicated preview affordance (e.g. a tab-level "Preview" alongside the diff).

Chosen: (b)-lite — expose the File preview as a persistent, labeled control in the split
DiffViewer header, defaulting to Diff, so preview is one click and discoverable. Reuses the
existing `/api/session-file` fetch and `SyntaxHighlighter` path; no new endpoint.

## Non-goals

- No change to `data.files` wire keys (already relative).
- No server-side prior-content reconstruction for edits in non-git repos.
- Not fixing the `/api/pi-resource-file` vs `/api/session-file` doc drift in the existing
  spec (tracked separately).
