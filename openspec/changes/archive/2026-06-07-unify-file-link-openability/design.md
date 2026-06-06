## Context

File-link openability is implemented across four surfaces with three different code paths and inconsistent capability:

```
SURFACE                  COMPONENT            LINKIFIED   NO-EDITOR FALLBACK
Bash/grep/ctx output     LinkifiedText>FileLink   yes     preview overlay ✓
Read/Edit/Write header   OpenFileButton           n/a     NONE → null ✗
Assistant prose / code   MarkdownContent          NO ✗    n/a ✗
```

And the preview overlay itself — the no-editor fallback — renders code files as a flat `<pre>` with no syntax highlighting, despite `ReadToolRenderer` already highlighting identical content.

The tokenizer underpinning `FileLink` has no concept of an *anchored* (absolute) path; it only models relative paths resolved against `ToolContext.cwd` (= `selectedSession.cwd`, set in `App.tsx`).

## Goals / Non-Goals

- Goal: any file reference — absolute, `file://`, or relative-with-separator — is detected and openable on output bodies, tool headers, and prose.
- Goal: absolute / `file://` references resolve to themselves, not re-rooted under cwd.
- Goal: zero regression to existing relative-path, URL, selection/copy, overflow, and fault-isolation behavior.
- Non-Goal: correctly resolving relative paths whose base ≠ session cwd (needs protocol-level per-tool cwd; deferred).
- Non-Goal: changing the tool-call/result protocol.

## Decisions

### D1 — Tokenizer gains an absolute branch, paths keep their root
Add token field `absolute?: boolean` to the `file` token. New regex branches, in precedence order *before* the relative branches:

- POSIX absolute: `/(?:SEG/)*SEG\.EXT(:line(:col)?)?` — leading `/` consumed.
- `file://` URI: `file://(/...)` — captured, scheme stripped at tokenize time, payload kept absolute.
- Windows drive: `[A-Za-z]:[\\/](?:SEG[\\/])*SEG\.EXT` — `C:\…` / `C:/…`.

`url` precedence is unchanged: `http(s)://` still wins; `file:`/`javascript:`/`data:`/`vbscript:` still rejected as URLs. The difference is that a `file://` *file* token now captures the absolute payload instead of leaving the tail to the relative branch.

Rationale: the single root cause of both the absolute-path and `file://` symptoms is that no branch consumes a root. Fix it in one place (the grammar) and every downstream consumer benefits.

### D2 — Absolute tokens skip the cwd join
`resolveAgainstCwd(cwd, p)` returns `p` unchanged when `p` is absolute (already true for `/`-prefixed; extend to decoded `file://` and Windows drive). Server `path.resolve(cwd, file)` already returns `file` when absolute — no server logic change beyond `file://` decode. The fix is that the *token now carries an absolute string*, so the existing pass-through does the right thing.

### D3 — `file://` decode location
Decode `file://` → native path **at tokenize time** (client), so `FileLink.path`, the preview overlay, and the open-editor POST body all see a plain native path. Server also defensively decodes a leading `file://` on `/api/file` + `/api/open-editor` in case a raw URI arrives. Use `URL`/`fileURLToPath`-equivalent decoding (handle `%20` etc.); browser-side use a small decoder (no `node:url`).

### D4 — Security containment is unchanged and load-bearing
`/api/file` rejects any `path` not under a known session cwd (`allSessions.some(s => s.cwd === cwd)` + traversal guard). Absolute paths MUST go through the same gate: an absolute path outside every session cwd is rejected. Absolute support must not become a path-traversal escape. Add explicit tests: absolute path inside session cwd → allowed; absolute path outside → 403.

### D5 — OpenFileButton mirrors FileLink routing
Refactor the open-vs-preview decision into a shared helper (or have `OpenFileButton` delegate to the same routing `FileLink` uses): localhost + editor → `openEditor`; else → `FilePreviewOverlay`. Removes the `editors.length === 0 → null` dead end. DRY: extract `useFileOpenRouting(context)` rather than duplicating the branch in both components.

### D6 — Prose linkification without breaking code blocks
In `MarkdownContent`, override `react-markdown` component renderers for `text` (via a rehype/remark pass or a `p`/`li`/`code`-level wrapper) to run inline string children through `tokenize()` and emit `FileLink` for file tokens. Constraints:
- Only inline contexts: paragraph text, list items, and **inline** `code` spans. Fenced code blocks (`pre > code`) are NOT linkified (they already render via SyntaxHighlighter and linkifying them would corrupt copy + highlighting).
- Preserve the existing URL anchor handling (`isExternalHref`) — don't double-wrap real markdown links.
- Reuse the `ErrorBoundary` + verbatim-coverage guarantees the tokenizer already provides.

Open question for implementation: cleanest react-markdown hook — a `components.code`/`components.p` override that post-processes string children, vs. a remark plugin that splits text nodes. Prefer the component-override approach (no AST plugin, smaller blast radius, easier to keep code-fence exclusion).

### D7 — Preview overlay reuses ReadToolRenderer's highlighting path
`FilePreviewOverlay`'s `!isMd && !isImage` branch swaps the flat `<pre>` for `react-syntax-highlighter` (Prism) driven by `detectLanguage(path)` + `getSyntaxTheme(theme, themeName)` — the exact stack `ReadToolRenderer` uses. The line-number gutter and scroll-to-`line` ref MUST be preserved: use SyntaxHighlighter's `showLineNumbers` + `wrapLines`/`lineProps` (or keep the custom gutter and feed highlighted rows) so the existing target-line scroll still works. Unknown/unsupported extension falls back to the current flat `<pre>` (no regression). DRY: if the highlighter wiring is non-trivial, extract a shared `<CodeBlock path content line />` used by both `ReadToolRenderer` and `FilePreviewOverlay`.

## Risks

- **Prose false positives.** Linkifying prose risks turning non-paths into links. Mitigation: reuse the existing conservative grammar (requires separator or `./`/`../` or recognized ext); inline-code spans are high-signal (agents wrap real paths in backticks).
- **`file://` host component.** `file://host/share` (UNC) is rare; decode defensively, fall back to plain-text token on parse failure (fault isolation already covers throws).
- **Windows drive vs. `line:col` ambiguity.** `C:\x.ts:42` — ensure the drive `:` isn't mistaken for the line `:`. Anchor the drive pattern at token start and parse line/col only from the trailing `:\d+(:\d+)?`.
- **Preview highlighting perf on large files.** Prism highlighting a very large file in the overlay could jank. `/api/file` content is already bounded by the existing read path; if needed, cap highlighting above a size threshold and fall back to flat `<pre>` (mirror any cap `ReadToolRenderer` already applies).

## Migration

None. Additive token field, additive prose surface, additive preview fallback. Existing tests must stay green; new behavior is covered by new scenarios.
