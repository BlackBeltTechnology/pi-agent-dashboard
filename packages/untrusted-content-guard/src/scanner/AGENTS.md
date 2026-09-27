# DOX — packages/untrusted-content-guard/src/scanner

Deterministic scanner layers (design D1). Pure; same input → same output + findings. See change: add-untrusted-content-guard.

| File | Purpose |
|------|---------|
| `ansi.ts` | `ansiLayer(text, findings)` — strips OSC/CSI/8-bit CSI/2-char ESC; one HIGH `ansi` finding, count = sequences. Fast path without ESC/0x9B. |
| `findings.ts` | `Finding {layer,severity,count,sample}`, `FindingSet` (aggregate by layer id, first sample, insertion order), `visibleEscape` (invisibles → `U+XXXX`), `truncateSample` (≤ `SAMPLE_MAX`=80). |
| `html.ts` | `isHtml(text, contentType?)` (`text/html` or `^\s*<(!doctype html\|html)`). `htmlLayer(src, findings, apply)` on htmlparser2 `Parser` source ranges: removes hidden elements with text or comments (inline style + simple type/.class/#id `<style>` rules resolved by specificity then source order, inline last; `hidden` attr; `<script>`; comments) and rewrites only changed decoded text nodes (Unicode+ANSI, re-escape `&<>`); never re-serialises. Complex hiding selector → LOW `unresolved_css`. Implied close → range ends at trigger `startIndex`; EOF-unclosed → end of document. `<style>` text never rewritten. Stylesheets found by `indexOf` (`forEachCssRule`), never a retrying regex — linear on unclosed `<style>` / brace-free CSS. |
| `phrase.ts` | `phraseLayer` — versioned (v1, in header comment) instruction-phrase regexes; LOW `phrase` only, never removes. |
| `scan.ts` | `scan(input, {mode,contentType,allowHosts,maxChars})` → `{cleaned,findings,html}`. Order: `MAX_SCAN_CHARS` (2 MiB) cap + HIGH `oversize_truncated` → HTML (parser throw → HIGH `html_parse_failed` + plain-text fallback) or Unicode → ANSI → URL → phrase. `warn` returns capped input unchanged. |
| `unicode.ts` | `unicodeLayer(text, findings, rtlContext?)` — HIGH `unicode-zero-width`/`unicode-tags`/`unicode-variation-selectors`/`unicode-bidi`; LOW `unicode-bidi-rtl` (kept). Preserves emoji ZWJ, Brahmic/Arabic ZWJ/ZWNJ only with a cluster script on BOTH sides, ZWSP beside Thai/Lao/Khmer/Myanmar/CJK, LRM/RLM. Never entity-decodes. `hasRtl`. |
| `url.ts` | `urlLayer(text, findings, {replaceData, allowHosts})` — HIGH `data-url` (case-insensitive scheme; strip/block → `[data-url removed: <mime>, <n> bytes]`); LOW `tracking-image` (markdown/HTML `<img>` query-string URL, host not in `allowHosts`); LOW `confusable` (Latin + Cyrillic/Greek word in a domain, markdown or HTML `<a>` link text). Tag scans bounded `{0,2000}` → linear. |
