# providers-api.ts — index

Fetch helper for custom-LLM-provider management. Exports `TestProviderInput`, `TestProviderResult` (discriminated union), `testProvider(input)` — POST `/api/providers/test` verifying baseUrl+apiKey+api against upstream `/models` without saving; `apiKey` accepts literal, `$ENV_VAR` ref, or `"***"` (resolved server-side from saved provider).
