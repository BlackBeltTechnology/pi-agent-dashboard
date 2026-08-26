# Pi Dashboard Bus Client

Headless, ticket-authenticated WebSocket client for the Pi Dashboard control plane.

One connection carries typed command `send`, correlated `await`/`until`,
bus-consistent `read`, and `plugin` passthrough — so scripts and automation can
drive a dashboard without a browser.

## Install

```bash
npm install @blackbelt-technology/pi-dashboard-bus-client
```

Zero UI dependencies. Protocol types come from
`@blackbelt-technology/pi-dashboard-shared`.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
