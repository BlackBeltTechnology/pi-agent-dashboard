# config.ts — index

Dashboard config loader: `loadConfig()`/`ensureConfig()` read `~/.pi/dashboard/config.json` via `CONFIG_FILE`; owns startup budgets + shared ports. → see `config.ts.AGENTS.md` `AuthConfig.trustedPlugins?: TrustedPluginEntry[]` (`{id, clientSha256?, server?: true}`) = the one operator trust list; `parseTrustedPlugins(raw)` normalizes (string id, 64-hex pin else dropped, `server` only `true`, first id wins); counts as auth content in `parseAuthConfig` presence predicate (`hasTrustedPlugins`). Only `server/src/auth/plugin-trust-store.ts` writes it. See change: decouple-plugins-from-core (task 6.5).

`TlsConfig.acceptBridges` (default false); `parseTlsConfig` yields true only for literal `true`. See change: prove-vault-bridge-tls.

## group-servers-by-identity

`KnownServer.routes[]`; `parseKnownServers` reads legacy + routes shape, host/port mirror = first http route; `toStoredKnownServer`, `knownServersNeedMigration`. Startup never rewrites. See change: group-servers-by-identity.

`CorsConfig.allowZrokWildcard: boolean` (default `false`; only boolean `true` enables; non-object `cors` yields defaults). See change: harden-cors-and-csp-reporting.

`AuthConfig.allowedUsers` / `groupTiers` docs: empty `allowedUsers` + unset `groupTiers` refuses public-IdP login (non-public stays allow-all + warning); `groupTiers` is config-file-only, Settings save keeps it. No parse change. See change: close-security-map-high-findings (D3).

`security?: { trustedTypes?: unknown }` on `DashboardConfig`: `loadConfig()` copies `parsed.security.trustedTypes` RAW (unvalidated; `resolveTrustedTypesMode` validates + warns); never seeded by `ensureConfig()`. See change: enforce-trusted-types-default.
