# DOX — qa/fixtures

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `e2e-notify.ext.ts` | pi extension fixture: the only L3 lever on `ctx.ui.notify`. → see `e2e-notify.ext.ts.AGENTS.md` |
| `faux-agent-ticks.ext.ts` | pi extension fixture (change: reduce-bridge-tick-bandwidth). → see `faux-agent-ticks.ext.ts.AGENTS.md` |
| `faux-provider.ext.ts` | pi extension fixture. Registers faux provider via pi-ai `registerFauxProvider({api:"faux"})`. → see `faux-provider.ext.ts.AGENTS.md` |
| `faux-scenarios.ts` | Shared scenario catalog `SCENARIOS: Record<id,{script,expect}>`. → see `faux-scenarios.ts.AGENTS.md` |
| `faux-roles.json` | Faux role-preset (change: add-flow-plugin-e2e-tests). Maps every built-in role… → see `faux-roles.json.AGENTS.md` |
| `README.md` | Documents faux fixtures: purpose, `registerFauxProvider`+`pi.registerProvider` recipe, `streamSimple`… → see `README.md.AGENTS.md` |
