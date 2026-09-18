# DOX — packages/deck3d/src/render

`deck.html` renderer: fixed template + inlined runtime + canonical IR + base64 font. See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `index.ts` | `renderDeck(ir)` → self-contained HTML. Applies overrides, serialises the merged deck with sorted keys and escapes `<`/U+2028/U+2029 (`jsonForScript`), inlines `dist/runtime.js` verbatim and the base64 Poppins TTF. `ensureRuntime()` builds `dist/runtime.js` on demand via esbuild when absent (dev/CI). Same IR + runtime + font ⇒ byte-identical HTML; no dates/random. |
| `template.html` | Inert shell: Poppins `@font-face`, `window.__DECK`/`__DECK_FONT` inline, `__RUNTIME__` script slot; placeholders stay valid JS so Biome can parse it. |
