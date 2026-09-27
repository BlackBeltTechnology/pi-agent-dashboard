## 1. Docx scroll

- [x] 1.1 Test first: `viewer-registry.test.tsx` docx body sits in an `overflow-auto min-h-0` scroller (red)
- [x] 1.2 Wrap `DocxViewer` in `h-full min-h-0 overflow-auto`

## 2. AsciiDoc title

- [x] 2.1 Test first: `file-raw-render-endpoints.test.ts` `= Field Guide` → `<h1>Field Guide</h1>` (red)
- [x] 2.2 `/api/file/render` convert with `attributes: { showtitle: "" }`

## 3. PlantUML sizing

- [x] 3.1 Test first: `DiagramPreview.test.tsx` inline mode has no `h-full`, SVG `max-w-full`/`!h-auto` (red)
- [x] 3.2 `DiagramPreview` `inline` prop; `AsciiDocPreview` drops `h-[400px]` and passes `inline`

## 4. latexmath

- [x] 4.1 Tests: `lib/preview/__tests__/adoc-math.test.ts` (inline, display, entities, code untouched, bad TeX, probe); `DocxPreview.test.tsx` AsciiDoc KaTeX hydration
- [x] 4.2 `lib/preview/adoc-math.ts`; `AsciiDocPreview` lazy `import("katex")` when `hasAdocMath`

## 5. Canvas mobile gate

- [x] 5.1 Test first: `CanvasDriver.test.tsx` mobile→desktop resize opens the pending target (red); opened target not re-opened
- [x] 5.2 Record `lastKeyRef` only after `gateAllowsAutoOpen(tier)`

## 6. Verification

- [x] 6.1 Affected suites green (211 tests), client `tsc` clean for touched files
- [x] 6.2 Live instance: title, inline + display math, literal code, 120×443 PlantUML uncropped, long docx scrolls to end, canvas opens after 1280×577→1600×1000 resize from a single push
