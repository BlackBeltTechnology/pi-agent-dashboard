# Pi Dashboard Subagents Plugin

Built-in Pi Dashboard plugin providing the subagent inspector — `SubagentDetailView`,
`SubagentPopoutPage`, and the timeline-entry types.

Claims the `settings-section` and `shell-overlay-route` slots. Consumes the wire
contract emitted by `@blackbelt-technology/pi-dashboard-subagents`.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so plugin authors can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
