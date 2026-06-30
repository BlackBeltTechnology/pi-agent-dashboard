## Context

The dashboard exposes file paths from agent tool calls (`Edit`, `Write`, `Read`, `MultiEdit`) via `OpenFileButton` components rendered next to each tool card. Today the button only appears when a native editor (e.g. Zed) is detected on the host; clicking dispatches to the native app via `openEditor(cwd, editor.id, filePath, line)`. The `editor-view` capability covers the heavier alternative — code-server proxied through `/editor/:id/*` — but its iframe is a monolith: the file tree and content editor cannot be separated as independent dashboard viewparts, and each folder spawns its own process.

The common user need — "let me glance at what the agent just wrote into `src/foo.ts` without leaving the chat" — is not well-served by either path. A lightweight in-dashboard pane with Monaco for syntax highlight (no LSP), tabs for multi-file viewing, and per-kind renderers for images/PDFs/markdown fills the gap. The pane lives next to (or in place of) the chat for the same selected session.

This change establishes v1: a read-only viewer that ships behind a route, mirrors the existing `FileDiffView` content-area-takeover pattern, and shares its component tree with the future v2-v4 phases (pin-to-split, create-file, edit-with-conflicts). Decisions here are made with v2-v4 in mind so the v1 component tree does not need restructuring later.

## Goals / Non-Goals

**Goals:**

- Provide a read-only multi-tab file viewer scoped per session, opened by clicking `OpenFileButton` on any tool card or by URL (`/session/:id/editor?file=...`).
- Render text/code via Monaco with syntax highlight; render other displayable kinds (image, PDF, markdown) via dedicated viewers.
- Lazy-load Monaco only on first text-file open; cap the language bundle to a curated allowlist.
- Persist open tabs, active tab, and tree state in `localStorage` keyed by session id; survive page reload and dashboard restart.
- Make `OpenFileButton` a split button: default click → internal pane; dropdown → detected native editors.
- Classify file kinds via a shared pure module so server and client agree on viewer selection without round-trip discrimination.
- Reuse the existing `FileDiffView` content-area-takeover pattern so v1 introduces zero new layout primitives.
- Structure component boundaries so v2 can lift the pane into a split layout, and v3/v4 can introduce a write path, with **no v1 refactor**.

**Non-Goals:**

