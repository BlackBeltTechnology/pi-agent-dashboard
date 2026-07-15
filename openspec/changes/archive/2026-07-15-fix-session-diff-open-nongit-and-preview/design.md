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

## Audit addendum — sibling `openInSplit` sinks (explore session, 2026-07-15)

An independent explore-mode audit reproduced this bug live (auto-canvas session: content-view
row → `diff:/Users/…/canvas-detect.ts` tab → settled to "No changes for this file", while
`/api/session-diff` keyed the same file as relative `packages/shared/src/canvas-detect.ts`
with a renderable change). It confirms Decision 1's root cause and adds three findings that
widen the fix site.

### The invariant that scopes the blast radius

- Every **server** file read endpoint resolves via `path.resolve(cwd, p)` + a cwd-containment
  guard, so it **tolerates an in-cwd absolute** path. Verified across all five: `/api/file`,
  `/api/file/tree`, `/api/file/raw`, `/api/file/render` (`file-routes.ts`) and
  `/api/session-file` (`session-routes.ts`). An **out-of-cwd** absolute is correctly `403`'d
  — so "survives absolute" means *in-cwd* absolute only.
- Client-side **exact-match** sinks compare against relative `data.files` keys. Two actually
  **break** on an absolute input:
  1. `DiffViewer` — `f.path === relPath` (the reproduced bug).
  2. tab reducer `editor-pane-state` — `findIndex(f => f.path === action.path)` (duplicate-tab).
  A third, `FileDiffView` (`f.path === selection.filePath`), is the same *shape* but **immune
  in practice**: `selection.filePath` is only ever tree-sourced from `data.files` (relative) or
  the auto-selected `first.path` — no call path feeds it an absolute. It needs no fix; a
  defensive fallback there is optional insurance, not a break to repair.
- Therefore: a path that ends at a server read survives an in-cwd absolute; only the two
  client-string-match diff/tab sinks break. That is why "the diff not displayed properly" and
  nothing else.
- **Out-of-cwd absolutes are out of scope by construction:** `session-diff.ts::normalizePath`
  drops out-of-cwd entries (`→ null`), so such a file is absent from the wire keys entirely —
  no normalization can make it match, and the server 403s the read. That case is
  `FileLink`'s worktree-parent re-rooting territory, not this fix's.

### Finding 1 — `openDiffFile` is not the only absolute-fed sink

Decision 1 normalizes at `ChatView.openDiffFile` (→ `openDiffTab`). But two sibling callers
feed absolute `args.path` into the **`openInSplit`** sink, which Decision 1 does not touch:

- `OpenFileButton` (Read/Edit/Write tool headers): `ws.openInSplit(filePath)` with
  `filePath = args.path` (absolute), no `!absolute` guard.
- Editor deep-link `?file=` → `SplitRouteSync` → `openInSplit(file)`; the URL is built by
  `buildEditorUrl(sessionId, args.path)` in `OpenFileButton`'s fallback (absolute via URL).

These "work" only because the monaco tab reads through the server endpoint (which tolerates
absolute). `FileLink` is the reference implementation: it already gates
(`canSplitOpen = !!ws && !absolute && …`) and re-roots via `resolveLinkOrigin`.

### Finding 2 — absolute tab identity → duplicate tabs

The tab reducer dedups on the **full** stored path. The same file opened as `diff:/abs`
(content view) and `diff:rel` (Changes rail) — or `monaco:/abs` vs `monaco:rel` — are two
distinct tabs. Result: duplicate tabs for one file. Normalizing before the reducer collapses
them.

### Finding 3 — `absOf` also corrupts viewer-kind + the open-files watch set

When `openInSplit` receives an absolute `p`, `absOf(cwd, p) = ` `` `${cwd}/${p}` `` yields a
double-rooted `cwd//Users/…` garbage path. Today that garbage feeds **two** consumers, not
just one: (a) `fileKind(…).viewer` kind-detection (survives only because it keys off the last
component's extension), and (b) the `openPathsKey` **open-files watch set** the provider
declares to the server. So "`openInSplit` works because the server read tolerates absolute" is
true for the *content fetch only* — the viewer-kind + watch paths are already subtly wrong.
Normalizing before the reducer (Finding 4) repairs both as a side-effect.

### Finding 4 — refined fix site (extends Decision 1, does not replace it)

Move the normalization one layer down, into the **two shared SplitWorkspace sinks**
`openDiffTab(p)` and `openInSplit(p)` (`SplitWorkspaceContext.tsx`) — the choke point every
absolute-feeding caller (`openDiffFile`, `OpenFileButton`, the `?file=` deep-link) funnels
through. **Mirror the server guard exactly** (`session-routes.ts:103` /
`path-containment.ts:47` both check `startsWith("..")` AND `isAbsolute(rel)` — the latter
catches a Windows cross-drive `relative("C:\\repo","D:\\x") = "D:\\x"` that does NOT start with
`..`):

```ts
// in-cwd absolute → relative-posix; out-of-cwd / cross-drive → unchanged
toSessionRel(cwd, p) =
  isAbsolute(p) && !relative(cwd, p).startsWith("..") && !isAbsolute(relative(cwd, p))
    ? relative(cwd, p)
    : p
```

Covers in one place, **for in-cwd absolutes**: `openDiffTab` (fixes THE bug, same as
Decision 1), `openInSplit` (canonical tab identity → no duplicate tabs; repairs Finding 3's
viewer-kind + watch corruption), server reads (still fine). The dual escape hatch
(`startsWith("..")` OR `isAbsolute(rel)`) leaves **out-of-cwd / cross-drive** absolutes
un-normalized — correct, because those are dropped from the wire keys and are `FileLink`'s
re-rooting concern (NOT reached via these sinks: `FileLink` gates on `!absolute` and never
calls them). Decision 1's display-path normalization in `ChatView` still stands (keeps the
rendered row and lookup consistent); this addendum argues the *open* normalization belongs at
the sinks, not solely at `openDiffFile`. Keep Decision 1's defensive `DiffViewer` fallback.

**Scope honesty:** duplicate-tab collapse and the diff-match fix hold for **in-cwd**
absolutes only. An out-of-cwd absolute stays distinct / unmatched by design (server 403 + wire
drop). **Known limitation (pre-existing, unchanged):** on a case-insensitive FS with a
case-mismatched cwd, `relative` returns a `..`-prefixed path on both client and server, so the
read 403s — broken-but-consistent, low impact; `session-diff.ts::normalizePath` has the same
limit.

Suggested extra regression: same file opened from content-view vs the Changes rail resolves
to ONE tab (not two).

## Non-goals

- No change to `data.files` wire keys (already relative).
- No server-side prior-content reconstruction for edits in non-git repos.
- Not fixing the `/api/pi-resource-file` vs `/api/session-file` doc drift in the existing
  spec (tracked separately).
