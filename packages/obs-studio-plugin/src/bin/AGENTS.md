# DOX — packages/obs-studio-plugin/src/bin

| File | Purpose |
|------|---------|
| `cli.ts` | `main(argv, deps)`: flag parsing, verb dispatch (offline vs live), `--json`, exit codes (0/2/1), provision orchestration; `capture refresh [--input]`, `wake-hook install|uninstall|run` (consent via `confirm`, `launchctl` through `d.run`). Pure over `CliDeps`. |
| `pi-obs.ts` | Process entry: wires real deps (exec, process-scan, JXA displays, fetch), exits after flushing stdout. |