- **No editing.** v1 is strictly read-only. No save button, no dirty buffers, no mtime tracking.
- **No file creation.** The "+ new tab" affordance is deferred to v3.
- **No side-by-side layout.** The pane replaces `ChatView` in the content area; "split with chat" is deferred to v2.
- **No LSP / IntelliSense.** Syntax highlight only; Monaco's built-in TS lib services are not enabled.
- **No cross-file search.** The agent is the search tool for v1.
- **No file watcher.** External changes (e.g. agent edits a file while it's open) require a manual refresh in v1. v4 will piggyback on tool events.
- **No server-side persistence.** Open tabs are client-only; switching browsers/devices does not carry state.
- **No new pane types beyond Monaco/image/PDF/markdown.** Hex viewer for binary files is out-of-scope; binary files render a "this file is binary — open externally" notice.
- **No plugin slot for custom viewers.** The viewer registry is internal-only in v1; plugin contributions are a future possibility but not designed here.

## Decisions

### 1. Route-based content-area takeover (Shape A), not in-card split (Shape B)

**Decision:** v1 mounts `EditorPane` at a new route `/session/:id/editor?file=<rel>&line=<n>` and renders it inside the same content area that today renders `ChatView` / `FileDiffView` / `MarkdownPreviewView`. The pane replaces `ChatView` while active; a back button (mirroring `FileDiffView`'s) returns to chat.

**Why:** Three reasons.

1. **Pattern reuse.** The codebase already has a battle-tested takeover pattern (`FileDiffView`, `MarkdownPreviewView`, `OpenSpecPreview`, `PiResourcesView`). Route is wouter; back is `goBack()`. Zero new layout work.
2. **Mobile-first.** The dashboard supports mobile via `MobileShell`. Side-by-side does not work on narrow screens. A route-based view degrades naturally.
3. **Decoupling v1 from v2 layout work.** The split-layout work (resizable splitter, persisted split fraction, mobile fallback) is substantial. Doing it in v1 risks the read-only viewer slipping behind UI plumbing.

**Trade-off:** Users cannot watch the chat and view a file simultaneously in v1. This is the explicit ask: read-only viewer first, layout later.

**Alternatives considered:**

- **Side-by-side from day one.** Rejected: bundles two distinct deliverables (viewer + split layout) into one change, multiplying risk and review surface. The same `EditorPane` component lifts cleanly into a split in v2.
- **Modal / overlay.** Rejected: modals block chat interaction without showing it, gaining none of side-by-side's benefits while losing the focused-route URL.

### 2. Shared file-kind classifier (`packages/shared/src/file-kind.ts`)

**Decision:** Add a pure function `fileKind(absPath: string, sniff?: Buffer | string): { kind, mimeType, viewer, editable }`. The server invokes it inside `/api/file` and returns the result. The client invokes it (without `sniff`) on file paths in tool args before issuing the read, to pick the tab component eagerly.

Discrimination strategy (first match wins):

1. Extension on a curated **text/code allowlist** (`.ts .tsx .js .jsx .json .md .py .go .rs .yaml .yml .html .css .sql .sh ...`) → `viewer: "monaco"`.
2. Extension on the **image allowlist** (`.png .jpg .jpeg .gif .webp .svg`) → `viewer: "image"`.
3. `.pdf` → `viewer: "pdf"`.
4. `.md` / `.mdx` → `viewer: "markdown"` (overrides #1's Monaco for these specifically).
5. If `sniff` provided and contains a NUL byte in the first 1024 bytes → `kind: "binary"`, `viewer: "binary-warn"`.
6. Otherwise → `viewer: "monaco"` (assume text).

`editable: false` always in v1. v3/v4 will flip this for the writable subset.

**Why:** Single source of truth that both ends agree on. Sniffing only on the server avoids shipping arbitrary file bytes to the client just to classify; the client's eager classification is best-effort by extension only.

**Alternatives considered:**

- **MIME-detection library (`file-type`, `mime-types`).** Rejected for v1: adds dependency weight for a handful of extensions. The curated allowlist is intentionally narrow — Monaco gracefully degrades to plain text for unrecognized extensions inside the allowlist.
- **Server returns viewer choice authoritatively, client doesn't classify.** Rejected: forces a `/api/file` round-trip before the client can even decide which tab component to mount. Eager extension-based classification lets the tab show a loading skeleton in the right shape.

### 3. Per-session client state in `localStorage`

**Decision:** `EditorPane` state — `{ openFiles, activeIndex, treeOpenRoots }` — lives in a `useEditorPaneState(sessionId)` hook backed by `localStorage` under key `pi-dashboard:editor-pane:<sessionId>`. The hook is the single read/write point; no server persistence.

State shape:

```ts
type EditorPaneState = {
  openFiles: Array<{
    path: string;            // relative to session cwd
    viewer: ViewerKind;
    addedAt: number;         // for stable tab ordering
  }>;
  activeIndex: number;
  treeOpenRoots: string[];   // expanded directory rel-paths
};
```

**Why:** Cross-device sync was explicitly de-prioritized. `localStorage` handles reload + restart. The state shape is small (paths + ints), well under quota even with 50 tabs across 20 sessions.

**Trade-off:** Switching browser profiles loses state. Acceptable per the user's decision.

**Alternatives considered:**

- **Server-side persistence in `.meta.json`.** Rejected for v1: solves only the cross-device case the user explicitly de-prioritized. Easy to add later as a v5 if/when cross-device becomes important.
- **`sessionStorage`.** Rejected: doesn't survive tab close, which fails the "survives reload" requirement.
- **React state only (no persistence).** Rejected: loses state on every reload, including dashboard restarts triggered by `/api/restart` after server edits.

### 4. Monaco lazy-load with curated language bundle

**Decision:** Use `@monaco-editor/react` with a Vite `lazyImport`-driven chunk. `MonacoBuffer.tsx` is a `React.lazy` boundary; the chunk is fetched on first text-file open. The Monaco language workers are configured to ship only the allowlisted languages (TS/JS/JSON/MD/Python/Go/Rust/YAML/HTML/CSS/SQL/Shell — ~12 languages). Targeted gzipped chunk size budget: **≤ 2 MB**.

**Why:** Monaco is large (~5 MB unminified base + workers). Eager-loading punishes every user; >90% will never open the pane. Lazy gates the cost on first text-file open. The curated language list trims the chunk by dropping languages we don't need (Apex, PowerShell, Pascal, etc.).

**Trade-off:** First-open latency is ~1-3 seconds depending on network. Acceptable — the pane is opened by an explicit user click.

**Implementation note:** Use Vite's worker integration (`?worker`) to bundle Monaco's editor/language workers as separate chunks under the same lazy boundary. CI build adds a size guard: warn at >2 MB gzipped, fail at >3 MB.

**Alternatives considered:**

- **CodeMirror 6.** Rejected: smaller bundle but the user explicitly asked for "lightweight Monaco" by name; familiarity with Monaco UX (command palette, multi-cursor, find widget) is a feature.
- **Plain `<pre>` + Prism (already shipping for chat code blocks).** Rejected: no editing affordances in v3/v4, no folding, no minimap, no find. We'd end up replacing Prism with Monaco anyway when v4 arrives.
- **Eager Monaco.** Rejected: punishes 100% of users for a feature most never use.

### 5. `OpenFileButton` becomes a split button

**Decision:** Replace today's single-action `<button>` with a split control:

- **Default action** (click body): open in internal pane.
- **Dropdown** (caret affordance): list detected native editors as alternates, fall back to "no native editor detected" hint.

When no native editor is detected, the dropdown is hidden and the button is a plain "Open" — strictly better than today (which hides the button entirely without a native editor). When the user clicks "Open in Zed" in the dropdown, the existing `openEditor(...)` flow runs unchanged.

**Why:** Matches the user's "default internal, dropdown alternates" instruction. Preserves all today's native-editor handoffs as opt-in.

**Trade-off:** Long-time users who relied on the button always meaning "Zed" will see behavior change. Mitigation: dropdown is one click; no functionality is removed. Optional follow-up: a per-user pref to invert the default ("native editor primary").

**Alternatives considered:**

- **Dual buttons side-by-side (`[Internal] [Zed]`).** Rejected: doubles the tool-card footprint for every Edit/Write/Read card. Split button is one control width.
- **Right-click → context menu.** Rejected: invisible affordance on mobile and discoverable only by power users.

### 6. Viewer registry, not a giant switch

**Decision:** Tab content rendering goes through a registry:

```ts
const viewerRegistry: Record<ViewerKind, React.ComponentType<ViewerProps>> = {
  monaco: MonacoBuffer,
  image: ImageViewer,
  pdf: PdfViewer,
  markdown: MarkdownViewer,
  "binary-warn": BinaryWarn,
};
```

`EditorTabs` resolves the component per active tab via `viewerRegistry[tab.viewer]`. Each viewer takes a uniform props contract: `{ cwd, path, kind, mimeType, size }`.

**Why:** Keeps `EditorPane` agnostic of viewer specifics. Adding a new viewer in v2-v4 (e.g., hex viewer, diff viewer for "before vs current") is a registry insertion, not an `if` chain mutation. Tests can mock a viewer trivially.

**Trade-off:** Slightly more indirection than a `switch (kind)`. Worth it for the seam — registries are the explicit extension point if v5+ wants plugin-contributed viewers.

### 7. Full theme inheritance via a theme derived from dashboard tokens

**Decision:** The Monaco pane inherits the dashboard's active named theme (`base / dracula / nord / github / catppuccin / tokyo-night / rose-pine / solarized / gruvbox`) AND light/dark mode — not just built-in `vs` / `vs-dark`. v1 derives a Monaco `IStandaloneThemeData` at runtime from the active theme's CSS-variable token map and registers it via `monaco.editor.defineTheme()` + `setTheme()`.

New helper `packages/client/src/lib/monaco-theme.ts` exporting `buildMonacoTheme(themeName: string, resolved: "light" | "dark"): { name: string; data: IStandaloneThemeData }`. It reads the same `getTheme(themeName)` token map the rest of the client consults (`packages/client/src/lib/themes.ts`) and maps:

- **Editor UI colors** (`colors` field) from the dashboard tokens — `editor.background` ← `--bg-code`, `editor.foreground` ← `--text-primary`, `editorLineNumber.foreground` ← `--text-muted`, `editorLineNumber.activeForeground` ← `--text-secondary`, `editor.selectionBackground` ← `--bg-selected`, `editor.lineHighlightBackground` ← `--bg-hover`, `editorCursor.foreground` ← `--text-primary`, `editorIndentGuide.background` ← `--border-subtle`, gutter/widget/scrollbar surfaces ← `--bg-secondary` / `--bg-surface` / `--border-primary`.
- **Token (syntax) rules** (`rules` field) from the accent palette — `keyword` ← `--accent-purple`, `string` ← `--accent-green`, `number` ← `--accent-orange`, `comment` ← `--text-tertiary` (italic), `type` ← `--accent-blue`, `function` ← `--accent-blue`, `variable` ← `--text-primary`, `constant` ← `--accent-orange`, `regexp` ← `--accent-red`, `delimiter`/`operator` ← `--text-secondary`. The same accent-to-role mapping the prism layer already uses, so Monaco and the chat code blocks read as one palette.
- **Base** = `vs-dark` when `resolved === "dark"`, else `vs`, so any unmapped Monaco scope falls back to a sane default of the right polarity.

Resolution requires concrete hex/rgb values, not `var(--token)` indirection (Monaco renders to canvas, cannot read CSS vars). `base` theme tokens are not in the inline-override map (`applyThemeVars` strips them so CSS `:root` drives the page) — so `monaco-theme.ts` reads from the `THEMES` registry's `base` entry directly, which holds the concrete `:root` values, rather than from computed styles.

`MonacoBuffer` consumes `useTheme()` (`{ resolved, themeName }`); a `useEffect` keyed on both re-runs `defineTheme` + `setTheme` whenever the user switches theme or mode, so an open pane recolors live alongside the rest of the dashboard. Theme name is stable (`pi-monaco-<themeName>-<resolved>`) so repeated `defineTheme` calls are idempotent.

**Why:** The dashboard ships nine curated themes and the user expects the editor to match the chrome it sits inside, exactly like `DiffPanel` / `RichDiff` already route the active theme into `@git-diff-view`. Built-in `vs` / `vs-dark` alone would make the pane the one surface that ignores the chosen theme — a jarring inconsistency on every non-base theme.

**Trade-off:** A per-theme token-to-scope mapping is more code than a two-line `vs` / `vs-dark` switch, and Monaco's TextMate scopes are coarser than prism's, so syntax coloring is an approximation, not a pixel match to the chat blocks. Accepted: one shared `monaco-theme.ts` keeps the mapping in a single tested place, and approximate-but-themed beats exact-but-off-theme.

**Alternatives considered:**

- **Built-in `vs` / `vs-dark` only (light/dark sync, no named-theme inheritance).** Rejected: leaves the pane visibly off-theme under dracula/nord/etc. — the inconsistency the user flagged.
- **Pre-author nine static Monaco theme JSON files.** Rejected: duplicates the token values already in `themes.ts`; drifts when a theme's tokens change. Deriving from the single source keeps them in lockstep.
- **Inject CSS variables into Monaco via `editor.background: 'var(--bg-code)'`.** Rejected: Monaco's theme API takes concrete colors only; CSS-var strings are not honored by the canvas renderer.

### 8. Pane mount in App.tsx, not inside SessionCard

**Decision:** The pane mounts in `App.tsx`'s content-area routing block, parallel to `FileDiffView` / `MarkdownPreviewView` / `OpenSpecPreview`. It does NOT live inside `SessionCard.tsx`.

**Why:** `SessionCard` is the sidebar card showing session metadata + subcards (OPENSPEC/WORKSPACE/PROCESS/MEMORY/FLOWS). The content area is where the per-session main view lives. Putting the pane inside `SessionCard` would either bury it in a tiny inset or duplicate the content-area concept. The content area is the right home.

**Trade-off:** Slight mismatch with the user's phrasing ("opened in Session card"). Clarified in design: "session card" in the user's mental model maps to the content area for the selected session, not the literal `SessionCard.tsx`. v2's pin-to-split will land in the same content area, just side-by-side with `ChatView`.

## Migration & Rollout

- **No data migration.** New `localStorage` key (`pi-dashboard:editor-pane:<sessionId>`); absent keys = empty state. No existing key is touched.
- **No server-side migration.** New optional response fields on `/api/file`; old client gracefully ignores them.
- **Feature flag?** Not in v1 — the route only renders when explicitly navigated to, and `OpenFileButton`'s dropdown only changes default action. Users who don't click into the pane see no behavior change. If the bundle size or first-open latency proves problematic in real use, a later change can add a config flag to revert to "native-editor-only" default.

## Open Questions (for tasks-time clarification)

1. **PDF viewer implementation.** `<object data=...>` is the simplest, browser-native. `react-pdf` is more reliable across browsers but adds ~1 MB. v1 should ship `<object>` and let v2-or-later upgrade if needed. Decision: ship `<object>` for v1, mark `react-pdf` as a known future improvement in `BinaryWarn` if PDF rendering fails.
2. **Markdown viewer reuse.** `packages/client/src/components/MarkdownContent.tsx` is the project's canonical markdown renderer. The pane's `MarkdownViewer.tsx` should be a thin wrapper around it, ensuring `pi-asset:` image URLs in agent-authored markdown resolve through `SessionAssetsContext`. Decision: wrap, don't fork.
3. **Tab close UX.** Standard "×" on hover, middle-click closes, Ctrl/Cmd-W keyboard shortcut. No "are you sure?" prompt — v1 is read-only so no unsaved changes are possible. v4 will add a dirty-state prompt.
4. **Mobile behavior.** Same route, same component tree. Tabs scroll horizontally; tree rail collapses by default; viewer fills remaining width. No special mobile component. Confirmed acceptable per `MobileShell` patterns.
5. **Theme / color-scheme inheritance.** Resolved in Decision 7: the pane inherits the dashboard's active named theme + light/dark mode via a Monaco theme derived from the `themes.ts` token map (`monaco-theme.ts` + `buildMonacoTheme`). Not deferred. The non-Monaco viewers (image / PDF / markdown / binary-warn) already inherit the dashboard's Tailwind theme through normal CSS and need no special handling.

## References

- Existing content-area-takeover precedent: `packages/client/src/components/FileDiffView.tsx`, `packages/client/src/components/MarkdownPreviewView.tsx`
- Existing file-read endpoint: `packages/server/src/routes/file-routes.ts` (`GET /api/file`)
- Existing native-editor handoff: `packages/client/src/components/tool-renderers/OpenFileButton.tsx`, `packages/client/src/lib/editor-api.ts`
- Existing code-server iframe (parallel feature, not modified): `openspec/specs/editor-view/spec.md`
- Existing path-traversal security model: `packages/server/src/routes/file-routes.ts` (cwd matched against known session paths + `path.resolve` startsWith check)
- Existing theme system: `packages/client/src/lib/themes.ts` (`THEMES` registry, `getTheme`, token maps), `packages/client/src/hooks/useTheme.ts` (`useTheme` → `{ resolved, themeName }`)
- Existing precedent for routing the active theme into a third-party editor: `packages/client/src/components/DiffPanel.tsx` / `RichDiff.tsx` (theme → `@git-diff-view`), `packages/client/src/lib/syntax-theme.ts` (`getSyntaxTheme(resolved, themeName)`)
