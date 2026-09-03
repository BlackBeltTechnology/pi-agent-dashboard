# Pi Dashboard Server

The Pi Dashboard server — aggregates events from every connected pi session,
persists them, and serves the web client.

## Install

```bash
npm install -g @blackbelt-technology/pi-dashboard-server
pi-dashboard          # start the server
pi-dashboard --dev    # proxy to a Vite dev server
```

Runs two WebSocket servers (one for bridge extensions, one for browser clients),
keeps state in memory with JSON persistence, and exposes a REST API under `/api`.

Most users want the `@blackbelt-technology/pi-agent-dashboard` metapackage instead,
which bundles this server together with the bridge extension and web client.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
