## Why

Customers of the operator's business should be able to chat with a pi agent from the business's own website — answering from a read-only knowledge base and read-only business data, and handing over to a human when needed — without any customer ever seeing the operator's environment, another customer's conversation, or the dashboard. The `spike/web-chat` spike (`packages/web-chat-plugin/SPIKE-FINDINGS.md` on that branch) proved the in-session containment (deny-first tool guard, prompt-injection attempts did not reach undeclared tools, per-customer registry isolation, egress allowlist) but stopped at three core gaps; `add-plugin-isolation-and-public-routes` closes them (`scope.agentDir` isolated spawns with attested `isolated: true`, `ctx.identity.hasHostPolicy()`, and an operator-enabled, origin-pinned plugin public namespace). This change builds the product on top, plugin-only.

## What Changes

- **NEW plugin `web-chat`** (`packages/web-chat-plugin`):
  - **Customer authentication, two modes** (operator picks one or both): identity-plane OIDC bearer resolved by the dashboard's principal resolver (customer iff the principal's issuer is in `customerIssuers`), or a short-lived token minted by the business's backend with a shared secret held in the dashboard credential store (`X-Web-Chat-Token`). Both normalize to a customer id `(issuer, subject)`.
  - **Conversations**: public REST + `fetch`-consumable event stream on `/api/plugins/web-chat/public/*`; each conversation is one hidden, ownerless, **isolated** pi session (per-customer agent dir under the plugin's data dir, dedicated model credential, persona prompt, tool allowlist); the plugin kills any spawn that is not `isolated: true`; customer↔customer isolation by an owner-exact registry; caps, rate limits, idle end.
  - **Customer tools** (in-session extension with a deny-first guard): `kb_search` over an operator-configured read-only docs directory; read-only business API tools declared in config (allowlisted `GET` URL templates, secrets from the vault, response caps); `escalate_to_human`.
  - **Egress filter**: only assistant text and conversation status reach the customer — never tool calls/results, thinking, paths or prompts.
  - **Embeddable widget**: one script tag on the business's site (shadow-DOM chat UI, accessible, no third-party dependencies), served from the public namespace; the site supplies the customer credential through a callback.
  - **Operator side**: settings section (modes, issuers, origins hint, model, tools, persona, caps) and an escalations inbox; conversations run as ownerless sessions, invisible to human principals; the operator inspects them through the escalation excerpts and the local/break-glass operator path.
  - **Fail-closed serving gate**: the public API answers `503` unless its configured mode's prerequisites hold (identity mode: identity enforced AND `hasHostPolicy()`; token mode: secret configured) the host provides the required seams, and — whenever identity is enforced — a probe proves the registered host policy confines customer issuers to the public API.
- **NEW plugin `web-chat-policy`** (`packages/web-chat-policy-plugin`): the host access policy for customer issuers — deny every non-session road and plugin action except `plugin:web-chat:*`; non-customer principals are allowed. Separate so an operator can swap or compose it.
- Architecture: the design compares a standalone plugin with a `web` adapter inside `chat-gateway` (decision recorded in `design.md` after doubt review).

## Capabilities

### New Capabilities
- `web-chat-customer-auth`: customer credential modes, normalization to a customer id, serving gate.
- `web-chat-conversations`: conversation lifecycle on isolated sessions, owner-exact registry, public API + stream, caps, rate limits, idle end.
- `web-chat-customer-tools`: in-session guard + `kb_search`, declared read-only API tools, `escalate_to_human`.
- `web-chat-egress`: customer frame allowlist.
- `web-chat-widget`: embeddable script widget and its contract with the host site.
- `web-chat-escalation`: escalation records and the operator inbox.
- `web-chat-policy`: customer host access policy plugin.

### Modified Capabilities
<!-- none — the core seams come from add-plugin-isolation-and-public-routes -->

## Discipline Skills

- `security-hardening` — untrusted external users, prompt injection, credentials (shared secret, model key, API secrets), cross-origin widget.
- `doubt-driven-review` — architecture choice (standalone vs chat-gateway adapter) and the customer trust boundary.
- `observability-instrumentation` — new public endpoints, external API calls and escalations need audit/metrics.
- `performance-optimization` — live conversation caps and stream fan-out have explicit budgets.
- `review-code` — before commit.

## Impact

- New packages `packages/web-chat-plugin` (server entry, extension, client panel, widget bundle) and `packages/web-chat-policy-plugin`; registrations per the add-new-plugin checklist (workspace, vitest projects, tsconfig refs, plugin registry, release).
- **Depends on** `add-plugin-isolation-and-public-routes` (must ship first); no core code changes here.
- Ops: the operator must configure a principal resolver (identity mode) or a token secret, enable the public namespace with exact `allowedOrigins`, name `web-chat-policy` in `identity.trustedPolicyPlugin` (identity mode), and provide a model credential for customer traffic.
- Rollback: disable the plugin (namespace answers `404`, live conversations are ended); no core state.
