## Context

Two independent markdown-image pipelines exist:

1. **Chat / assistant messages** — the bridge (`packages/extension/src/markdown-image-inliner.ts`)
   scans `![alt](localpath)` tokens, reads the file, SHA-256 hashes the bytes, rewrites the
   token to `![alt](pi-asset:<hash>)`, and ships bytes out-of-band via `asset_register`.
   The client `PiAssetImg` override resolves the hash from `SessionAssetsContext` to a
   `data:` URL. Works.

2. **File preview of a `.md`** — `MarkdownPreview.tsx` fetches text via `/api/file` and hands
   the raw string to `MarkdownContent` with **no directory context**. A relative `src` reaches
   `PiAssetImg`'s fall-through branch as `<img src="hero-landing.png">`; the browser resolves it
   against the dashboard origin (`http://localhost:8000/hero-landing.png`), 404s, and shows the
   native broken-image glyph. This is the bug.

The server already exposes `/api/file/raw?cwd=&path=` which serves image/pdf bytes gated by
(known-session cwd + `isAllowed` containment against `[cwd, ~/.pi]` + a layer-③ image-only
artifact-root anchor). A sibling image under the session cwd is already a supported, contained
request shape. So the fix is client-only.

## Goals / Non-Goals

**Goals**
- Embedded local images in on-disk markdown preview load instead of 404ing.
- Reuse the existing hardened `/api/file/raw` endpoint — zero server change.
- Leave chat/thinking surfaces (the `pi-asset:` path) untouched.

**Non-Goals**
- No change to the bridge inliner or the `pi-asset:` scheme.
- No server-side markdown→HTML rendering (would lose mermaid/KaTeX/lightbox/copy/frontmatter).
- No new asset transport, caching layer, or size caps for previews.

## Decisions

### D1 — Base-path rewrite in the client (chosen over inliner reuse / server render)

Add an opt-in `imageBase?: { cwd: string; dir: string }` prop to `MarkdownContent`. In
`PiAssetImg`, before the fall-through `<img>`, when `imageBase` is set and the `src` is a local
path (not `http(s):` / `data:` / `blob:` / `pi-asset:` / fragment), rewrite to
`rawUrl({ cwd, path: <resolved> })`.

- **Rejected — reuse the bridge inliner server-side**: it is streaming- and session-scoped,
  drags 5 MB/20 MB caps into a static preview, and needs an asset channel the preview lacks.
- **Rejected — server renders md→HTML with rewritten srcs** (AsciiDoc/Docx pattern): loses the
  React interactivity (mermaid, KaTeX, lightbox, copy buttons, frontmatter panel).

### D2 — "Local src" detection is scheme-absence, not a denylist (revised)

Rewrite only when the `src` is a genuine local path. A denylist ("not http(s)/data/blob/pi-asset/fragment")
leaks: protocol-relative `//cdn/x.png`, `file:`, `cid:` (email-derived md), and Windows drive-letter
`C:/…` would all be mis-rewritten. Instead treat a src as local **iff**:

- it does NOT match a URI scheme prefix `/^[a-z][a-z0-9+.-]*:/i` (covers `http:`, `data:`, `blob:`,
  `pi-asset:`, `file:`, `cid:`, `mailto:`, and Windows `C:` — a bare drive letter is a 1-char scheme,
  so `C:/…` is left verbatim, which is correct: a Windows-absolute src in authored md is out of scope), **and**
- it does NOT start with `//` (protocol-relative), **and**
- it does NOT start with `#` (fragment).

`pi-asset:` is still handled by its own branch FIRST (unchanged). rehypeRaw is enabled, so raw HTML
`<img>` blocks also reach this override — desirable; the same guard applies.

### D2b — Path resolution is browser-safe POSIX (no `node:path`)

Repo convention forbids `node:path` in client code (`link-origin.ts` is the lone exception and says so;
`MarkdownViewer` uses `absOf = (cwd, rel) => \`${cwd}/${rel}\``). Resolve with a small browser-safe POSIX
helper: join `dir` + relative src, then collapse `.`/`..` segments over `/`. A **local-absolute** POSIX src
(`/w/media/x.png`) is used verbatim (not re-joined). URL-encode the resolved path into the `path` query
param (`rawUrl` already `encodeURIComponent`s it). Server cwd is host-native; Windows/Electron cwds are a
known non-target (see Risks) — the resolver assumes POSIX separators, matching the existing `absOf`.

### D3 — Load failure → neutral placeholder, scoped to the REWRITTEN path only (revised)

`<img>.onError` exposes no HTTP status, so it cannot distinguish out-of-cwd (403), missing file (404),
and transient network failure. The placeholder text is therefore **neutral** — "couldn't load image" —
not "outside workspace". Styled like, and as **non-interactive** as, the dashed `pi-asset:` placeholder.

