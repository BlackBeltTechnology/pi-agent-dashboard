## Why

In chat view, the table "Copy as Markdown" / "Copy as TSV" buttons copy an empty
string. `TableWrapper` computes the copy payload **eagerly during render**
(`text={copyMarkdown()}`), but that reader dereferences a ref (`ref.current`)
that React has not assigned yet — refs are populated at commit, after render.
Because `MarkdownContent` is `React.memo`, a completed chat message renders
exactly once, so the empty `text=""` is frozen and never repaired. `CopyButton`'s
`catch {}` swallows the outcome, so the failure is silent — the button looks
inert. The same latent bug affects the code-block copy button under any single
render path.

## What Changes

- Change `CopyButton` to resolve its payload **at click time** instead of
  binding a pre-computed string at render time. It SHALL accept a `getText: () => string`
  callback rather than an eager `text` string. **BREAKING** (prop contract of
  an internal component; no external consumers).
- Update `TableWrapper` to pass its `copyMarkdown` / `copyTsv` ref-reading
  callbacks directly as `getText` (the DOM is committed by click time, so the
  ref is populated).
- Update `CodeBlockWrapper` to pass `() => codeString`.
- Add a click-level test asserting the clipboard receives the real table
  markdown / TSV on a single (memoized) render — the current test only checks
  the buttons exist, never that they copy.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `content-copy`: the CopyButton contract changes from an eager `text` string
  to a lazily-evaluated `getText` callback so ref-derived payloads (tables,
  code blocks) are resolved after commit, guaranteeing non-empty copy on a
  single render.

## Impact

- `packages/client/src/components/CopyButton.tsx` — prop `text: string` →
  `getText: () => string`; `handleClick` calls `getText()`.
- `packages/client/src/components/MarkdownContent.tsx` — `TableWrapper` and
  `CodeBlockWrapper` call sites pass callbacks instead of computed strings.
- Any other `CopyButton` consumers (`DiagnosticsSection`, message-bubble copy,
  `PairingView` if applicable) must migrate their `text=` prop to `getText={() => …}`.
- Tests: `packages/client/src/components/__tests__/MarkdownContent.test.tsx`.

## Discipline Skills

- `systematic-debugging` — root-cause confirmed (render-time ref read under
  `React.memo`); guards against a guess-fix.
- `doubt-driven-review` — verify every `CopyButton` call site is migrated before
  the prop rename lands (no orphaned `text=` usages).
