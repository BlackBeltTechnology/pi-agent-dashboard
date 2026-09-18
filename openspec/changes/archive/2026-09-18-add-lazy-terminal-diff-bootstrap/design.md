# Design — Lazy terminal + diff bootstrap

## Context

See `proposal.md` — Why, for the motivation and the measured budget. Design-level
state that shapes the approach:

- `packages/client/vite.config.ts:85-107` already splits `xterm` and `diff`
  manual chunks. **A manual chunk is not a lazy boundary** — Rollup still places
  the chunk in the entry's static graph and Vite emits a `<link rel="modulepreload">`
  for it in `index.html`. Chunking changes *packaging*, not *reachability*.
- The `diff` manual chunk lists `@git-diff-view/*` **and** the npm `diff`
  package together. `lib/util/lineDelta.ts:11` imports `structuredPatch` from
  npm `diff` on the always-hot chat path, and `tool-renderers/EditToolRenderer.tsx:2`
  imports `createTwoFilesPatch` the same way. Either import pins the whole chunk.
  So the chunk split is a **prerequisite**, not a nicety.
- `EditorPane.tsx:336` renders `<TerminalPaneLayer />` unconditionally; the layer
  self-nulls when `openTerminalIds(...)` is empty (`TerminalPaneLayer.tsx:23`).
  So "mount only when a terminal is in use" is a **new** lifecycle, not the
  current one.
- **"A terminal tab is open" is already true on landing** for two common cases:
  `use-terminal-pane-tabs.ts:53-57` deliberately preserves persisted `term:<id>`
  tabs across a reload (an empty live set means "snapshot not yet arrived", so
  nothing is dropped), and `FolderEditorView.tsx:52` passes
  `autoSurfaceTerminals` so every live cwd terminal gets a tab at mount. A gate
  on tab existence would therefore fetch xterm on landing for exactly those
  users. This drives D3.
- **Auto-surface also ACTIVATES.** `use-terminal-pane-tabs.ts:154` dispatches
  `openFile` without an `activate` flag, and `editor-pane-state.ts:127` defaults
  `activate` to `true`. So a folder pane with any live terminal lands with a
  terminal tab as the *active* tab — an activation-based gate would fire with
  zero user interaction. This drives D3a.
- **`EditorPane` unmounts while its state survives.** `SplitWorkspace.tsx:128`
  renders the editor only when `!isClosed`; collapsing the pane unmounts
  `EditorPane` while the provider and the persisted `paneState` live on. Any
  latch stored inside `EditorPane` would reset on collapse/reopen. This drives
  where D3's latch lives.
- **CSS is cold-landing transfer too.** A real build emits `dist/index.html` with
  eager `<link rel="stylesheet">` for `diff-*.css` and `xterm-*.css` beside the
  `modulepreload` for `diff-*.js` / `xterm-*.js`. Sources:
  `TerminalView.tsx:7`, `InlineTerminalCard.tsx:5`,
  `RichDiff.tsx:11`. Vite's `cssCodeSplit` (default on) should move these to
  async CSS once their JS importers are dynamic — that is an expectation to
  **assert**, not assume. This drives D5.
- `EditorPane.tsx:176` **already wraps** the pseudo-tab / `CappedViewer` body in a
  `<Suspense>` with a "Loading viewer…" fallback. The diff pseudo-tab therefore
  needs no new boundary — it inherits this one. Do not add a second.
- The viewer-registry cycle boundary (`viewer-registry.tsx` / `CappedViewer.tsx`
  never import a pseudo-tab viewer) **is** pinned by existing partition tests.
  The terminal keep-alive contract is **not**: no test in the repo mounts
  `TerminalView` or `TerminalPaneLayer`; `use-terminal-pane-tabs.test.ts` covers
  only the pure `reconcileTerminalTabs` planner. The keep-alive tests written
  here are the contract's first safety net, and must be authored before the gate
  changes, not after.
