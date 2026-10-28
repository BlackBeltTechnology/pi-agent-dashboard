# Test Plan — seed-claude-compat-on-upgrade

Stage: design   Generated: 2026-10-28

Clarifications resolved before writing (user, 2026-10-28): any `anthropic` credential type counts; a first start with no credential stores off.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | compat: Global compat switch defaults to off (seed) | decision-table | L1 | automated | `preferences.json` field ∈ {absent, `true`, `false`, `"yes"`} × `hasAnthropicCredential` ∈ {returns true, returns false, returns undefined, not provided} | `createPreferencesStore` loads, then `flush()` | absent+true → reads true, file stores `true`; absent+false → reads false, file stores `false`; absent+undefined → reads false, file has no `claudeSubscriptionCompat`; absent+not provided → reads false, no field stored; stored `true`/`false` → unchanged and the dependency is never called; `"yes"` treated as absent |
| S2 | compat: Global compat switch defaults to off (seed runs once) | state-transition | L1 | automated | file without the field, dependency returns true | load, flush, then `setClaudeSubscriptionCompat(false)`, flush, reload with the dependency still returning true | second load reads false; dependency not called on the second load |
| S3 | compat: credential check wiring (design D2) | EP | L1 | automated | `auth.json` content ∈ {missing file, `{}`, `{"anthropic":{"type":"oauth",…}}`, `{"anthropic":{"type":"api_key","key":"x"}}`, `{"openai":{…}}`, unparseable} | the exported credential-check helper runs | missing/`{}`/openai → false; oauth/api_key → true; unparseable → undefined; the credential value never appears in output or logs |

### Manual

| id | requirement | level | disposition | steps | expected |
|----|-------------|-------|-------------|-------|----------|
| M1 | compat: upgrade path end to end | manual | manual-only | delete `claudeSubscriptionCompat` from `~/.pi/dashboard/preferences.json` on a machine with an `anthropic` sign-in, restart the server | Providers › anthropic row shows the switch on; an Opus request on the subscription succeeds |
