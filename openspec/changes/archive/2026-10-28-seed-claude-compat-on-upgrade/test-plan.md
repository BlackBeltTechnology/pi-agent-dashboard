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

### Payload rewrite

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | compat: Rewrite covers the outgoing request's system text | EP | L1 | automated | payload `system` as text-block array (OAuth block + default prompt with `cache_control`) and as a string; real pi 1.4 rendered prompt | `before_provider_request` fires (switch on, anthropic) | docs block rewritten; other block, `cache_control` and `messages` unchanged; input payload not mutated |
| P2 | compat: Rewrite covers the outgoing request's system text (no-ops) | decision-table | L1 | automated | switch off / openai / no model / no anchored block / two anchored blocks / already rewritten / no `system` / non-object payload | `before_provider_request` fires | handler returns `undefined` |

| P3 | compat: Every pi instance receives the rewrite (subagent child) | state-transition | L1 | automated | process-global bridge state with `claudeSubscriptionCompat` ∈ {true→false, absent}; second `pi` (subagent child) | dashboard extension default export runs on the child, then `before_provider_request` fires on anthropic | true → `system` rewritten; after flipping to false and with no value → returns `undefined` |
| P4 | compat: Anthropic row shows and controls the switch (no plugin dependency) | decision-table | L1 | automated | switch on/off × flows plugin enabled/disabled | `ProviderAuthSection` renders | `claude-compat-needs-flows` never present |

### Manual

| id | requirement | level | disposition | steps | expected |
|----|-------------|-------|-------------|-------|----------|
| M2 | compat: already-open session end to end | manual | manual-only | session started before the switch was on; switch on; send a prompt that runs one tool | both the tool-call request and the follow-up succeed on the subscription |
| M3 | compat: subagent end to end | manual | manual-only | switch on; fresh `pi -p` spawning a Haiku 5.5 subagent | subagent replies; parent and child both log `[dashboard] claude-compat: state=applied` |
| M1 | compat: upgrade path end to end | manual | manual-only | delete `claudeSubscriptionCompat` from `~/.pi/dashboard/preferences.json` on a machine with an `anthropic` sign-in, restart the server | Providers › anthropic row shows the switch on; an Opus request on the subscription succeeds |
