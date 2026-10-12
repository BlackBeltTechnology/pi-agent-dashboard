# DOX — packages/server/src/package

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `installed-package-enricher.ts` | Enriches raw `packageManagerWrapper.listInstalled()` rows with version, description, displayName,… → see `installed-package-enricher.ts.AGENTS.md` |
| `npm-search-proxy.ts` | Cached proxy for npm registry search (`keywords:pi-package`) + README/meta fetch. → see `npm-search-proxy.ts.AGENTS.md` |
| `package-health-scanner.ts` | Classifies `packages[]` entries `ok`\|`stale-npm`\|`missing-path`\|`duplicate`. Exports `scanPackageHealth(rows, deps?)` (pure over injected fs), `formatHealthSummaryLine`, `hasHealthIssues`, `logPackageHealthAtBoot` (log-only, never throws). Duplicates group by `package.json#name` → id `dup:<lowercased name>`. Existing dir without `package.json` stays `ok`. See change: add-package-health-cleanup. |
| `package-manager-wrapper.ts` | Thin serialized adapter around pi's `DefaultPackageManager`. → see `package-manager-wrapper.ts.AGENTS.md` |
| `package-source-helpers.ts` | Pure helpers classifying pi package sources + computing dedup identities. → see `package-source-helpers.ts.AGENTS.md` |
| `provider-catalogue-cache.ts` | In-memory cache of most-recently-pushed provider catalogue (`providers_list` over WS). → see `provider-catalogue-cache.ts.AGENTS.md` |
| `provider-probe.ts` | Provider probe — pings custom LLM provider base URL + API key to verify reachability/auth. → see `provider-probe.ts.AGENTS.md` |
