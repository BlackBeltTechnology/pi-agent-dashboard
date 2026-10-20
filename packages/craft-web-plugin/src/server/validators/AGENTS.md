# DOX — packages/craft-web-plugin/src/server/validators

Worker-run (core validator pool), plain ESM, node built-ins only, reject-only, bounded. One dispatcher module registered per edit claim. See change: extend-craft-web-to-all-apps (D7).

| File | Purpose |
|------|---------|
| `dwg.mjs` | `validateDwg`: `AC10xx` at offset 0, R13–R2018 set (`AC1012 AC1014 AC1015 AC1018 AC1021 AC1024 AC1027 AC1032`), ≥ 128 bytes. |
| `dxf.mjs` | `validateDxf`: binary sentinel `AutoCAD Binary DXF\r\n\x1a\0`; ASCII: first non-`999` pair `0/SECTION`, ≤256 head pairs with integer codes, tail ends `0/EOF`. Head ≤1 MiB, tail 4 KiB. |
| `index.mjs` | Dispatcher. `ROUTES` ext → check (`.docx .xlsx .pptx` OOXML, `.odt`, `.rtf`, `.pdf`, `.dxf`, `.dwg`, `.designcraft`, `.scraftz`, `.deckcraft`, `.psd`, raster set, `.svg`, `.vectorcraft`); `validate(bytes, ext)` rejects unknown ext + empty bytes. Drift test pins every edit/sibling ext to a route. `index.d.mts` types. |
| `odf-text.mjs` | `validateOdfText`: first member (local offset 0) STORED `mimetype` = `application/vnd.oasis.opendocument.text`, `content.xml` present. No XML parsed. |
| `ooxml.mjs` | Moved from `server/ooxml-validator.mjs`, behaviour unchanged (edit-office-in-pane-with-craft-web D5); zip reading via `zip.mjs`. `ooxml.d.mts` types. |
| `pdf.mjs` | `validatePdf`: `%PDF-1.[0-7]`/`2.0` in first 1 KiB, `%%EOF` in last 2 KiB. |
| `psd.mjs` | `validatePsd`: `8BPS` + version 1 (PSD) or 2 (PSB), ≥ 26 bytes. |
| `raster.mjs` | `validateRaster(bytes, ext)` + `RASTER_EXTENSIONS`: per-ext signature (`.png` PNG magic, `.jpg/.jpeg` FFD8FF, `.webp` RIFF…WEBP, `.tif/.tiff` II*\0 / MM\0*); PNG bytes fail `.jpg`. |
| `rtf.mjs` | `validateRtf`: `{\rtf1` at offset 0 (not `{\rtf12`). |
| `svg.mjs` | `validateSvg`: full-document bounded tokenizer (no parser/entity expansion). Pre-root only whitespace/BOM/decl/comments/PIs; `<!DOCTYPE`/`<!ENTITY` reject; root local name `svg`; local-name element ban `script foreignObject iframe embed object handler`; `on*` attrs; SMIL `set`/`animate*` `attributeName` `on*`/`href`; char-ref-decoded, whitespace/control-stripped URL values `javascript:`/`vbscript:`/`data:text/html`. P2: 16 MiB ≤ 2 s. |
| `text-window.mjs` | `head`/`tail`/`latin1` bounded windows (`HEAD_MAX` 1 MiB, `TAIL_MAX` 4 KiB), `reject`, `OK`. |
| `vectorcraft.mjs` | `validateVectorcraft`: VectorCraft 0.13.1 JSON — leading `"format": "vectorcraft"` + `"version": <n>` within 4 KiB, ends `}`. No JSON parse. |
| `zip-members.mjs` | `ZIP_RULES` + `validateZipMembers(bytes, ext)`: `.designcraft` mimetype `application/vnd.designcraft+zip` + `document.json`; `.scraftz` exactly one top-level `*.scraft`; `.deckcraft` mimetype `application/vnd.storyteller.deckcraft+zip` + `presentation.json`. |
| `zip.mjs` | Shared central-directory reader: `readZipDirectory` (≤ `MAX_ENTRIES` 10 000, no zip64/multi-disk) → `{entries, view}`; `readZipMember(bytes, view, entry, max)` stored/deflated bounded. |
