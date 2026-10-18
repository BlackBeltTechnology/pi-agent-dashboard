# DOX — packages/photocraft

Deprecated shim. Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Deprecation notice: superseded by `@blackbelt-technology/pi-dashboard-craft-apps`; migrate + rollback steps. See change: add-craft-apps-core. |
| `bin/pi-photocraft` | Plain-JS launcher. Resolves `@blackbelt-technology/pi-dashboard-craft-apps/package.json`, spawns its `bin/pi-photocraft` with args/stdio, propagates exit code + SIGINT/SIGTERM. Keeps the old launcher path valid for existing `<cwd>/.pi/mcp.json` entries. Exit 1 with an install hint when craft-apps is unresolvable. |
| `package.json` | Manifest. Same name; only dependency craft-apps; `files` = `bin/`, `README.md`; no `pi.skills`. |
| `src/__tests__/shim.test.ts` | Shim invariants: deps/files/bin, `--help`/`ensure`/`exec` forwarding + exit code, legacy `node <launcher> mcp` entry still starts the confined MCP server, unresolvable craft-apps message. |
| `vitest.config.ts` | Vitest config (forks pool, HOME tripwire). |
