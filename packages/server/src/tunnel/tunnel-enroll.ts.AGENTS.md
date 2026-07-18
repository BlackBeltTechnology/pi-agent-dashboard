# tunnel-enroll.ts — index

Whitelisted `(provider,step)` enroll executor — `runEnrollStep`, `ENROLL_STEPS`, `isEnrollStepWhitelisted`. FROZEN recipe map; strict allow-list validators (no cmd.exe metachars) → token is a validated single argv element (RCE-safe incl. Windows `.cmd`); secret never logged, redacted from errors; runs via `runner.ts` with per-recipe timeout. install NOT whitelisted (copy-paste only). Powers `POST /api/tunnel/enroll`. See change: add-tunnel-providers.
