# pick-node.ts — index

`pickNodeForServer(PickNodeInput): PickNodeResult` — discriminated union `{kind:"bundled"\|"execpath-fallback"}`. 2 strategies: bundled `Resources/node/bin/node` (POSIX) / `Resources/node/node.exe` (Win) → `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Fallback is corrupted-install signal, not normal mode. nodejs/node#58515 skip logic removed; bundled Node always pinned safe. See change: eliminate-electron-runtime-install.
