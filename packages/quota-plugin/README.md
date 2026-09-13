# Provider Quota plugin

Surfaces per-account **subscription quota** (how much plan budget is left) for
supported OAuth providers — Anthropic, GitHub Copilot, Kimi Coding, OpenAI Codex,
OpenRouter, Synthetic, Z.ai — in the dashboard's cross-session web UI. This is the
"how much is left" axis, distinct from the context window and per-request
API-key rate-limit headers.

## Shape: server fetches, client renders. No bridge.

Quota is an **account-level** fact, so the dashboard **server entry** resolves
credentials through the host's own auth abstraction
(`InternalAuthStorage` + `readAuthJson`, with OAuth refresh — never a hardcoded
`~/.pi/agent/auth.json` path) and fetches directly via
[`@latentminds/pi-quotas`](https://www.npmjs.com/package/@latentminds/pi-quotas)
(pinned `0.4.0`; owns per-provider TTL caching + in-flight dedup). Only derived
`QuotaWindow[]` reach the client — **tokens never leave the server**.

`GET /api/quota` → `{ providers: [{ provider, windows[] }] }`. A `quota_update`
browser message is broadcast on refresh. No event-store persistence.

## Disabled by default · per-provider

No quota endpoint called unless both gates true: master toggle
`plugins.quota.enabled` AND `plugins.quota.providers.<id>.enabled`. None turned
on by migration/upgrade.

Subscription endpoints undocumented; programmatic calls may breach provider
consumer terms — **personal/local, single-user use only**. UI displays printed
ToS warning (no `acknowledgedToS` gate). See change proposal for full ToS
analysis.

## Client surface

- `composer-context-group` → `QuotaWidget`: a `Quota` group in the composer context strip (after GIT, before STATUS, not streaming-gated). One chip per provider, EVERY window inline (`5h [bar] 14%  7d [bar] 32%`), fill coloured by pace severity, `now` tick, dashed `not live` tag when the server marks the provider `stale`. Chip matching the session model provider (prefix of `session.model` before first `/`) renders first with an accent ring; defined provider absent from `/api/quota` prepends a non-interactive `<model id> · no quota` note, all chips dim. Click opens shared `ui:dialog` pre-selected. No provider with windows → renders nothing. Moved OUT of `content-inline-footer`.
- `settings-section` → `QuotaSettings`: printed ToS warning + master enable
  + per-provider toggles (Anthropic included; no `acknowledgedToS` gate).

Pace math (`src/pace.ts`) is pure, unit-tested, and guards every division so it
never emits `Infinity`/`NaN` or a spurious warning.
