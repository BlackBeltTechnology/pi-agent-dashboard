# DOX — tests/e2e/live-preview

Config-owned by `playwright.live-preview.config.ts` (ignored by the default config). One row per file. See README.md.

| File | Purpose |
|------|---------|
| `README.md` | Infra overview: host-run isolated server, projects, fixtures, how to write a spec, engine notes. |
| `isolated-server.ts` | Start/stop/restart the isolated dashboard (temp HOME, free port + 20-port pool, base `previewOrigins` config, Node >= 26 resolution); `IsolatedServer` worker handle (`restart`, `config`, log capture, `api`, `rawRequest`, local-proof code). Run state in `STATE_PATH`. |
| `global-setup.ts` / `global-teardown.ts` | Start the server once per run / kill it and delete its HOME. |
| `upstream.ts` | Controllable upstream dev server (static page, scriptable `/`, HMR-like module + WS, request log). |
| `operator.ts` | `Operator` (local-proof auth, fake bridge sessions, open the viewer through the real UI) + `LiveViewer` handle. |
| `fixture.ts` | `test`/`expect` with `isolatedServer`, `upstream`, `operator`, `livePreview`, `dashHost`/`dashOrigin`/`baseURL`. |
| `tier1-origin.spec.ts` | Tier 1 in a real browser: F1 origin shape, F5 trailing dot, F3 reuse + localStorage, F4 localhost vs 127.0.0.1. |
| `tier1-isolation.spec.ts` | Preview isolation: F28 CORS/WS, F27 + F37 nested dashboard renders nothing, F36 navigation guard. |
| `host-gate-refusal.resolver.spec.ts` | F22 duplicate-cookie refusal page (chromium-resolver, host `dash.test`). |
| `resolver-tiers.resolver.spec.ts` | Infra smoke: dash.test → tier 2, dash5.test → tier 5. |
| `infra.spec.ts` | Infra smoke: `restart({patch})`/`restart({reset})` + rollback (`enabled:false` → legacy path), log capture. |
