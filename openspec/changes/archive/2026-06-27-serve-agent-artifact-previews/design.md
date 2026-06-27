# Design — serve-agent-artifact-previews

## Context

Three containment anchor classes exist for previewed paths:

```
 Class 1  inside session cwd            allowed today
 Class 2  inside repo, above worktree   git-root-file-containment
 Class 3  outside any repo (agent tmp)  THIS change
```

The screenshot is Class 3: `~/.agent-browser/tmp/screenshots/…png`, served by
`<img src="/api/file/raw…">`. `raw` contains to `cwd`; the artifact is outside
every cwd and every git root → 403 → "Failed to load image".

## The anchor model

`/api/file/raw` allows a resolved path when ANY anchor contains it, evaluated
cheap-first:

```
① within(resolved, cwd)                         (string op)        any type
② gitRoot(cwd)≠cwd && within(real, gitRoot)      (git-root change)  any type
③ artifactRoot ∈ roots: within(real, root)       (THIS change)      IMAGE ONLY
   else → 403 "path outside working directory"
```

Layer ③ differs from ①/② in one way: it is **type-gated to images**. Layers
①/② serve any file type (they are repo-scoped, already trusted). Layer ③ opens
a global root, so it is narrowed to `IMAGE_EXTS` — the only artifacts the
preview surface needs.

## Decisions

### D1 — Artifact-root allowlist, real-path resolved (env name corrected, A1)

`artifactRoots()` returns the realpath of each of:
`join(os.homedir(), ".agent-browser", "tmp")` (default) and
`process.env.AGENT_BROWSER_SCREENSHOT_DIR` when set — the **same** env var the
`agent-browser` CLI honors (NOT a dashboard-invented `AGENT_BROWSER_TMP`).
Cached for the server lifetime; a root whose realpath throws (missing dir) is
dropped, not fatal. The function is the extension point for future tool artifact
dirs.

**Residual gap (A1):** `agent-browser --screenshot-dir <path>` (CLI flag) writes
elsewhere and is invisible to the server, so it stays uncovered. This change is
best-effort for the default + env-configured cases; the complete fix is Fix B
(inline transport). See proposal "Best-effort scope" + "Out of Scope".

### D2 — Raw route only

Only `/api/file/raw` serves the screenshot bytes. `/api/file/render` is
`.adoc`-only; `/api/file` returns text/JSON. Adding the artifact anchor to
those would widen reads with no use case. Keep it to `raw`.

### D3 — Image-only gate on the artifact anchor

A path allowed *solely* by layer ③ must have an extension in `IMAGE_EXTS`. A
non-image artifact path (logs, HAR, traces) under the artifact root is NOT
served — it has no preview use case and would needlessly widen the global root.
Paths that also satisfy ①/② keep full type behavior (they are repo files).

### D4 — Real-path containment

`within(realpath(resolved), realpath(root))`. Resolving both sides defeats `..`
traversal and symlink escape: a symlink under the artifact root pointing at
`~/.ssh/id_rsa` resolves outside the root and fails containment (and also fails
D3's image gate). Logical-path containment alone would be insufficient for a
global root.

### D5 — Session-cwd gate unchanged

The request still carries a real session `cwd` (the overlay passes the current
session's cwd; only `path` is the absolute artifact). The existing
`allSessions.some(s => s.cwd === cwd)` check stays — artifact roots are an extra
*path* anchor, never a way to bypass the session check.

### D7 — `realpath` ordering for a missing artifact (A3)

Layer ③ calls `realpath(resolved)`, which throws if the file does not exist
(e.g. a deleted screenshot). Containment MUST NOT surface that as a 500. The
guard SHALL treat a realpath/ENOENT failure during the artifact-anchor check as
"not contained by this anchor" and fall through; the subsequent `fs.stat` then
produces the normal 404 `"not found"`. Net: missing artifact → 404, never 500.

### D6 — Error string unchanged

A rejected artifact path keeps `"path outside working directory"`. No new error
vocabulary; the overlay's existing failure handling is unaffected.

## Risks

| Risk | Mitigation |
|------|------------|
| Global root crosses repo trust boundary | D3 image-only + D4 realpath + same-user + ephemeral tool dir |
| `..` / symlink escape out of the artifact root | D4 realpath both sides |
| Future artifact dirs hardcoded | D1 allowlist function + env override is the single extension point |
| Drift from git-root helper | Reuse the parameterized `isAllowed(resolved,{anchors})`; artifact roots are just extra anchors + an image predicate for layer ③ |

## Alternatives considered

- **Fix B — inline the screenshot** so no path-link exists. Cleaner root cause
  but a transport change in the `browser` skill / tool-result rendering, out of
  scope here (see proposal). Complementary, not exclusive.
- **Serve artifacts from a dedicated `/api/artifact` route** instead of
  overloading `/api/file/raw`. Rejected: the overlay already targets `raw` for
  images; a parallel route duplicates Range/Content-Type/caching logic for no
  gain. One anchor added to one route is smaller.
