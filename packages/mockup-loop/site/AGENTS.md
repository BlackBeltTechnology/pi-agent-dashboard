# DOX — packages/mockup-loop/site

Files in this directory. One row per file.

| File | Purpose |
|------|---------|
| `Site.tsx` | Generic mock-site shell (browser, English only). `Site()` → `PaneOnly` for `?pane=<id>/<frame>/<side>` (phone iframe: 375px content, posts height, answers `mkFind`→`mkFound` ring lookups, error panel on bad spec) else `Shell`: sidebar search/categories/status pills/Show accepted-rejected/problems list, sticky bar Accept page/Reject page/Reopen (hidden when `canDecide` false) + theme buttons, page stays shown after a decision, deep-link scroll to deepest `r-<ref>` + `.mk-hit` flash, live refresh on HMR `mock:decisions`. Reads `virtual:mock-site/config` + `/mocks`. See change: add-live-component-mock-site. |
| `kit.tsx` | Mock authoring kit, imported as `mock-site/kit`. Types `Mock` (no id: dir name is id), `Frame`, `Status`, `Decision`. `Issue` (red) / `Fix` (green) rings: badge = child of ring (no scroll lag, under sticky bar), tip portal closed on scroll, `TIP > 40` / `BAD N` lint. `RefBase` context, `RefLink` (copies URL, `target=_top`), `tipsOf`. See change: add-live-component-mock-site. |
| `main.tsx` | Browser entry served by the plugin's HTML middleware: awaits project `setup()` from `virtual:mock-site/app`, renders `<Providers><Site/></Providers>`. See change: add-live-component-mock-site. |
| `site.css` | Plain-CSS chrome (no Tailwind), `mk-` prefix, colours only via `--mk-*` tokens. `html body` specificity (bar = page colour), bar z-index 2147483000, `.mk-canvas` `contain: layout paint; isolation: isolate`, phone iframe content-box 375px + zero pane padding + inset badge. See change: add-live-component-mock-site. |
| `tsconfig.json` | Browser-side type-check (`tsc -p site`): bundler resolution, react-jsx, allowJs for `../src/mock-site/refs.mjs`. See change: add-live-component-mock-site. |
| `virtual.d.ts` | Ambient types for `virtual:mock-site/config|mocks|app`, `*.css`, `import.meta.hot`. See change: add-live-component-mock-site. |
