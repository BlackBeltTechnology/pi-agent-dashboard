# Pi Dashboard Grammar Plugin

Built-in Pi Dashboard plugin providing composer grammar and spell-check.

Fully self-contained: the client composer UI (`composer-panel` slot), the server
route and LLM backend (`/api/grammar/*`), the settings section, and the
`plugins.grammar.*` config schema all live in this package. The dashboard core
carries zero grammar code.

Corrections render either as an inline redline diff (default) or a before→after
list, switchable via `correctionView`. Trigger with the composer button or ⌘G.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
