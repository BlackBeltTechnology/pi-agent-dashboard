# DOX — packages/extension

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Bridge extension that forwards pi session events to a dashboard server. Install via `pi package add`. Lists bundled skills + `agents/`. |
| `agents/DoxTriage.md` | Package-tier subagent (`agents/` in `files[]` → resolver tier 4). Judges a DOX row KEEP vs REWRITE from the `kb dox triage` diff. `model: "@fast"`, `inherit_context: false`, tools `[read, bash, kb_search, kb_get]`. Biased to KEEP — false REWRITE corrupts good docs, false KEEP leaves a row no worse. Preserves `See change:` + sidecar pointers. NOT duplicated in repo `.pi/agents/`; tier 4 only resolves for USER-SCOPE installs. |
| `vitest.config.ts` | Vitest config for extension package. Includes `src/**/__tests__/**/*.test.ts`, node env, `forks` pool, `maxWorkers: "50%"`, globalSetup `setup-home.ts`, per-file HOME isolation via `setup-home-perfile.ts` for `providers.json` write races. |
