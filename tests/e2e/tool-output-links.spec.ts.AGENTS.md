# tool-output-links.spec.ts — index

Playwright E2E for tool-output file-link behaviour (change: selectable-tool-output-links). `[[faux:text-difflinks]]` streams unified-diff header `diff --git a/src/ghost.ts b/src/ghost.ts`; MarkdownContent linkifies `a/`/`b/` paths. Asserts tokenizer strips `a/` diff prefix → click previews `src/ghost.ts`; `/api/file` 404 → FilePreviewOverlay friendly "no longer exists at src/ghost.ts" message. Forces preview path by failing `/api/open-editor` (500).
