# Add opencode-go (Go subscription) quota fetcher

## Why

The quota plugin surfaces subscription quota for seven providers but **omits
`opencode-go`**, even though its config default already ticks it on
(`configSchema.json`: `"opencode-go": { "enabled": true }`). The engine silently
drops it because `opencode-go` is absent from `SUPPORTED_PROVIDERS` — a latent
config/engine mismatch: the settings UI offers the toggle, the fetcher does not
exist, so it can never report.

The omission is documented as deliberate in three sites (`providers.ts`,
`server/quotas/fetchers.ts`, `server/AGENTS.md`):

> `opencode-go` — needs a workspace id + session cookie from a separate config
> file… no usage API exists; only a cookie-authenticated SSR scrape…
> **spike-verified**.

**That conclusion conflates two separate opencode products.** opencode.ai runs:

- a **Go subscription** (`opencode-go`) — resetting plan windows, and
- a **Zen pay-as-you-go gateway** (`opencode`) — a wallet balance.

The spike's "cookie + workspace id" blocker is real, but it is the path to the
**Zen wallet** (`server.queryBilling` console RPC). The **Go subscription** has a
clean, key-authenticated, resetting-window usage API — the same shape the
existing anthropic/codex fetchers already consume.

### Verified enabling facts (live, against this repo's credentials)

- `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <opencode-go
  key>` returned **HTTP 200** with:
  `{ usage: { rolling, weekly, monthly } }`, each `{ status:"ok", percent, resetsAt }`.
  Three resetting windows, each with a reset stamp — a strict fit for
  `QuotaWindowDto` (percent + reset stamp per window).
- The credential is **already held**: `~/.pi/agent/auth.json` carries
  `opencode-go` (`type: "api_key"`, `key: "sk-…"`). No cookie, no workspace id.
  It resolves through the existing host auth seam (`getApiKey("opencode-go")` via
  the model registry — pi already registers `opencode-go` models).
- **Cloudflare gotcha (the likely root of the spike's misread):** the default
  Node/undici client (`User-Agent: node`) is rejected by Cloudflare with **error
  1010 "Access denied" as an HTTP 403** — indistinguishable from a rejected key
  or a missing subscription. Setting a client `User-Agent` (`opencode/1.0.0`)
  turns the same request into a `200`. `http.ts::fetchJson` sets no `User-Agent`,
  so a naive fetcher would reproduce the false "unsupported" conclusion.

## What changes

- Add an `opencode-go` fetcher (`GET /zen/go/v1/usage`, bearer + a per-fetcher
  `User-Agent`) and a `parseOpencodeGo` parser mapping `rolling`/`weekly`/
  `monthly` to three `QuotaWindowDto` windows via the existing `win()` helper.
  Windows are emitted whenever they carry a finite `percent` + reset stamp —
  `status` is NOT a drop filter (dropping non-`ok` would hide the exceeded state).
- Add `"opencode-go"` to **both** `SUPPORTED_PROVIDERS` lists: the literal array
  in `providers.ts` AND the `Object.keys(PROVIDER_FETCHERS)` derivation in
  `fetchers.ts` (a parity test asserts they match), resolving the config/engine
  mismatch.
- Correct the **four** stale "opencode-go unsupported" doc/comment sites
  (`providers.ts` comment, `fetchers.ts` comment, `src/AGENTS.md`,
  `server/AGENTS.md`) — the Go rationale is now false; the **Zen-wallet**
  exclusion (cookie + workspace id, `server.queryBilling`, balance not a
  resetting window) stays, retained verbatim for `opencode`.
- Update three test spots: the engine unsupported-loop drops `opencode-go`
  (keeps `deepseek`/`minimax`); the "no-adapter" engine test switches its example
  from `opencode-go` to `deepseek` so it does not fire a real HTTPS call once
  opencode-go is supported; `contract.test.ts`'s per-provider host map gains
  `"opencode-go": "opencode.ai"` (plus one assertion that the credential id
  requested is `opencode-go`, not the Zen `opencode`).

## Cloudflare handling (minimal, best-practice)

Set a single `User-Agent` header **inside the opencode-go fetcher only** — the
surgical mirror of the existing `githubCopilot` fetcher, which already sets its
own `User-Agent`. No change to shared `http.ts` and no change to any other
provider's request. One header, one call site.

## Migration / blast radius

No migration step. `opencode-go` is already default-on in `configSchema.json`, so
once the fetcher ships, an install that holds the key WILL start calling
opencode.ai — **but only after** the plugin is activated AND its ToS acknowledged
(both default-off, per the opt-in requirement). Activation, not upgrade, is the
gate. No user action is required to keep the pre-change behaviour (leave the
plugin, or the opencode-go toggle, off).

## Non-goals

- **Zen wallet balance** (`opencode`) stays unsupported: cookie + workspace-id
  gated, and a wallet balance has no resetting window / reset stamp (same basis
  as `deepseek`/`minimax`).
- No global `http.ts` User-Agent change: the UA is set in the opencode-go
  fetcher only (D2).
- No new config field: `opencode-go` is already present and default-on in
  `configSchema.json`.
- No client UI change: the widget already renders any `ProviderQuota` window.

## Discipline Skills

- **security-hardening** — a new outbound call carrying a live subscription token
  to a third-party endpoint; verify the token stays header-only and every failure
  message is scrubbed (the `http.ts` contract already enforces this — confirm the
  new fetcher routes through it).
- **review-code** — non-trivial change touching the credential seam; inline
  review before commit.

Other `eng-disciplines` skills (performance, observability, systematic-debugging)
do not apply: no latency budget, no new job, no active defect.