- Existing build-output guards (`src/__tests__/eml-bundle-exclusion.test.ts`,
  `monaco-chunk-size.test.ts`, `markdown-chunk-size.test.ts`) establish the
  pattern: parse `dist/index.html`, resolve the entry chunk, assert on
  `dist/assets`, and **skip when no build is present** so unit runs stay fast.

## Goals / Non-Goals

**Goals:**

- One async boundary per edge listed in the proposal, each gated on its surface
  being open, so the cold graph reaches neither feature family.
- A build-output guard that fails both ways: fails if either chunk is preloaded
  by the landing document, and fails if either chunk stops existing (no vacuous
  pass when a rename silently disables the assertion).
- Before/after measurement of root JS transfer + LCP taken on `develop`, not
  inherited from the fork.

**Non-Goals:**

- Shrinking the terminal or diff code itself, or replacing either library.
- Route-level code splitting of anything else (Monaco, markdown, mdi) — those
  already have their own boundaries and guards. In particular
  `react-syntax-highlighter` stays folded in the `markdown` chunk and is eager
  for the chat path regardless; deferring diff does not and need not move it.
- Changing terminal WS protocol or diff rendering output.
- User-visible behaviour changes, with **one deliberate exception** (D3a): a
  folder pane no longer auto-focuses an auto-surfaced terminal tab. The tab is
  still opened and is unread-badged; the previously active tab stays active.
  Accepted because without it the folder pane — a primary landing surface — can
  never leave the terminal chunk out of the cold graph.
- Deferring inline terminal cards until they scroll into view. Requirement 1 is
  scoped instead (see D3b); viewport-deferral is a separate change.

## Decisions

### D1 — Split npm `diff` out of the `diff` manual chunk, first

Move npm `diff` into its own chunk (e.g. `jsdiff`) — or fold it into the
existing `util` chunk — leaving `diff` to hold only `@git-diff-view/*`.

*Why:* `lineDelta.ts` and the mobile `HomegrownDiff` path legitimately need
jsdiff eagerly-ish; they are cheap. Keeping them in the same chunk as
`@git-diff-view/*` means no lazy boundary downstream can ever pay off, because
the chunk is already pinned. Splitting is the enabling step.

*Alternative rejected:* make `lineDelta` itself async. That pushes an await into
turn-summary computation on the hot chat path for a ~20 KB dependency — cost
without benefit once the chunk is split.

### D2 — `React.lazy` + `Suspense`, one boundary per call site

Each deferred component becomes a `React.lazy(() => import(...))` with a
`<Suspense>` boundary **local to the surface that renders it**.

*Why local, not one shared top-level boundary:* `App.tsx:2493`
`shellRenderers.renderDiff` is a *callback* whose JSX is rendered inside the
shell. Without its own boundary the suspension escapes upward and blanks the
shell — the exact failure the proposal calls out. Route-local boundaries also
satisfy the spec requirement that the loading affordance stays inside the opened
surface.

*Alternative rejected:* a single app-level `Suspense`. Simpler, but couples
unrelated surfaces' loading states and regresses the shell on diff open.

### D3 — Gate `TerminalPaneLayer` on *first terminal activation*, sticky per page session

`EditorPane.tsx` renders the lazy layer only once a `term:` tab has been the
**active** tab at least once in this page session. The predicate is a sticky
boolean: `false` initially, latched `true` the first time the active tab is a
terminal, never reset while mounted.

*Why not `openTerminalIds(...).length > 0`:* per Context, that predicate is
already true at first render after a reload with a persisted terminal tab, and
for every folder pane (`autoSurfaceTerminals`). A `React.lazy` component fires
its dynamic import as soon as it is rendered — even if the body returns `null` —
so the tab-existence gate would still fetch xterm during cold landing for exactly
the users the change targets. Sticky-on-activation defers the fetch to the moment
the user actually looks at a terminal.

*Why sticky rather than `activeTab is a terminal`:* an un-sticky predicate would
unmount the whole layer when the user switches to a file tab — destroying every
terminal and its WS. Sticky preserves keep-alive exactly: once latched, the layer
stays mounted and continues to hide/show individual terminals by id as today.

