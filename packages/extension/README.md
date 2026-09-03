# Pi Dashboard Bridge Extension

The pi extension that connects a running `pi` session to a Pi Dashboard server.

Loaded into every pi session, it forwards session events over a WebSocket to the
dashboard and accepts remote commands (prompt, abort, steer) coming back.

## Install

```bash
pi package add @blackbelt-technology/pi-dashboard-extension
```

Also ships the `pi-dashboard`, `browser`, `project-init` and `doctor` skills, plus
bundled subagent definitions under `agents/`.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
