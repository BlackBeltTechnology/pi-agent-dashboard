# Surface model introspection to in-session agents

## Why

Agents inside a pi session repeatedly need to answer "which models can I actually reach, and with what capabilities?" — for cross-model review (pick a non-Anthropic reviewer), vision routing (needs `input: [image]`), cost-aware model choice, and reachability checks before a call 401s. Today they cannot get this answer cleanly:

- **They guess the wrong file.** Observed failure: an agent shell-parsed `~/.pi/agent/providers.json` with a fragile python one-liner looking for a `providers` map. That file holds only `roles`/`rolePresets`/`activePreset` — **no model inventory**. The parse returns empty and the agent trusts the empty result (silent failure).
- **The right data exists but behind the wrong door.** `InternalRegistry.getAvailable()` already returns the reachability-filtered catalogue; `getAllAnnotated()` additionally returns every model + an `excludedReason` (`no-credential` | `oauth-incompatible`). This is exactly the "is it reachable, and why not" answer agents need.
- **The only endpoint that exposes it is auth-gated.** Verified live: `GET /v1/models` returns `401 AUTH_REQUIRED` without a `pi-proxy-...` Bearer key (built for external OpenAI clients). With a minted key it returns 38 reachability-filtered models across 4 authed providers (`anthropic` 15, `opencode-go` 12, `openai-codex` 6, `zai` 5) with `x-pi` metadata (`contextWindow`, `maxTokens`, `reasoning`, `cost`, `input`).
- **The only open endpoint is providers-only.** Verified live: `GET /api/provider-auth/status` returns `200` with per-provider `authenticated`/`expires` — but **no model catalogue**.

Net: there is no open, in-session-agent-reachable endpoint that returns the model catalogue. Agents therefore reinvent it badly. This is a discoverability + surface gap, not a capability gap — the registry logic is already built and mature.

## What Changes

- **Add an ungated read-only `GET /api/models`** on the dashboard server, backed by the existing `InternalRegistry`. No proxy Bearer key required (subject to the dashboard's normal auth gate when enabled — same posture as `GET /api/provider-auth/status`).
  - Default: reachability-filtered catalogue (mirrors `getAvailable()`), each row `{ id: "provider/modelId", provider, reasoning, input, contextWindow, maxTokens, cost }`.
  - `?annotated=1`: returns `getAllAnnotated()` — every model plus `excludedReason` (`no-credential` | `oauth-incompatible`), so agents can answer "why can't I reach model X".
  - Reuses the same registry instance/refresh path as `/v1/models`; no new catalogue composition logic.
- **Add a `dashboard-list-models` command** to the shipped `pi-dashboard` skill (`packages/extension/.pi/skills/pi-dashboard/commands/`), the LIST counterpart to the existing SET-only `dashboard-session-model`. It calls `GET /api/models[?annotated=1]` and instructs agents to **never parse `providers.json`/`models.json`**.
- **Document the endpoint** in the skill's `references/api-reference.md` with the one-line rule: to inspect available/reachable models, call `GET /api/models`; the file-parse path is wrong and fails silently.

Non-goals (kept out to stay minimal):
- No `resolve_reviewer` policy skill (cross-model review picking + probe) — separate follow-up if wanted.
- No change to the gated `/v1/models` proxy route; it stays as-is for external clients.
- No new bridge tool / RPC surface; a REST endpoint + skill pointer is sufficient and the bridge already runs in every session.

## Capabilities

### Added Capabilities

- `agent-model-introspection`: an ungated `GET /api/models` returning the dashboard's reachability-filtered model catalogue, with an `annotated` mode exposing per-model `excludedReason`, plus a shipped skill command that points agents at it instead of file-parsing.

## Impact

- **Scope**: one small Fastify route (~30 LOC, reuses `getRegistry()` + `getAvailable()`/`getAllAnnotated()`), one skill command markdown, one api-reference note. No registry logic changes.
- **Security**: endpoint exposes model IDs + provider names + capability/cost metadata only — never API keys or credential material. Inherits the dashboard's existing auth gate. Reviewed under `security-hardening`.
- **User-visible**: in-session agents get a reliable, typed introspection surface; the silent file-parse failure class disappears.
- **Backward compat**: purely additive. `/v1/models` and `/api/provider-auth/status` unchanged.

## Discipline Skills

- `security-hardening` — new endpoint surfaces provider/model metadata; confirm no credential leakage and correct auth-gate posture.
- `doubt-driven-review` — adds a public-ish REST surface (agent contract); stress-test the open-vs-gated decision and response shape before it stands.
