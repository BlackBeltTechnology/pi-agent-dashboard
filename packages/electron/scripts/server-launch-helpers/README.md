# Manual server-launch helpers

Three self-locating scripts that boot the bundled dashboard server **without
the Electron wrapper** and **without a system Node.js install**. Use them when:

- The Electron wrapper hangs on first launch (AV scanning, bootstrap bug).
- You want to verify a CI artefact is runnable before triaging UI issues.
- You're a tester debugging the server in isolation.

## Files

| File | OS | Invocation |
|---|---|---|
| `start-server.cmd` | Windows | Double-click, or `start-server.cmd [subcommand]` |
| `start-server.ps1` | Windows (PowerShell) | `& .\start-server.ps1 [subcommand]` or right-click → Run with PowerShell |
| `start-server.sh` | Linux / macOS | `./start-server.sh [subcommand]` (chmod +x preserved by bundle) |

`subcommand` defaults to `start`. Other values: `status`, `stop`, `restart`.

## How they work

Each script uses only files that ship inside the bundle:

```
<unzipped-root>/
├── resources/
│   ├── node/
│   │   ├── node.exe                              (Windows)
│   │   └── bin/node                              (POSIX)
│   └── server/                                    ← scripts live here
│       ├── start-server.cmd                       │
│       ├── start-server.ps1                       │
│       ├── start-server.sh                        │
│       ├── packages/server/src/cli.ts             │ entry
│       └── node_modules/jiti/lib/                 │
│           └── jiti-register.mjs                  │ loader
```

The argv they build matches `packages/shared/src/platform/node-spawn.ts`'s
`buildNodeImportArgvParts`:

```
<bundled-node> --import file:///<...>/jiti-register.mjs <raw-path-to-cli.ts> [subcommand]
```

- **Loader position** is wrapped as `file://` URL (Node's ESM resolver requires it).
- **Entry position** is a **raw OS path** (per the JITI VERSION CONTRACT — jiti
  mishandles `file:///` triple-slash URLs on Windows; Node's drive-letter
  heuristic accepts the raw path in argv position).

This is the same shape the Electron main process uses to spawn the server, so
if these scripts work, the Electron-spawned server should too.

## Limitations

- These do not bypass antivirus or first-launch Defender scans. Expect 30-120 s
  of CPU work on Windows the first time you run them.
- They are not desktop launchers — they open a console window and block until
  Ctrl+C (`.cmd` pauses on exit so you can see the exit code; `.ps1` and `.sh`
  return their exit code immediately).
- Multi-instance management is not provided. Use `stop` to terminate.

See change: `add-bundle-manual-launch-scripts`.
