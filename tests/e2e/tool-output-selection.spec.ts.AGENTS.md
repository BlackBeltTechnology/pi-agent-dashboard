# tool-output-selection.spec.ts — index

Playwright E2E for selectable tool-output links (task 3.2, change: selectable-tool-output-links). `[[faux:text-linkrefs]]` streams inline-code `src/example.ts https://example.com/page` → FileLink `<button>` + UrlLink `<a>`. Asserts `user-select:text` + `draggable=false` on links; `dragAcross` click-drag crossing a link extends selection (contains link text); plain click still opens (url → popup tab, file → preview overlay). Forces `/api/open-editor` 500. Clipboard (Ctrl+C) half not deterministically assertable.
