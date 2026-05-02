## Context

Two surfaces in the dashboard render diffs from the same data shape (`oldText`, `newText`, `filePath`):

1. **Chat — `EditToolRenderer.tsx`** (`packages/client/src/components/tool-renderers/EditToolRenderer.tsx`). A local 30-line `DiffView` builds a unified patch via `createTwoFilesPatch` from the `diff` package and applies per-line CSS classes for `+` / `-` / `@@` headers. No syntax highlighting. Used inline inside every Edit tool card.

2. **Content area — `DiffPanel.tsx`** (`packages/client/src/components/DiffPanel.tsx`). A 275-line component built on `@git-diff-view/react` + `@git-diff-view/file` + `@git-diff-view/lowlight`. Generates a `DiffFile`, runs `initRaw()` / `buildSplitDiffLines()` / `buildUnifiedDiffLines()`, mounts `<DiffView>` with full syntax highlighting, exposes a split↔unified toggle. Used inside `FileDiffView`, the dedicated content-area view opened from the session header's "View changes" button.

Both already exist in the production bundle — `DiffPanel` is loaded the moment any user opens `FileDiffView` once. The disparity is purely visual: the same Edit shows up "rich" in the content area and "plain" in chat.

`ToolCallStep.tsx` already gates renderer mounting with `{expanded && <Renderer />}` (line ~115) and Edit tool cards default to `expanded: false` (line 59 — the predicate is `hasImages || isAgentRunning || (isAskUser && !isFailedAskUser)`, which excludes Edit). So whichever renderer Edit uses only mounts when the user clicks the chevron. The lazy-mount story is solved before this change starts.

## Goals / Non-Goals

**Goals:**
- Visual parity for Edit tool diffs between chat (desktop) and `FileDiffView`.
- Zero new dependencies — reuse the `@git-diff-view/*` stack already shipped.
- Zero performance regression for users who never expand Edit cards (lazy-mount inherited from `ToolCallStep`).
- Preserve mobile rendering exactly — same look, same code path, same bundle behavior on mobile sessions.
- Reduce duplication: extract a single `<RichDiff>` component consumed by both the new chat path and the existing `DiffPanel`.

**Non-Goals:**
- Changing `WriteToolRenderer` (full-file adds). Out of scope; track separately if desired.
- Adding a split-view toggle inside chat. Chat columns are too narrow for a useful split; users wanting split open `FileDiffView`.
- Persisting Edit-card expand state across reloads or session switches.
- Eager pre-tokenization or virtualization. Lazy-on-expand is sufficient.
- Removing the homegrown `DiffView` inside `EditToolRenderer.tsx` — it remains as the mobile fallback.

## Decisions

### D1. Extract `<RichDiff>` as a shared component

A new file `packages/client/src/components/RichDiff.tsx` encapsulates the diff-rendering core currently inlined in `DiffPanel.tsx`:

```
   ┌─────────────────────────────────────────┐
   │  <RichDiff>                             │
   │    props: oldText, newText, filePath,   │
   │           mode? = "unified",            │
   │           maxHeight? = "20rem"          │
   │                                         │
   │    1. EXT_LANG_MAP[ext] → language      │
   │    2. generateDiffFile(...)             │
   │    3. .init()                           │
   │    4. .buildSplitDiffLines()            │
   │       .buildUnifiedDiffLines()          │
   │    5. theme := useThemeContext().resolved│
   │    6. <DiffView                         │
   │         diffViewMode={...}              │
   │         diffViewTheme={theme}           │
   │         diffViewHighlight diffViewWrap  │
   │         registerHighlighter={hl} />     │
   └─────────────────────────────────────────┘
            ▲                       ▲
            │                       │
   ┌────────┴────────┐    ┌─────────┴─────────┐
   │ EditToolRenderer│    │    DiffPanel      │
   │ (desktop only)  │    │ Path A only       │
   │                 │    │ (Edit/Write/last) │
   └─────────────────┘    └───────────────────┘
                                  +
                          ┌───────────────────┐
                          │ inline <DiffView> │
                          │ Path B (gitDiff   │
                          │  → raw hunks)     │
                          └───────────────────┘
```