**Scope (load-bearing, prevents a chat regression):** the `onError`→placeholder applies ONLY to the
locally-rewritten `<img>`. The verbatim fall-through branch of `PiAssetImg` is shared by chat
(`imageBase` null) for external/`data:`/`blob:` images and has pinned tests asserting a broken hotlink
still click-opens the lightbox. That branch keeps its current behavior unchanged — no `onError` added
there. Track "was this rewritten?" so only the rewrite path swaps to the placeholder.

**Swap, don't hide-in-place (S2):** on error, conditionally render the placeholder *instead of* the
`<img>` (unmount the img) so the `reserveStyle` `minHeight:6rem` reservation dies with the img rather
than leaking as a blank 6rem gap (`releaseReserved` only fires on `onLoad`).

### D4 — Opt-in call-sites: the surfaces that already carry `cwd`+`path` (revised)

Only surfaces that render a markdown FILE from disk AND already have `cwd`+`path` in scope pass `imageBase`:

- `FilePreviewOverlay.tsx` — the **primary** "open a .md" modal (already hand-rolls `/api/file/raw` for
  its own image branch; `MarkdownContent` at the `.md`/`.mdx` case).
- `MarkdownViewer.tsx` (editor pane) — has `cwd`+`path`, renders `MarkdownContent` in preview mode.
- `MarkdownPreview.tsx` — the `PreviewCard`/`/view` dispatch path; has `target.cwd`+`target.path`.

Each derives `dir` via the browser-safe helper (`absOf(cwd, dirname(path))`). Chat and thinking surfaces
pass nothing and keep the `pi-asset:` path.

**Out of scope (known limitation):** `MarkdownPreviewView` has no `cwd`/`path` prop, so the README / spec /
skill dialogs and `PackageReadmeDialog` / `WhatsNewDialog` it hosts cannot supply `imageBase` without a
caller-threading refactor. Those surfaces keep today's behavior; local images there stay unresolved. Not
regressed by this change; a follow-up can thread `cwd`/`path` if warranted.

### D5 — Deliver `imageBase` via a memoized context, not a per-render closure

`PiAssetImg` is module-scoped and consumes `useSessionAssets()`. Threading `imageBase` through an inline
`components.img` closure would rebuild the `components` object every render and risk ReactMarkdown dropping
img-subtree memoization (remount / lost lightbox state). Instead deliver it the same way as session assets:
a small `ImageBaseContext` (default `null`) that `MarkdownContent` provides when the prop is set and
`PiAssetImg` reads via a hook. **The provider `value` MUST be `useMemo`'d** (`[cwd, dir]`) so a re-render
doesn't re-allocate `{cwd,dir}` and re-render every image. Absent provider → `null` → verbatim fall-through
including the **old error behavior** (no placeholder) — exactly today's chat path.

The rewrite URL MUST reuse `rawUrl({ kind:"file", cwd, path: resolved })` from `raw-url.ts` (it already
`encodeURIComponent`s both params) — no new encoder. A new browser-safe `dirname(path)` helper is needed
(only `basename` exists today, in inline copies): `p.slice(0, p.lastIndexOf("/"))`, returning `""` for a
bare filename; the POSIX resolver (D2b) must insert the boundary `/` and dedupe `//` (an `absOf` cwd with a
trailing slash yields `cwd//dir`).

## Risks / Trade-offs

- **Security**: relies entirely on the pre-existing `/api/file/raw` containment gate; no new
  server behavior. One honest caveat: the rewrite turns markdown into a **file-existence oracle**
  within the session cwd (200 vs 404 vs 403 is observable via the placeholder). This is bounded by
  the same containment as any existing preview and is acceptable; noting it corrects the earlier
  "no new attack surface" overstatement.
- **Global-scope markdown** (`~/.pi/agent` files served via `/api/file/md-read`, no live session cwd)
  cannot pass a session-cwd `imageBase`; images there would 403. Those surfaces are out of scope (D4).
- **Windows/Electron cwds**: the POSIX resolver (D2b) assumes `/` separators, matching the existing
  `absOf`. A Windows-native cwd threaded into these previews is a non-target; per-OS QA covers regressions.
- **One reflow per image**: the existing `reserveStyle`/`releaseReserved` height reservation in
  `PiAssetImg` already covers the rewritten `<img>`; no new scroll-shift risk.

## Migration Plan

Additive and backward-compatible. `imageBase` is optional; existing call-sites that omit it are
unchanged. Ship in one change; no data migration.

## Open Questions

None blocking. Cross-model review (glm-5.2, propose-review-1) drove D2/D2b/D3/D4/D5: it caught the
mis-named surfaces (FilePreviewOverlay + editor MarkdownViewer are the real hosts; MarkdownPreviewView
has no cwd/path), the leaky scheme denylist, the `node:path`-in-browser convention, the un-distinguishable
`onError`, and the closure-vs-context delivery. All folded above.
