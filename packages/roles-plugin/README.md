# Pi Dashboard Roles Plugin

Built-in Pi Dashboard plugin providing the model-role settings UI.

Claims the `settings-section` slot on the General tab, so third-party plugins can
replace or augment it through the same slot system.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
