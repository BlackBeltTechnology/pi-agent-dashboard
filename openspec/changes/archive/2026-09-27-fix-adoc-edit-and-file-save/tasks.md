## 1. Server sanitizer under jiti

- [x] 1.1 Test first: `lib/__tests__/purify-jiti.test.ts` spawns node with the real `jiti-register` loader and sanitizes an SVG (red with dynamic `import()`: `interfaces.getInterfaceWrapper is not a function`)
- [x] 1.2 Add `lib/purify.ts` `loadPurify()` (`createRequire`, lazy, no caching of a broken instance)
- [x] 1.3 Switch `diagram-render.ts`, `eml.ts`, `office-preview.ts` to `loadPurify()`
- [x] 1.4 Register the test in `vitest.real-process-files.ts` (real-process guard)

## 2. Save path

- [x] 2.1 Test first: `writable-md-target.test.ts` allows `.adoc`/`.asciidoc`/`.csv` in scope, rejects `.adoc` `..` escape
- [x] 2.2 Extend `WRITABLE_MD_EXTENSIONS` to `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv`
- [x] 2.3 Test first: `file-kind-endpoint.test.ts` GET→POST round-trip with a fractional mtime returns 200 (red: 409)
- [x] 2.4 `GET /api/file` returns full-precision `stat.mtimeMs`

## 3. AsciiDoc Preview/Edit

- [x] 3.1 Test first: `file-kind.test.ts` `.adoc`/`.asciidoc` → `editable: true`; `AsciiDocEditTab.test.tsx` toggle + save; registry scroll test
- [x] 3.2 `file-kind.ts`: AsciiDoc `editable: true`
- [x] 3.3 Generalize the csv tab into `EditablePreviewTab` (csv wrapper keeps `csv-*` test ids); AsciiDoc registry viewer uses it with prefix `adoc`

## 4. Verification

- [x] 4.1 Affected suites green (server, editor-pane, shared file-kind, real-process guard)
- [x] 4.2 Live instance: AsciiDoc Preview renders Mermaid + PlantUML (Kroki), Edit→Save persists to disk, no false 409; `.csv` save returns 200
