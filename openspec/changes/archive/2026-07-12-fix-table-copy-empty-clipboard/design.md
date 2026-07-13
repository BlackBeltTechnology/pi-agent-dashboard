## Context

Table (and code-block) copy buttons in chat view copy an empty string. Root
cause is a render-time ref read frozen by memoization.

```
MarkdownContent (React.memo) ── renders ONCE for a completed message
        │
        ▼
   TableWrapper render
   ┌──────────────────────────────────────────────┐
   │  <div ref={ref}>        ref.current === null  │
   │     {children}          during THIS render    │
   │     <CopyButton text={copyMarkdown()} />      │  copyMarkdown()
   │     <CopyButton text={copyTsv()} />           │  → ref.current?.query
   │  </div>                                       │    ("table") → null → ""
   └──────────────────────────────────────────────┘
        │
        ▼  no re-render (memo) → text="" frozen → click copies ""
```

React assigns refs at **commit**, after render returns. Reading `ref.current`
during render yields `null` on the first (and, under `React.memo`, only) render.

## Goals / Non-Goals

- **Goal**: table copy buttons copy the real table content on a single render.
- **Goal**: fix the same class for code-block copy and the message "copy as
  plain text" button (`ChatView.MessageBubble.getPlainText`, same ref-at-render
  pattern, degrades to raw markdown).
- **Non-Goal**: redesign the copy UI, icons, or visibility rules.
- **Non-Goal**: change clipboard fallback behavior (silent-fail stays).

## Decision

Move payload resolution from render time to click time by changing `CopyButton`
to accept a `getText: () => string` callback instead of an eager `text: string`.
The button calls `getText()` inside `handleClick`, when the DOM is committed and
refs are populated.

```
CopyButton({ getText, icon, title })
  handleClick = async () => {
    try { await navigator.clipboard.writeText(getText()); setCopied(true); … }
    catch { /* silent */ }
  }
  useCallback deps: [getText]   // callers pass stable useCallback refs
```

Call-site migration (`text=X` → `getText={() => X}` or pass the existing
callback directly):

| Site | Before | After |
|---|---|---|
| `MarkdownContent` TableWrapper md | `text={copyMarkdown()}` | `getText={copyMarkdown}` |
| `MarkdownContent` TableWrapper tsv | `text={copyTsv()}` | `getText={copyTsv}` |
| `MarkdownContent` CodeBlockWrapper | `text={codeString}` | `getText={() => codeString}` |
| `ChatView` MessageBubble md | `text={content}` | `getText={() => content}` |
| `ChatView` MessageBubble plain | `text={getPlainText()}` | `getText={getPlainText}` |
| `SkillInvocationCard` (×4) | `text={…}` | `getText={() => …}` |
| `SessionBanner` | `text={…}` | `getText={() => …}` |

### Alternatives considered

- **Read the ref inside CopyButton**: rejected — the ref lives in the wrapper
  (`TableWrapper`), not the button; the button is generic and reused for plain
  strings too.
- **Force a re-render after mount (useEffect+state)**: rejected — extra render
  per table/code block for no benefit; lazy getter is simpler and cheaper.

## Risks / Trade-offs

- **Prop rename touches every call site.** Mitigation: TypeScript compile error
  flags any missed site; `doubt-driven-review` checkpoint enumerates them.
- Callers must pass stable callbacks (`useCallback`) to keep `CopyButton`'s
  `handleClick` identity stable; low risk — existing wrappers already memoize.

## Migration Plan

Single atomic change: rename the prop, migrate all call sites in the same commit,
add click-level tests. No feature flag (internal component, no external
consumers).
