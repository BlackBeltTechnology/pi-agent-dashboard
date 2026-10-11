# DOX — packages/deck3d/src/pptx

`deck3d pptx import`: OOXML → `layout.json` + media + baseline deck, TypeScript only (no Python, no Docker). Spec deck3d-pptx-import.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `types.ts` | `layout.json` types (`Layout`, `LayoutSlide`, items `text`/`rect`/`img`/`fallback`), `MediaFile`, `PptxImportError`. Slide space = 1920 units wide, aspect kept. See change: deck3d-pptx-import. |
| `zip.ts` | Guarded zip reader (D1): OLE sniff (encrypted vs not-OOXML), central-directory pre-check (4000 entries, 128 MiB/entry, 512 MiB total, zip-slip names), streaming `fflate` `Inflate` counting ACTUAL bytes (ratio 200:1 at ANY size, declared and actual), `<!DOCTYPE` scan of XML parts only. `ZipLimitError.inflated` = bytes at abort. See change: deck3d-pptx-import. |
| `xml.ts` | Ordered tree over `fast-xml-parser` (`processEntities:false`); decodes the 5 predefined entities + numeric refs itself. `child/kids/path/descendant`. See change: deck3d-pptx-import. |
| `package.ts` | `Package`: parts, relationships, `readPresentation` (slide size, slide → layout → master → theme chain). See change: deck3d-pptx-import. |
| `theme.ts` | Theme colours/fonts, `resolveColor` (srgb/scheme/sys/prst + lumMod/lumOff/tint/shade/satMod/alpha via HSL), `luminance`. See change: deck3d-pptx-import. |
| `xfrm.ts` | EMU → slide units and `groupFrame` composition (offset/scale/rotation/flip, nested). See change: deck3d-pptx-import. |
| `text.ts` | `readTextBody`: list-style inheritance chain, STORED `normAutofit` fontScale/lnSpcReduction (never recomputed), anchor/insets/vertical, `wordArt` flag. See change: deck3d-pptx-import. |
| `master.ts` | `MasterChain`: layout/master placeholder geometry + text styles + `txStyles` families. See change: deck3d-pptx-import. |
| `shapes.ts` | `walkTree`: sp/cxnSp/pic/graphicFrame/grpSp → `Draft` items; supported matrix `rect line ellipse roundRect`, PNG/JPEG/GIF/SVG; everything else → `fallback` with its construct. See change: deck3d-pptx-import. |
| `media.ts` | `MediaRegistry`: content-hash names `m-<12 hex>.<ext>`, identical bytes stored ONCE as a file, but every part keeps its own stable `pptx-<part slug>` asset id (`assetEntries`). See change: deck3d-pptx-import. |
| `extract.ts` | `extractPptx` (slides → drafts, backgrounds, master items, fingerprints), `finalizeLayout` (assign `sNN`/`sNN-iMMM`), `stableStringify` (sorted keys → byte-stable JSON). See change: deck3d-pptx-import. |
| `fallback.ts` | `applyFallbacks`: crop the reference render at the item's rotated bounding rect (or leave a placeholder) + one warning each. See change: deck3d-pptx-import. |
| `ref.ts` | Reference renders: `--ref` filename grammar (`Slide1.PNG`, `Deck - 2.png`, `slide_3`, `4`), else LibreOffice + `pdftoppm`, else one warning. See change: deck3d-pptx-import. |
| `baseline.ts` | Baseline `deck.md`/overrides, `matchSlideIds` (fingerprint → title+position → next number), `reconcileAssets` (user assets untouched; vanished referenced asset fails). See change: deck3d-pptx-import. |
| `stage.ts` | `Stage`: sibling temp dir; commit swaps entries with an aside and ROLLS BACK every swapped entry if any rename fails, so a failed re-import leaves the deck as it was. Injectable write + rename hooks. See change: deck3d-pptx-import. |
| `import.ts` | `importPptx`: orchestrates the above; `preserveUserFiles` carries user assets that live inside `pptx/` into the staged tree (a conflicting claim on an imported path fails); validates the generated deck before commit (`validateGenerated`: user assets/local fx against the EXISTING deck dir, imported `pptx-` assets against staging); `--force` keeps overrides, writes `deck.json.bak`. See change: deck3d-pptx-import. |
