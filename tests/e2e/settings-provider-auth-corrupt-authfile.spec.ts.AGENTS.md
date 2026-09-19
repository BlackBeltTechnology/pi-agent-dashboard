# settings-provider-auth-corrupt-authfile.spec.ts — index

L3 (X13 + repair rows, fix-corrupt-auth-json-500 + redesign-providers-settings-page). Zeroes `auth.json` via `docker exec`, asserts `GET /api/provider-auth/status` stays `200` array with every row `authenticated:false`, and drives the Add-dialog repair flow against the corrupt file. Restores the seeded bytes in `finally`. → see `settings-provider-auth-corrupt-authfile.spec.ts.AGENTS.md`
