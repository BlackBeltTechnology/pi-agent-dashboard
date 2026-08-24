# Provider Quota plugin

Surfaces per-account **subscription quota** (how much plan budget is left) for
non-Anthropic OAuth providers — Codex, Copilot, OpenRouter, Synthetic, Z.ai,
OpenCode Go, Kimi Code — in the dashboard's cross-session web UI. This is the
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

## Disabled by default · ToS-gated · per-provider

No quota endpoint is called unless **all three** gates are true:
`plugins.quota.enabled` AND `plugins.quota.acknowledgedToS` AND that provider's
`plugins.quota.providers.<id>.enabled`. None are ever turned on by
migration/upgrade. **Anthropic is excluded** (pi blocks Claude subscription
inference server-side; API-key sessions return `not_applicable`).

The subscription endpoints are undocumented and calling them programmatically
may breach provider consumer terms — **personal/local, single-user use only**.
See the change proposal for the full ToS analysis.

## Client surface

- `content-inline-footer` → `QuotaWidget`: one mini-slider per enabled provider,
  fill coloured by **pace severity** (worst window drives it), a `now` tick,
  minimal `over by X%` tooltip. Click → the shared `ui:dialog` primitive with an
  `All · per-provider` selector.
- `settings-section` → `QuotaSettings`: ToS acknowledgement gate + master enable
  + per-provider toggles.

Pace math (`src/pace.ts`) is pure, unit-tested, and guards every division so it
never emits `Infinity`/`NaN` or a spurious warning.
