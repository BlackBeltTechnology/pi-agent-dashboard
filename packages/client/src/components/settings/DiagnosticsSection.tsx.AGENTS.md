# DiagnosticsSection.tsx — index

Settings → Diagnostics. Fetches `/api/doctor`. Groups by section in fixed order, omits empty sections (no n/a placeholders for Electron-only rows). Status pill + message + truncated path + `<MarkdownContent>` suggestion. Toolbar `[Re-run]` (disabled while in flight, "Running…" label) + `[Copy as Markdown]` / `[Copy as Plain]` (textarea-modal fallback on `navigator.clipboard.writeText` rejection). Inline error block on non-200 / shape-mismatch with HTTP status + 500-char body excerpt.
