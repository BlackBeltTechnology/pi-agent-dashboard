# apply-fix-to-file.spec.ts — index

L3 F11–F13, X7: rule-repaired mermaid diagram → "Apply fix to file" → diff dialog → confirm. F11 md overlay (fence in list item, only block lines change, indent kept, faux `text-realfile-applyfix`); F12 `.mmd` tab (final newline kept); F13 AsciiDoc (only lines between mermaid delimiters change, plantuml untouched); X7 external write after dialog opens → server 409 → "File changed — reload", disk keeps external edit. Fixtures `sample-git/apply-fix*` restored in afterEach. See change: add-preview-apply-fix-to-file.
