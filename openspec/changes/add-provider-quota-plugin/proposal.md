# Surface per-session provider quota in the dashboard (quota plugin)

## Why

The dashboard monitors pi sessions remotely but shows **nothing about how much
subscription quota is left** on the provider each session runs on. Operators
running Claude Max / Codex / Copilot sessions can't see "am I about to get cut
off" until a session actually hits a limit. This is the "how much is left"
(subscription/plan budget) axis — distinct from the context window and from
per-request API-key rate-limit headers.

Worse, a raw "45% used" number is not actionable on its own: 45% at hour 1 of a
5-hour window is a fire; 45% at hour 4 is fine. Operators need a **burn-rate /
pace** signal — is usage outrunning the clock? — not just a fill bar.

There is no documented provider API for this, but the pi ecosystem has already
solved it: **`@latentminds/pi-quotas`** (MIT) wraps the same undocumented OAuth
usage endpoints the CLIs use internally, behind a clean, normalized core.

### Verified enabling facts (spiked against this repo's live credentials)

The core library was pulled (`npm pack @latentminds/pi-quotas@0.4.0`) and driven
directly with a 2-method `AuthStorage` shim reading `~/.pi/agent/auth.json`.
Live results:

- **Codex** → `7d 1% used, resets 2026-08-31`; **Copilot** → `Premium/month 0%`;
  **OpenRouter** → daily/weekly/monthly windows; **Z.ai** → `5h / 7d / Web-month`.
  All returned real data with only `{ get, getApiKey }`.
- **Anthropic** correctly returned `not_applicable` because this machine's
  `anthropic` slot holds an API key (`sk-ant-…`), not an OAuth token. A genuine
  Claude Max/Pro OAuth session (JWT `eyJ…`) returns real 5h/7d/per-model windows.
  This is the *correct* semantic: API keys have header rate limits, not
  subscription windows.
- The core is **reuse-clean**: `fetchAllProviderQuotas(authStorage)` /
  `fetchProviderQuotas(authStorage, provider)` return a normalized
  `QuotaWindow[]` (`{ provider, label, usedPercent, resetsAt, windowSeconds,
  usedValue, limitValue, … }`) with **built-in per-provider TTL caching**
  (Anthropic 5min, Codex 60s, …) and in-flight dedup — which directly neutralizes
  the self-cost / 429-on-read trap that made a hand-rolled poller risky.
- Coverage: Anthropic, OpenAI Codex, GitHub Copilot, OpenRouter, Synthetic,
  Z.ai, OpenCode Go, Kimi Code.

### Why a dashboard plugin (not just `pi install`)

`pi install @latentminds/pi-quotas` already surfaces quota **inside a single pi
TUI session**. It does not surface it in the dashboard's **cross-session, remote
web UI**, which is the whole point of this repo. The bridge already runs in every
session and knows the active provider + has pi's auth — it's the natural seam to
fetch quota and forward it to the web client, exactly like `flows-anthropic-bridge-plugin`
forwards peer status.

## Terms-of-Service constraints (why this ships OFF by default)

The subscription-quota endpoints are **not documented public APIs** and calling them
programmatically breaches the providers' consumer terms:

- **Anthropic Consumer Terms §3.7** — *"Except when you are accessing our Services
  via an Anthropic API Key... to access the Services through automated or non-human
  means, whether through a bot, script, or otherwise"* is prohibited. A quota poller
  on an OAuth token is exactly this.
- **Claude Code legal docs** — *"OAuth authentication is intended exclusively for...
  Claude Code and other native Anthropic applications"* and developers *"may not
  collect, store, or intermediate Claude.ai credentials or session tokens."*
- **OpenAI Terms of Use** — prohibits *"Automatically or programmatically extract
  data or Output."*

