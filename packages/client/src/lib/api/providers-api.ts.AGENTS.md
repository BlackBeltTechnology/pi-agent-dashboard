# providers-api.ts — index

Fetch helper for custom-LLM-provider management. Exports `TestProviderInput`, `TestProviderResult` (discriminated union), `ProviderHealth` (`{ok,status?,error?,modelCount?,testedAt}` — credential-free cached health returned under `GET /api/providers` `health[name]`; see change surface-provider-health-in-settings), `testProvider(input)` — POST `/api/providers/test` verifying baseUrl+apiKey+api against upstream `/models` without saving; `apiKey` accepts literal, `$ENV_VAR` ref, or `"***"` (resolved server-side from saved provider).

`refreshProviderModels(name)` — POST `/api/providers/:name/refresh` (percent-encoded) → `{ok:true,health}` | `{ok:false,error}`; never throws. Tests: `src/lib/api/__tests__/providers-api-refresh.test.ts`. See change: add-provider-models-refresh.
