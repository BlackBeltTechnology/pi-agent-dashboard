# DOX — packages/deck3d/src/render

`deck.html` renderer: fixed template + inlined runtime + canonical IR + base64 font. See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `index.ts` | `renderDeck(ir, {runtime, font, props})` → self-contained HTML. Applies overrides (deck+slide effects, props), appends the render-only `credits` slide when a prop licence needs attribution, serialises the merged deck with sorted keys and escapes `<`/U+2028/U+2029 (`jsonForScript`), single-pass substitutes `__DECK__`/`__DECK_PROPS__`/`__DECK_LOCAL_FX__`/`__FONT__`/`__RUNTIME__`/`__TITLE__`, subsets the font to the merged glyph set, inlines `dist/runtime.js` verbatim. `pkgRoot()`-based paths; `ensureRuntime()` builds `dist/runtime.js` on demand via esbuild when absent (dev/CI). Same IR + runtime + font + props + `fx/` bytes ⇒ byte-identical HTML; no dates/random. `loadLocalEffects(ir, jsonPath)` re-checks every `local:` referent and throws before any HTML is written; sources are embedded through `jsonForScript` so a `</script>` inside a module cannot terminate the block. Also attaches `overriddenKeys` + `derivedHash` to the merged payload (the configurator needs both; the merged view alone cannot tell which values came from `overrides`). See change: deck3d-cinematic-worlds. |
| `font.ts` | `glyphText(merged)` (every rendered string) + `subsetFont(font, text)` (opentype.js rebuild with only the used glyphs) + `freezeHead` (zeroes `head.checkSumAdjustment` + `created` + `modified` so subset bytes are clock-independent). |
| `template.html` | Inert shell: Poppins `@font-face`, `window.__DECK`/`__DECK_PROPS`/`__DECK_FONT`/`__DECK_LOCAL_FX` inline, `__RUNTIME__` script slot; placeholders stay valid JS so Biome can parse it. Also the configurator markup + CSS (`#deck3d-hud-toggle` gear, `#deck3d-hud` panel, `display:none` by default). See change: deck3d-cinematic-worlds. |