Evidence review (recorded in `design.md`):
- **Confirmed account bans exist** for running *inference* through third-party
  harnesses on a subscription (opencode #6930, OpenClaw). **No** documented ban for
  the quota endpoint itself — Anthropic defends it with persistent **429s**
  (claude-code #30930/#31637), not bans.
- **Anthropic in pi is moot**: since 2026-04-04 Anthropic blocks subscription
  inference through third-party harnesses server-side (pi #3372, #581), so a
  pi+Anthropic session runs on an API key → the quota endpoint returns
  `not_applicable` (confirmed in the spike). **Anthropic is therefore excluded**
  from the subscription tracker.

**Consequences for this change:**
- **Bundled first-party, but DISABLED by default** — opt-in via the existing
  plugin **activation UI** (`isPluginEnabled` / `setEnabledSet`), exactly like the
  **Anthropic Messages Bridge** (`flows-anthropic-bridge-plugin`). A disabled
  plugin contributes zero claims and its bridge does not activate; the user must
  explicitly turn it on.
- **Three gates before any quota call:** (1) plugin **activated**, (2) one-time
  **ToS acknowledgement**, (3) the specific **provider enabled**.
- **Per-provider enablement.** No global switch; each authored provider is off by
  default and enabled individually.
- **Personal, single-user, local** use only — MUST stay off in shared/hosted/docker
  deployments unless the operator owns every account.

The **ToS-safe default deliverable** is the API-key rate-limit **header**
indicator, which needs no forbidden endpoint call.

## What Changes

- **Server-side, no bridge.** Quota is an account-level fact, not per-session, so
  the **server entry** resolves credentials + fetches directly. This deletes the
  bridge, per-session forwarding, and every server↔bridge concern.
- **Credentials via the host auth abstraction — no hardcoded path.** The server
  entry resolves provider tokens through the dashboard's existing
  `InternalAuthStorage` / `provider-auth-storage.ts` (the same resolver the
  model-proxy uses, with OAuth refresh), adapts it to the 2-method `AuthStorage`
  shape `@latentminds/pi-quotas` expects, and calls its fetch core. The plugin
  never opens `~/.pi/agent/auth.json` itself.
- **Disabled by default + per-provider, three-gate — plain plugin config.** Off
  until the plugin is enabled AND the ToS notice is accepted AND a specific
  provider is enabled (`plugins.quota.*`, server-owned config — the existing
  mechanism). No quota fetch before all three; never migrates on.
- **Anthropic excluded** (moot per above); API-key / `not_applicable` omitted.
- **`GET /api/quota`** returns the normalized per-provider `QuotaWindow[]`; the
  client renders it (optionally live via a `quota_update` broadcast). No
  event-store persistence; tokens never leave the server.
- **Client widget** — a per-provider mini-slider (matching the `73% context` bar):
  slim track + short label (`Codex 45%`), fill = **pace severity**, a `now` pace
  tick, and a **minimal** hover tooltip (`over by X%`). Click → the shared
  **`Dialog` primitive** (`useUiPrimitive(UI_PRIMITIVE_KEYS.dialog)`), centered,
  pre-selected to that provider, with a **selector** (`All · <each provider>`).
  Placement is a thin client concern (an existing slot or a small `TokenStatsBar`
  segment) — not a data-path decision. Plus a `settings-section` (enable + ToS
  gate + per-provider toggles + window selection).
- **Burn-rate / pace warning (core, computed client-side).** From each window's
  `usedPercent`, `windowSeconds`, and `resetsAt` the client derives
  `elapsed = (windowSeconds − timeToReset) / windowSeconds`,
  `projected = usedPercent / elapsed`, and warns when `projected ≥ 100` (on track
  to exhaust before reset). The tooltip shows only the overage (`over by
  projected−100 %`); the dialog shows the projection + the `now` tick per window.
  No new data crosses the wire — pace is derived from fields already forwarded.
- **Depend on the best pi quota package, don't vendor.** Of the pi ecosystem's
  quota packages (`@latentminds/pi-quotas`, `@mtrojnar/pi-usage`, `pi-quota-status`,
  `pi-subscription-meter`, `pi-usage-meters`, `@narumitw/pi-usage`, `pi-codex-limit`),
  **`@latentminds/pi-quotas` is the only one structured as a reusable query core**
  — 8 providers, `fetchProviderQuotas`/`fetchAllProviderQuotas` returning a
  normalized `QuotaWindow[]`, built-in per-provider TTL + in-flight dedup,
  spike-verified. The plugin takes it as a **dependency** and reuses its
  `providers/` + `lib/` core; it owns only the bridge-poll cadence, the event
  shape, and the dashboard UI. Endpoint drift + new-provider coverage stay
  upstream's problem. (Import is bridge-only; see the Task-0 entry-resolution.)
- **OAuth-only, honest degradation.** API-key sessions, providers without a quota
  endpoint, and fetch errors render as "no quota" — never a scary error. The
  fetch never blocks the session and never runs more often than the TTL.
- **ToS notice surfaced in-product.** The settings section states, verbatim, that
  the tracker uses undocumented endpoints, may violate provider terms, excludes
  Anthropic, and is personal-use-only — shown at the acknowledgement gate and
  persisted beside the enable toggle.

## Discipline Skills

- **security-hardening** — the plugin reads pi's OAuth store and calls
  undocumented third-party endpoints; token handling must never log/forward the
  token, only the derived utilization numbers.
- **observability-instrumentation** — new external calls (the quota fetch) need
  scoped-logger visibility for the "why is quota blank" support path.
- **review-code** — non-trivial cross-package change (bridge + server + client)
  before commit.
- **doubt-driven-review** — depending on an undocumented-endpoint library is a
  durability bet; stress-test the "upstream breaks / endpoint 429s" fallback
  before it stands.
