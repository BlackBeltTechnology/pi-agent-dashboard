# editor-pane.spec.ts — index

Playwright E2E for internal Monaco editor pane (change: add-internal-monaco-editor-pane). Drives OpenFileButton → `/session/:id/editor?file=` round-trip via `[[faux:tool-read-fixture]]` against docker sample-git fixture. Covers manual tasks 8.3/8.4/8.5: markdown + monaco + image (logo.png → ImageViewer) + pdf (doc.pdf → PdfViewer `<object>`) viewers, tab persistence in localStorage, Back-to-chat + goBack restore. Asserts `buildMonacoTheme` editor.background is non-transparent. Uses `spawnFreshGitSession`, `sendPrompt`.
