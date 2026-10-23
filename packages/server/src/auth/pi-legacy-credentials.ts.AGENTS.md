# pi-legacy-credentials.ts — index

Plain-text API keys in pi `settings.json` (`anthropicApiKey`,`openaiApiKey`,`apiKey`,`providers.<id>.apiKey`): `detectLegacyCredentials` (masked, auth state `none`/`same`/`different`, `timingSafeEqual`), `maskSecret`, `applyLegacyCredentialActions` (3 phases: plan under settings lock → `writeCredentialIfAbsent` per move → delete under settings lock with token re-check; no path deletes the last copy), `withoutLegacyValues`. Only masked values leave. See change: pi-settings-full-coverage.
