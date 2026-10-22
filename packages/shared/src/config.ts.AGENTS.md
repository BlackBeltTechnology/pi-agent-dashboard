# config.ts — index

Dashboard config loader: `loadConfig()`/`ensureConfig()` read `~/.pi/dashboard/config.json` via `CONFIG_FILE`; owns startup budgets + shared ports. → see `config.ts.AGENTS.md` `AuthConfig.trustedPlugins?: TrustedPluginEntry[]` (`{id, clientSha256?, server?: true}`) = the one operator trust list; `parseTrustedPlugins(raw)` normalizes (string id, 64-hex pin else dropped, `server` only `true`, first id wins); counts as auth content in `parseAuthConfig` presence predicate (`hasTrustedPlugins`). Only `server/src/auth/plugin-trust-store.ts` writes it. See change: decouple-plugins-from-core (task 6.5).

## group-servers-by-identity

`KnownServer.routes[]`; `parseKnownServers` reads legacy + routes shape, host/port mirror = first http route; `toStoredKnownServer`, `knownServersNeedMigration`. Startup never rewrites. See change: group-servers-by-identity.
