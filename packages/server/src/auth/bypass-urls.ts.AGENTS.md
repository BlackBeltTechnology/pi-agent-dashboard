# bypass-urls.ts — index

Import-free leaf: `isBypassed(url, bypassUrls)` — `auth.bypassUrls` prefix match (`startsWith`). Extracted from `auth-plugin.ts` so the OAuth plugin AND the universal network guard share ONE predicate without a cycle (the plugin already imports the guard). Keep import-free. The two callers MUST agree — a divergence opens or closes one of the two paths. Re-exported from `auth-plugin.ts` so its import surface is unchanged. See change: add-universal-network-guard.
