## 1. Tokenizer — absolute / file:// / Windows-drive (defect ①)

- [x] 1.1 Add `absolute?: boolean` to the `file` variant of `Token` in `packages/client/src/lib/linkify-tool-output.ts`.
- [x] 1.2 Add regex branches (precedence before relative branches, after URL): POSIX `/`-absolute, `file://`/`file:///` URI, Windows drive (`[A-Za-z]:[\\/]…`). Keep the single-linear-pass + verbatim-coverage contract.
- [x] 1.3 Decode `file://` payload to a native path at tokenize time (percent-decode; strip scheme; handle `file:///`); on decode failure fall back to a plain `text` token.
- [x] 1.4 Ensure Windows drive `:` is not parsed as the `:line` separator (anchor drive at token start; parse line/col only from trailing `:\d+(:\d+)?`).
- [x] 1.5 Confirm `file:`/`javascript:`/`data:`/`vbscript:` still rejected as URLs; `http(s)://` precedence unchanged.

## 2. Resolution — absolute pass-through (defect ①)

- [x] 2.1 In `FileLink.tsx::resolveAgainstCwd`, return the path unchanged when absolute (POSIX `/`, decoded native Windows drive). Use the token's `absolute` marker, not a re-derived heuristic.
- [x] 2.2 In `FileLink` click + title, use the absolute path verbatim for `openEditor` and the preview overlay.
- [x] 2.3 Server `/api/open-editor` (`routes/system-routes.ts`) + `/api/file` (`routes/file-routes.ts`): defensively decode a leading `file://` on incoming `file`/`path`; rely on existing `path.resolve(cwd, abs) === abs` pass-through.

## 3. OpenFileButton preview fallback (defect ②)

- [x] 3.1 Extract shared open-vs-preview routing (e.g. `useFileOpenRouting(context)` or a shared helper) used by both `FileLink` and `OpenFileButton` — DRY, single source of truth.
- [x] 3.2 Update `OpenFileButton.tsx`: remove the `editors.length === 0 → null` dead end; render the affordance whenever `cwd` + `filePath` exist; route to editor or `FilePreviewOverlay`.
- [x] 3.3 Verify Read/Edit/Write renderers pass through and render correctly on a non-localhost / no-editor deployment.

## 4. Prose + inline-code linkification (defect ③)

- [x] 4.1 In `MarkdownContent.tsx`, wire `tokenize()` → `FileLink`/`UrlLink` for inline text (paragraphs, list items) and inline `code` spans, via react-markdown component overrides.
- [x] 4.2 Exclude fenced/multi-line code blocks (`pre > code` path) — they keep SyntaxHighlighter rendering untouched.
- [x] 4.3 Do not double-wrap existing markdown link anchors; preserve `isExternalHref` behavior.
- [x] 4.4 Thread `ToolContext` (cwd + editors) into `MarkdownContent` so prose links can route. Source it the same way ChatView already has it (`toolContext`).
- [x] 4.5 Preserve selection/copy verbatim-ness and wrap in the existing `ErrorBoundary` fault-isolation pattern.

## 5. Preview overlay syntax highlighting (defect ④)

- [x] 5a.1 In `FilePreviewOverlay.tsx`, replace the flat `<pre>` code branch with `react-syntax-highlighter` driven by `detectLanguage(path)` + `getSyntaxTheme(theme, themeName)` (same stack as `ReadToolRenderer`).
- [x] 5a.2 Preserve the line-number gutter and the scroll-to-`line` ref/behavior; keep the target-line highlight.
- [x] 5a.3 Fall back to the current flat `<pre>` when language is undetected; leave markdown + image branches unchanged.
- [~] 5a.4 (Optional, if wiring is non-trivial) extract a shared `<CodeBlock path content line />` used by both `ReadToolRenderer` and `FilePreviewOverlay` (DRY).

## 5. Security (defect ① guard)

- [x] 5.1 `/api/file` test: absolute `path` resolving inside a known session cwd → allowed.
- [x] 5.2 `/api/file` test: absolute `path=/etc/passwd` (outside every session cwd) → rejected (no content). Same for `file://` form.
- [x] 5.3 Confirm absolute support does not weaken the existing traversal containment.

## 6. Tests

- [x] 6.1 `linkify-tool-output.test.ts`: absolute POSIX, `file://` decode (incl. `%20`), absolute `:line:col`, Windows drive, drive-colon-not-line, verbatim coverage for all new tokens.
- [x] 6.2 `FileLink.test.tsx`: absolute path skips cwd join in title + open-editor body + preview.
- [x] 6.3 New `OpenFileButton.test.tsx`: editor → openEditor; no editor → preview overlay; no cwd → null.
- [x] 6.4 `MarkdownContent.test.tsx`: inline-code path linkified; prose absolute path linkified; fenced block NOT linkified; existing markdown link not double-wrapped; copy verbatim.
- [x] 6.4a `FilePreviewOverlay.test.tsx`: code file renders highlighted (language-detected) with line-number gutter; unknown extension falls back to plain text; markdown + image branches unchanged.
- [x] 6.5 Regression: existing linkification, URL, overflow-cap, selection, and fault-isolation scenarios stay green.

## 7. Documentation

- [x] 7.1 Update rows for `linkify-tool-output.ts`, `FileLink.tsx`, `OpenFileButton.tsx`, `MarkdownContent.tsx`, `FilePreviewOverlay.tsx` in `docs/file-index-client.md` (path-alphabetical, caveman style; `See change: unify-file-link-openability`).
- [x] 7.2 Note the wrong-base-relative limitation in `docs/architecture.md` (linkification section) as a known limitation + follow-up requiring per-tool cwd in the protocol.
- [x] 7.3 CHANGELOG `## [Unreleased]` → Fixed: absolute/`file://` links, openable tool headers + prose paths.

## 8. Verify

- [x] 8.1 `npm test` green.
- [x] 8.2 `npm run build` succeeds.
- [x] 8.3 Manual: absolute path in Bash output opens correct file; `file://` link opens correct file; Read header opens (editor) or previews (no editor); path in assistant prose + inline code is clickable; fenced code block is not; preview popup of a `.ts`/`.tsx` file is syntax-highlighted with line numbers.
