# Lazy terminal + diff bootstrap

> **Split out of `add-served-build-coherence-and-hash-parity` during planning.**
> Doubt-review showed the lazy half needs four more call sites and a Vite chunk
> split than the fork diff touches, so it stands on its own. Planning for this
> change is **not** complete — `design.md`, `specs/`, and `tasks.md` still need
> the `plan-proposal` pass (doubt-review + `scenario-design` + fold).

## Why

The cold landing import graph eagerly reaches terminal and diff code.
`packages/client/vite.config.ts:85-107` `manualChunks` splits `@xterm/*` and
`@git-diff-view/*` into separate files, but **a manual chunk is not a lazy
boundary** — the chunk stays in the entry's static import graph. The fork
measured ~2.3 MB of root JS transfer before any chat renders, and a 16.6 s LCP
under Fast-3G + 4× CPU throttling (TTFB 3 ms, render delay 16.555 s). That
measurement is from the fork; it must be re-taken on `develop` before and after.

**Verified reach on current `develop`** — the cold graph touches both feature
families through **seven** static edges, not the three the fork's diff patched:

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

## What Changes

- Split npm `diff` out of the `diff` manual chunk so jsdiff usage on the chat path
  does not drag `@git-diff-view/*` into the entry graph.
- Lazy boundaries on every edge above, each gated on its surface being open:
  terminal layer (gated on open terminal tabs), inline terminal card, both
  `FileDiffView` call sites (route-local suspense at each — the
  `shellRenderers.renderDiff` callback needs its own boundary or suspension
  escapes into the shell), the `diff` pseudo-tab entry, and `RichDiff` inside the
  edit tool renderer.
- Contract seams preserved: terminal keep-alive (one mount per terminal id,
  hidden not unmounted, no reconnect on tab switch — note `EditorPane.tsx:336`
  currently renders `TerminalPaneLayer` **unconditionally** and the layer
  self-nulls, so the gate is new mount lifecycle and must be tested, not assumed)
  and the viewer-registry cycle boundary (`viewer-registry.tsx` / `CappedViewer.tsx`
  never import a pseudo-tab viewer).
- A build-output guard beside the existing Monaco/Markdown chunk-size guards:
  the cold-landing `index.html` module-preloads neither the `xterm` nor the
  git-diff-view chunk, **and** both chunks still exist for their feature routes.

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
`src/components/tool-renderers/EditToolRenderer.tsx`, and the `lineDelta` call
path.

**Tests** — editor-pane keep-alive (mount once / hide on switch / unmount on
close), retained viewer-registry partition + DiffViewer resolution tests, a new
cold-landing preload guard, and a re-measurement of root JS transfer and LCP on
`develop` before and after.

**Risk** — two contract-heavy seams (terminal keep-alive single-mount, D3
viewer-registry cycle); both are pinned by existing tests that must stay green.

## Discipline Skills

- **`performance-optimization`** — the whole change targets a measured budget;
  re-measure on `develop` before and after, and pin the preload property the
  measurement depends on with the build-output guard.
- **`review-code`** — two contract-heavy seams across ≥3 React components.