`<RichDiff>` is a *pure rendering primitive* with a deliberately narrow input shape. It accepts `(oldText, newText, filePath)` only. `DiffPanel` has a SECOND rendering path (the git-aggregate-diff branch when `file.gitDiff` is set, which feeds `<DiffView>` via the raw `data: { oldFile, newFile, hunks }` prop). That path is NOT extracted in this change — widening `<RichDiff>` to accept the `data` shape would add API surface for one internal consumer; cleaner to keep that branch's `<DiffView>` inline in `DiffPanel`.

Higher-level features (split/unified toggle, view-mode toggle, expand-all, file metadata header) stay in `DiffPanel` as caller-owned chrome.

**Rationale:** keeps the chat call site trivial (`<RichDiff oldText newText filePath />`), keeps `DiffPanel` free to evolve its toolbar without affecting chat, centralizes the `EXT_LANG_MAP` + `generateDiffFile` + visual-prop set (theme, highlight, wrap, highlighter) that's currently inlined, and avoids API bloat for the single Path B internal consumer.

### D2. Mobile branch via `useMobile()`

`EditToolRenderer.tsx` calls `useMobile()` (from `packages/client/src/hooks/useMobile.tsx`) and switches between renderers:

```ts
const isMobile = useMobile();
// ...
{isMobile
  ? <DiffView oldText={...} newText={...} filePath={...} />   // existing homegrown
  : <RichDiff oldText={...} newText={...} filePath={...} />   // new path
}
```

Same branch is applied inside the `edits[]` map for multi-edits.

**Rationale:** the user-confirmed contract is "desktop only." `useMobile()` is the standing primitive for this gate elsewhere in the app (chat layout, headers, action bar), so reusing it keeps behavior consistent. The known side effect — narrow-and-short landscape phones get the lightweight diff — is acceptable and matches every other mobile-vs-desktop branch in the codebase.

### D3. Unified mode in chat, no toolbar, theme-aware

`<RichDiff>` defaults `mode="unified"`. `EditToolRenderer` does not pass `mode`, so chat always renders unified.

**Rationale:** chat columns are typically 600–900px wide on desktop. Split view would compress each pane below readable width. Unified is the right default; users wanting split open `FileDiffView` (the existing button is unchanged).

No toolbar in chat — `<RichDiff>` is pure content, the wrapping `<ToolCallStep>` already provides the chevron + status. Adding a per-card toolbar would be visual noise.

`<DiffView>`'s `diffViewTheme` is sourced from `useThemeContext().resolved` (the existing project-wide theme primitive used by `WriteToolRenderer`, `ReadToolRenderer`, `MarkdownContent`), NOT hardcoded to `"dark"` as `DiffPanel` currently does. This is a deliberate side-effect improvement — light-theme users today see a hardcoded-dark diff inside `FileDiffView`; after this change both surfaces respect the active theme. The hardcoded `diffViewTheme="dark"` literal in `DiffPanel.tsx` is removed when `<DiffView>` is replaced by `<RichDiff>`. The other visual props (`diffViewHighlight`, `diffViewWrap`, `registerHighlighter={highlighter}`) are encapsulated as `<RichDiff>` internal defaults — callers do not pass them.

### D4. Capped height with internal scroll

`<RichDiff>` accepts an optional `maxHeight` prop. The chat caller passes a sensible cap (e.g. `"20rem"` to match the existing `max-h-80` of the homegrown DiffView). `DiffPanel` does not pass `maxHeight` — it lives inside the content area and uses parent flex sizing.

**Rationale:** preserves the current scroll-inside-card behavior in chat. Long diffs don't blow out the chat scroll position.

### D5. Lazy mount inherited, no new gating logic

We do **not** add new lazy-mount logic. The existing `{expanded && <Renderer />}` in `ToolCallStep` is sufficient — when collapsed, `EditToolRenderer` doesn't mount, so `<RichDiff>` (and therefore `generateDiffFile` + lowlight tokenization) never runs.

**Rationale:** simplest possible thing. Confirmed by reading `ToolCallStep.tsx:115`. Re-collapse → unmount, re-expand → re-tokenize is acceptable; tokenization of a single edit is sub-millisecond perceptually.

