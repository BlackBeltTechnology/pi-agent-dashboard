# Lazy terminal + diff bootstrap

> **Split out of `add-served-build-coherence-and-hash-parity` during planning.**
> Doubt-review showed the lazy half needs four more call sites and a Vite chunk
> split than the fork diff touches, so it stands on its own. Planning is complete:
> `design.md`, `specs/`, `test-plan.md`, and `tasks.md` are drafted and have been
> through two doubt-review cycles (single- + cross-model).

## Why

The cold landing import graph eagerly reaches terminal and diff code.
`packages/client/vite.config.ts:85-107` `manualChunks` splits `@xterm/*` and
`@git-diff-view/*` into separate files, but **a manual chunk is not a lazy
boundary** — the chunk stays in the entry's static import graph. The fork
measured ~2.3 MB of root JS transfer before any chat renders, and a 16.6 s LCP
under Fast-3G + 4× CPU throttling (TTFB 3 ms, render delay 16.555 s). That
measurement is from the fork; it must be re-taken on `develop` before and after.

**Verified reach on current `develop`** — the cold graph touches both feature
families through **seven** static edges (six rows below; the `App.tsx` row is two
call sites), not the three the fork's diff patched:

| Edge | Site |
|---|---|
| terminal | `EditorPane.tsx:33` → `TerminalPaneLayer` |
| terminal | `ChatView.tsx:55` → `InlineTerminalCard.tsx:7` → `TerminalView` → `@xterm/*` |
| diff | `App.tsx:14` → `FileDiffView`, used at **two** sites (`:2157` and `:2493` `shellRenderers.renderDiff` → `ShellContent`) |
| diff | `pseudo-tab-registry.tsx` → `DiffViewer` |
| diff | `tool-renderers/EditToolRenderer.tsx:6` → `RichDiff` → `@git-diff-view/*` |
| diff | `lib/util/lineDelta.ts:11` (`structuredPatch` from npm `diff`), reached from `ChatView.tsx` |

The last row is load-bearing: `vite.config.ts:96-102` puts the npm `diff` package
**and** `@git-diff-view/*` in one `diff` chunk, so a single eager `structuredPatch`
import preloads the entire git-diff-view family. The chunk must be split before
any lazy boundary can pay off.

**CSS rides along.** A build of `develop` emits `dist/index.html` with eager
`<link rel="stylesheet">` for **both** `diff-*.css` and `xterm-*.css`, next to the
`modulepreload` for `diff-*.js` and `xterm-*.js`. `TerminalView.tsx:7` /
`InlineTerminalCard.tsx:5` import `@xterm/xterm/css/xterm.css` and
`RichDiff.tsx:11` imports `@git-diff-view/react/styles/diff-view.css`, so the
stylesheets are cold-landing transfer too. The guard must cover CSS, not just JS.

**Persisted tabs defeat a naive gate.** `use-terminal-pane-tabs.ts:53-57` keeps
persisted `term:<id>` tabs across a reload (cold-load guard: an empty live set
drops nothing), and `FolderEditorView.tsx:52` passes `autoSurfaceTerminals`, so
"any terminal tab open" is already true at first render for a reloaded session and
for every folder pane. The terminal gate is therefore **sticky-on-first-activation**,
not "a tab exists". And because auto-surface currently *activates* the tab it
opens (`use-terminal-pane-tabs.ts:154` → `editor-pane-state.ts:127` defaults
`activate: true`), the folder pane needs that dispatch to open in the background
before an activation gate means anything.

## What Changes

- Split npm `diff` out of the `diff` manual chunk so jsdiff usage on the chat path
  does not drag `@git-diff-view/*` into the entry graph.
- Lazy boundaries on every edge above, each gated on its surface being open:
  terminal layer (gated on open terminal tabs), inline terminal card, both
  `FileDiffView` call sites (route-local suspense at each — the
  `shellRenderers.renderDiff` callback needs its own boundary or suspension
  escapes into the shell), the `diff` pseudo-tab entry, and `RichDiff` inside the
  edit tool renderer.
- Auto-surfaced terminal tabs open in the **background** (`activate: false`) so a
  folder pane no longer focuses a terminal the user did not ask for. The one
  deliberate user-visible change; the tab is still opened and unread-badged.
- Contract seams preserved: terminal keep-alive (one mount per terminal id,
  hidden not unmounted, no reconnect on tab switch — note `EditorPane.tsx:336`
  currently renders `TerminalPaneLayer` **unconditionally** and the layer
  self-nulls, so the gate is new mount lifecycle and must be tested, not assumed)
  and the viewer-registry cycle boundary (`viewer-registry.tsx` / `CappedViewer.tsx`
  never import a pseudo-tab viewer).
- A build-output guard beside the existing Monaco/Markdown chunk-size guards:
  the cold-landing `index.html` neither module-preloads nor stylesheet-links the
  `xterm` or git-diff-view chunks (JS **and** CSS), **and** both chunks still
  exist for their feature routes.

## Capabilities

### Added Capabilities

- `lazy-feature-bootstrap` — terminal and diff feature code SHALL NOT be part of
  the cold-landing dependency graph; it loads when its surface opens, without
  changing the terminal keep-alive contract or the viewer-registry cycle boundary.

## Impact

**Code** — `packages/client/vite.config.ts`, `src/App.tsx`,
`src/components/editor-pane/EditorPane.tsx`,
`src/components/editor-pane/pseudo-tab-registry.tsx`,
`src/components/chat/ChatView.tsx`,
`src/components/tool-renderers/EditToolRenderer.tsx`,
`src/components/split/SplitWorkspaceContext.tsx` (the activation latch — it must
outlive `EditorPane`, which `SplitWorkspace.tsx:128` unmounts when the pane is
collapsed), `src/lib/layout/use-terminal-pane-tabs.ts` (background auto-surface),
and the `lineDelta` call path.

**Tests** — editor-pane keep-alive (mount once / hide on switch / unmount on
close), retained viewer-registry partition + DiffViewer resolution tests, a new
cold-landing preload guard, updates to existing synchronous render tests that now
see a Suspense fallback, and a re-measurement of root JS transfer and LCP on
`develop` before and after.

**Risk** — two contract-heavy seams. The **viewer-registry cycle** boundary IS
pinned by existing partition tests that must stay green. The **terminal
keep-alive** contract is **not** — a repo search finds no test that mounts
`TerminalView` or `TerminalPaneLayer`; `use-terminal-pane-tabs.test.ts` covers
only the pure reconcile planner. The keep-alive tests this change writes are its
first safety net, so they are load-bearing, not regression insurance.

## Discipline Skills

- **`performance-optimization`** — the whole change targets a measured budget;
  re-measure on `develop` before and after, and pin the preload property the
  measurement depends on with the build-output guard.
- **`review-code`** — two contract-heavy seams across ≥3 React components.
