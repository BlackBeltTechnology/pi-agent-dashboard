# invoicebot-plugin

InvoiceBot REST plane. Wraps the four `ib_*` selectors over
`POST /api/plugins/invoicebot/{query,review,setup,rules}`, keyed by `cwd`, behind
an `InvoiceEngine` port. Pure ops → port; five flow-triggering ops → port DB
effect + dispatch `flow:run` into the workspace session. Server-only (no client;
WS conversation plane deferred). See change: add-invoicebot-rest-plugin.

Client contract: `openspec/changes/add-invoicebot-rest-plugin/api-contract.md`.

| File | Purpose |
|------|---------|
| `package.json` | Manifest `pi-dashboard-plugin` (id `invoicebot`, `server: ./src/server/index.ts`, `bridge: ./src/bridge/index.ts`). Deps: dashboard-plugin-runtime, pi-dashboard-shared. ⚠️ `optionalDependencies["@blackbelt-technology/invoicebot"] = file:../../../pi-invoice-bot` — `TODO(release)` in `//optionalDependencies` key. Optional so CI/release/worktree install clean + bind Fake. |
| `src/bridge/index.ts` | Bridge entry (pi extension in-session): subscribes declared `ib:*` channels via `pi.events.on` (observes foreign engine facade), re-emits each as generic `dashboard:plugin-message` `{pluginId:"invoicebot", messageType:"ib_domain_event", payload:{eventType,data}}`. See change: relocate-ib-domain-events-to-plugin. |
| `src/shared/ib-events.ts` | Single owner of `ib:*` vocabulary: `IB_CHANNELS` (16), mechanical `renameIbChannel` (`:`/`-`→`_`), `isDeclaredIbChannel`, envelope constants. See change: relocate-ib-domain-events-to-plugin. |
| `src/__tests__/ib-bridge-entry.test.ts` | Bridge-entry unit: foreign-facade emissions observed via shared bus, exact envelope, undeclared channel not forwarded, payload verbatim. |
| `src/__tests__/ib-events.test.ts` | Declaration + mechanical-rename unit for the 16 lifecycle channels. |
| `README.md` | Package overview: port binding (Real/Fake), pure vs flow-triggering split, ⚠️ interim `file:` link + exit. |
| `tsconfig.json` | Extends root base. `jsx: react-jsx` + DOM libs (transitive runtime `.tsx`). `noEmit`. |
| `vitest.config.ts` | node env, `src/**/__tests__/**/*.test.ts`, shared setup-home globalSetup. Registered in root `vitest.config.ts` projects. |
