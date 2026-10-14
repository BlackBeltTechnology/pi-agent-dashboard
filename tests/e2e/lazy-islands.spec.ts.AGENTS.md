# lazy-islands.spec.ts — index

L3 lazy islands: English cold load requests no `katex`/`i18n-hu`/`i18n-zh-CN`/`SettingsPanel` chunk; opening Settings fetches only the panel chunk; switching to Magyar fetches `i18n-hu` once and translates (rail label `Általános`), back to English refetches nothing; Hungarian cold start renders nothing (`#root` empty) until its catalog arrives. Observes `page.on("request")`. See change: shrink-client-entry-lazy-islands.