### D6. `DiffPanel` consumes `<RichDiff>` for change-derived diffs only

After extraction, `DiffPanel.tsx` is refactored to call `<RichDiff>` for its **change-derived** diff rendering (Path A: Edit/Write/lastChange branches inside `buildChangeDiffFile` — all build a `DiffFile` via `generateDiffFile`). The git-aggregate-diff branch (Path B, `file.gitDiff` → raw hunks via `<DiffView data={...} />`) keeps its inline `<DiffView>` invocation per D1.

Its toolbar, split/unified toggle, view-mode toggle (diff/file), file-list, and per-change-type dispatch logic all stay in `DiffPanel`.

`EXT_LANG_MAP` moves into `RichDiff.tsx`. Path B inside `DiffPanel` still needs lang resolution for its inline `oldFile.fileLang` / `newFile.fileLang` fields; rather than duplicate the map, `RichDiff.tsx` exports a `getLang(filePath: string): string` helper that `DiffPanel` imports for Path B. `EXT_PRISM_MAP` and `getPrismLang` stay in `DiffPanel.tsx` because they serve the non-diff `react-syntax-highlighter` path (the `viewMode === "file"` branch) which `<RichDiff>` does not own.

**Rationale:** if we don't refactor `DiffPanel` Path A, we have two near-identical `generateDiffFile` invocations to keep in sync. Path A extraction is the whole point of the proposal. Path B is left inline because widening `<RichDiff>`'s API to cover one more internal consumer is worse than duplicating four lines of `<DiffView>` JSX.

## Risks / Trade-offs

### R1. Re-tokenization on every expand

Collapsing and re-expanding an Edit card re-mounts `<RichDiff>`, which re-runs `generateDiffFile` + lowlight. For a typical edit (50–200 lines) this is sub-millisecond and imperceptible. For pathological cases (10 000-line diff) it could be visible. Mitigation if it ever bites: memoize `generateDiffFile` result on `(oldText, newText, filePath)` keyed via `useMemo` inside `<RichDiff>`. Not doing this preemptively — we'd be optimizing without evidence.

### R2. Bundle weight on chat-first sessions

A user who never opens `FileDiffView` historically wouldn't load the `@git-diff-view/*` stack until they opened that view. After this change, the stack is reachable from any expanded Edit card.

In practice the chat-critical bundle already imports many heavy modules (markdown rendering with prism, mermaid, react-syntax-highlighter). The `@git-diff-view` stack is roughly comparable in tokenizer cost to what's already there. Net delta on the chat-critical bundle is small (KB-range, not 100s of KB) and only paid by users who *expand* an Edit — collapsed Edit cards do not import the renderer subtree because of the `{expanded && ...}` gate.

If bundle weight becomes a concern, the right answer is `React.lazy` around `<RichDiff>` so the import itself is deferred to first expand. Out of scope for this change but trivially addable later.

### R3. `useMobile()` predicate edge cases

`useMobile()` flips at `width < 768px OR height < 600px`. A desktop user dragging their window to short-and-wide landscape could end up in the lightweight diff. Behavior matches everywhere else in the app that uses this hook — this is the project-wide convention, not a bug introduced by this change.

### R4. Style collision with `@git-diff-view/react/styles/diff-view.css`

The CSS is already imported by `DiffPanel.tsx` and applied globally. No additional collision risk from adding chat call sites — same stylesheet, same effect.

### R5. `<RichDiff>` API surface drift

We're creating a new public-ish component used by two callers. If a future change wants split-mode-on-demand or a custom theme prop, the API expands. Mitigation: keep the prop list deliberately small at v1 (`oldText`, `newText`, `filePath`, optional `mode`, optional `maxHeight`). Resist the urge to surface every `<DiffView>` prop until there's a real second-caller need.

### R6. Multi-edit visual density

The current homegrown renderer stacks `edits[]` entries with thin border separators between them. `<RichDiff>` is one diff per call. The chat caller will continue to map over `edits[]` and render one `<RichDiff>` per entry — same separator pattern, just richer content per entry. A 12-edit Edit call expanded all at once will be tall and dense. Acceptable: the user explicitly expanded it, and tall-and-dense is also the current behavior.