*Where the latch lives — load-bearing:* in the **`SplitWorkspaceContext`
provider**, beside `paneState`, NOT inside `EditorPane`. `SplitWorkspace.tsx:128`
unmounts `EditorPane` whenever the pane mode is `closed`, while the provider and
the persisted pane state survive. A latch local to `EditorPane` would reset on
every collapse/reopen, so the layer would not remount and background terminals
would sit **listed but dead** — a WS teardown with no tab close, violating the
keep-alive requirement this change is supposed to protect. Provider-scoped also
gives the right split-workspace semantics: each pane has its own provider, so
panes latch independently. The latch is **not** persisted to localStorage — a
fresh page load must start unlatched or the whole change is undone on reload.

*Known imprecision (accepted):* the provider is not re-created on session switch,
so a latch set in session A carries into session B. Effect is one early chunk
fetch, never a correctness bug; not worth extra state.

*Consequence (must be tested, not assumed):* two new lifecycle surfaces — the
latch transition (no terminal code fetched before it; fetched exactly once at it)
and the layer's own mount/unmount. Tests cover: no xterm import before first
terminal activation (incl. reload-with-persisted-tab and folder-pane mount),
latch survives a pane collapse/reopen cycle with no terminal teardown, mount once
per terminal id, hide on tab switch with no remount/reconnect, unmount on close
of the last terminal tab.

### D3a — Auto-surfaced terminal tabs open in the background (`activate: false`)

`use-terminal-pane-tabs.ts:154` gains `activate: false` on the auto-surface
dispatch, so a folder pane opens the terminal tab without focusing it.

*Why:* D3's latch is worthless on the folder pane otherwise — auto-surface
activates, activation latches, landing fetches xterm. This is the only lever that
separates "a terminal exists" from "the user is looking at a terminal".

*What the user sees:* the terminal tab appears unread-badged
(`editor-pane-state.ts:139` background path) instead of stealing focus. This is
the one user-visible change the Non-Goals now carve out explicitly.

*Scope:* only the `autoSurface` branch. The session-split "open the freshly
created terminal" branch (`use-terminal-pane-tabs.ts:158-163`) keeps activating —
there the user just asked for a terminal, so focusing it is correct and the latch
*should* fire.

### D3b — Requirement 1 is scoped to a default view with no terminal/diff surface

`ChatView.tsx:1831` renders `InlineTerminalCard` during cold transcript replay, so
a session whose history contains terminal cards loads the terminal chunk while
rendering its default view.

*Decision:* scope the requirement rather than add machinery — "cold landing"
means a default view that contains no terminal or diff surface. A session with
terminal history legitimately pays the fetch.

*Alternative deferred:* viewport-gating inline cards with an IntersectionObserver.
Real win for long transcripts, but it is new machinery with its own failure modes
and belongs in its own change, not bolted onto a bootstrap-graph fix.

### D4 — Diff pseudo-tab stays registry-resolved, via a lazy wrapper module

`pseudo-tab-registry.tsx` keeps the `diff:` key → component mapping, but the
mapped value becomes a lazy wrapper rather than a direct `DiffViewer` import.

