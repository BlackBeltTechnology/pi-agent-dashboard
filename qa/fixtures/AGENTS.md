# DOX — qa/fixtures

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `e2e-custom.ext.ts` | pi extension fixture (change: render-inline-reasoning-and-custom-entries): `e2e_custom_message` → `pi.sendMessage`, `e2e_custom_entry` → `pi.appendEntry`. Also returns a canned `session_before_compact` result so `/compact` persists a real `compaction` entry with NO model round-trip (change: replay-compaction-boundary). Adds `e2e_footer_segment({text,icon})` → stores a `footer-segment` decorator (namespace `e2e`, id `lazy-icon`) served from a `ui:list-modules` listener, then emits `ui:invalidate`; published only after the tool runs. See change: harden-ios-safari-memory-and-ws-diagnostics. |
| `e2e-notify.ext.ts` | pi extension fixture: the only L3 lever on `ctx.ui.notify`. → see `e2e-notify.ext.ts.AGENTS.md` |
| `faux-agent-ticks.ext.ts` | pi extension fixture (change: reduce-bridge-tick-bandwidth). → see `faux-agent-ticks.ext.ts.AGENTS.md` |
| `faux-provider.ext.ts` | pi extension fixture. Builds faux provider via pi-ai `fauxProvider({api:"faux"})`. → see `faux-provider.ext.ts.AGENTS.md` |
| `faux-scenarios.ts` | Shared scenario catalog `SCENARIOS: Record<id,{script,expect}>`. → see `faux-scenarios.ts.AGENTS.md` Adds the `om-entry` scenario (`e2e_custom_entry` → `om.observations.recorded`) for E2E F15. See change: add-custom-entry-renderer-slot. Adds `footer-icon` scenario (`e2e_footer_segment` with `FOOTER_ICON_TEXT`/`FOOTER_ICON_KEY`=`mdiCheckDecagram`, tail `FOOTER_ICON_TAIL`) for E2E F2. See change: harden-ios-safari-memory-and-ws-diagnostics. |
| `faux-roles.json` | Faux role-preset (change: add-flow-plugin-e2e-tests). Maps every built-in role… → see `faux-roles.json.AGENTS.md` |
| `README.md` | Documents faux fixtures: purpose, `fauxProvider`+`pi.registerProvider` recipe, `streamSimple`… → see `README.md.AGENTS.md` |
