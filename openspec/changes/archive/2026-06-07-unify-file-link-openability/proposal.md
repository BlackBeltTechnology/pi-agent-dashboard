## Why

File references in the dashboard are openable on only one surface — tool *output* bodies (Bash/grep/ctx) rendered through `LinkifiedText` → `FileLink`. Three other surfaces leak:

1. **Absolute & `file://` paths are mis-resolved.** The tokenizer (`packages/client/src/lib/linkify-tool-output.ts`) builds paths from `SEG = [\w][\w.-]*` joined by `/`. No branch consumes a leading `/` or a `file://` scheme, so `/Users/me/app.ts` and `file:///Users/me/app.ts` both match only their tail (`Users/me/app.ts`) — the root is silently stripped, the path is demoted to relative, then re-rooted under the session cwd → wrong file.

2. **Read/Edit/Write tool headers vanish without a detected editor.** `OpenFileButton` returns `null` when `editors.length === 0` (or non-localhost). Unlike `FileLink`, it has no preview fallback, so on remote / no-editor setups the only affordance to open the file disappears entirely.

3. **Assistant prose is never linkified.** `MarkdownContent` (all assistant text, reasoning, steer/pending prompts) imports no linkifier. Paths the agent *writes* — especially inside inline code spans (backticks), the most common form — are inert text.

4. **The preview popup has no syntax highlighting.** `FilePreviewOverlay`'s code branch (`!isMd && !isImage`) renders a flat line-numbered `<pre>`. Every code file (`.ts`, `.tsx`, `.js`, `.json`, …) shows as un-highlighted text, even though `ReadToolRenderer` already highlights the identical content via `react-syntax-highlighter` (Prism). The preview — the *only* way to read a file on remote / no-editor deployments — is the worst-rendered surface.

These look like one bug but split into four independent, bounded defects. The shared goal: *a file reference is openable everywhere it appears, an absolute reference resolves to itself, and the preview renders code as code.*

## What Changes

- **Tokenizer (defect ①):** recognize absolute references as first-class tokens — POSIX leading `/`, `file://`/`file:///` URIs, and Windows drive paths (`C:\`, `C:/`). Emit them with the root preserved and an `absolute: true` marker. `file:` is still rejected as a *URL* (unchanged), but its path payload is now captured as an absolute *file* token rather than a stripped relative tail.
- **Resolution (defect ①):** `FileLink.resolveAgainstCwd` and the server `/api/open-editor` + `/api/file` skip the cwd join for absolute tokens. `path.resolve(cwd, abs)` already returns `abs` unchanged; the fix is purely that the tokenizer now *preserves* the root so an absolute string stays absolute end-to-end. `file://` payloads are decoded to a native path before resolution.
- **OpenFileButton (defect ②):** add the same preview fallback `FileLink` already has. No detected editor → clicking opens `FilePreviewOverlay` instead of rendering nothing. Read/Edit/Write headers become openable on every deployment.
- **Prose linkification (defect ③):** post-process `MarkdownContent` text and inline-`code` nodes through the existing tokenizer, rendering matches as `FileLink`. Fenced/multi-line code blocks are left untouched. Selection/copy verbatim-ness and the existing ErrorBoundary fault isolation are preserved.
- **Preview syntax highlighting (defect ④):** route `FilePreviewOverlay`'s code branch through the same `react-syntax-highlighter` + `detectLanguage` + `getSyntaxTheme` path `ReadToolRenderer` uses, preserving the line-number gutter and scroll-to-`line` behavior. Markdown and image branches are unchanged.

**Out of scope (documented limitation):** *wrong-base relative paths.* A bare relative path (e.g. `src/foo.ts`) emitted by a tool that ran in a subdir, or printed relative to repo root while the session cwd is a subdir, resolves against the wrong base. The protocol carries **no per-invocation cwd** (tool `args` for Bash = `{command, timeout, …}`; `browser-protocol.ts` has no `tool_call`/`tool_result` cwd field), so the session cwd is the only base available. Fixing this requires threading a real per-tool cwd through bridge → server → client and is deferred to a follow-up. Making absolute paths work (this change) is the recommended mitigation: an absolute reference has no base ambiguity.

## Capabilities

### Modified Capabilities
- `tool-output-linkification`: add absolute / `file://` / Windows-drive detection; extend click-routing to carry an absolute marker; add prose + inline-code linkification surface; require syntax highlighting in the preview-overlay fallback.
- `open-in-editor`: `OpenFileButton` gains a preview fallback when no editor is detected, matching `FileLink` routing.

## Impact

- Code (client): `lib/linkify-tool-output.ts` (tokenizer grammar + `absolute` token field), `components/tool-renderers/FileLink.tsx` (`resolveAgainstCwd` absolute branch, `file://` decode), `components/tool-renderers/OpenFileButton.tsx` (preview fallback), `components/MarkdownContent.tsx` (text/inline-code linkify hook), `components/FilePreviewOverlay.tsx` (syntax-highlighted code branch), plus their `__tests__`.
- Code (server): `routes/system-routes.ts` `/api/open-editor` and `routes/file-routes.ts` `/api/file` — accept absolute `file`/`path`, decode `file://`, keep anti-traversal + known-session-cwd guards.
- Behavior: absolute and `file://` references open the correct file; Read/Edit/Write headers and assistant prose paths become openable; relative-with-separator behavior unchanged.
- Security: absolute paths and `file://` must NOT bypass the existing `/api/file` known-session-cwd containment check — an absolute path outside any session cwd is rejected exactly as today. This is the key safety requirement of the change.
- No protocol changes, no new config keys, no migration.