*Why:* the registry file exists precisely to hold the `DiffViewer` import away
from `viewer-registry.tsx` / `CappedViewer.tsx` (the cycle boundary documented in
its header, from change `cleanup-import-cycles` — not this design's D3). Making
the entry lazy preserves that partition — the cycle boundary tests keep asserting
the same property, plus the import is now async.

*No new Suspense here:* `EditorPane.tsx:176` already wraps the pseudo-tab render
in a `<Suspense>` with a "Loading viewer…" fallback. The lazy entry inherits it;
adding a second boundary would be redundant.

*Alternative rejected:* moving resolution into `viewer-registry.tsx` now that the
import is async. It would re-couple the two halves and invalidate the existing
partition test for no gain.

### D5 — Preload guard asserts both directions, build-conditional

New test beside the existing chunk guards: parse `dist/index.html`, collect the
entry `<script type="module" src>`, every `<link rel="modulepreload" href>`, and
every `<link rel="stylesheet" href>`; assert none resolves to the xterm or
git-diff-view chunk in **either** JS or CSS form, **and** assert those chunks
still exist in `dist/assets`. Skip when `dist/` is absent, matching
`eml-bundle-exclusion.test.ts`.

*Why CSS too:* the current build eagerly links `xterm-*.css` and `diff-*.css`
(see Context). A JS-only guard would pass while the stylesheets kept loading on
landing.

*Why both directions:* a rename or a merge of either chunk would otherwise make
the "not preloaded" assertion pass vacuously forever. The existence backstop
covers **both** the JS and the CSS asset — a JS-only backstop lets the
CSS-not-linked assertion pass vacuously if the stylesheet stops being emitted
separately.

*Matcher semantics (pin them, do not improvise):* D1 introduces a chunk whose
name contains the substring `diff` (`jsdiff`). The guard MUST match on an
anchored chunk-name pattern (`/^diff-/`, `/^xterm-/` on the asset basename), not
a substring test, or splitting npm `diff` out immediately false-fails the guard
— and the natural "fix" is to weaken the assertion. Pin the exact chunk key in
`vite.config.ts` and reference it from the test.

*Scope limit (stated, not hidden):* this is a **document-level** guard — it
proves the chunks are not statically reachable from the entry. It cannot observe
a runtime dynamic import fired during landing (the D3 failure mode). That
property is covered by the D3 activation tests instead, which is why both exist.

### D6 — Measurement protocol

Re-measure on `develop`, not on the fork: production build, served locally,
Chrome DevTools/Playwright trace with Fast-3G + 4× CPU throttling, cold cache.
Record root JS transfer bytes and LCP before the change and after, in `tasks.md`.
The fork's 2.3 MB / 16.6 s numbers are context only.

## Risks / Trade-offs

- **Terminal keep-alive regression** (layer mount now gated, and the contract has
  **no existing test coverage** — see Context) → author the keep-alive tests
  FIRST, against the current unconditional render, prove them green, then change
  the gate. Writing them after the gate lands cannot distinguish "contract held"
  from "test was written to match the new behaviour".
- **Suspense escape blanking the shell** at `App.tsx:2493` `renderDiff` → that
  call site gets its own boundary; a test renders the shell diff path and asserts
  surrounding shell content stays mounted while suspended. (The pseudo-tab path
  needs none — `EditorPane.tsx:176` already has one.)
- **Existing synchronous render tests start seeing fallbacks** — specs that
  render `EditorPane`, `DiffViewer`, or the ChatView tool-renderer chain today
  assert on content that will now arrive a microtask later → budget a task to
  convert those assertions to `findBy*` / `waitFor`. Do not "fix" them by
  reverting a boundary.
- **Vacuous build guard** after a chunk rename → D5's existence assertion; after
  the `jsdiff` split → D5's anchored matcher.
- **Collapsed layout while the terminal layer loads** — the layer shares the flex
  body region (`EditorPane.tsx:334-336`); a zero-height Suspense fallback would
  visibly collapse the pane → the fallback must fill the same region
  (`flex-1 min-h-0`), asserted by the activation test.
- **First-open latency** on a slow link: opening a terminal or diff now costs a
  network round trip. Accepted — that cost was previously paid by *every* cold
  landing, including the majority that never open either surface.
- **Chunk-split churn**: moving npm `diff` out could create a new circular-chunk
  warning (as the `syntax`/`markdown` merge did). Mitigation: check the build
  log for circular-chunk warnings; fold into `util` if a standalone chunk warns.

## Migration Plan

Pure client-side build/bootstrap change; no data, protocol, or server surface.
Deploy = `npm run build` + restart per the project rebuild matrix. Rollback =
revert the commit; no persisted state depends on it.
