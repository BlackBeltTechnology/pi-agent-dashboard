# FilePreviewOverlay.tsx — index

Modal overlay. Reads file via `/api/file?cwd&path`. Routes by ext: `.md`/`.mdx` → `MarkdownContent`; image → `<img src=/api/file/raw>`; else code branch syntax-highlighted via `react-syntax-highlighter` + `detectLanguage` + `getSyntaxTheme`; line-number gutter + scroll-to-`line` preserved; undetected language falls back to flat `<pre>`. Esc + backdrop dismiss. Read-only. See change: linkify-tool-output, unify-file-link-openability.
