## Why

pi 1.1.0 is the latest release (2026-10-07). Dashboard-spawned sessions already run it: `PI_KEEPER_PI_CMD` resolves to the nvm-global 1.1.0 `dist/cli.js`. The repo, though, pins, type-checks and tests against `1.0.0` (`pnpm-workspace.yaml:55-57`, `packages/server/package.json:19-20,74`, `docker/Dockerfile:116`). Under the lockstep policy (`pi-core-version-check`) the floor follows the pin, and the sibling change `spawn-scope-no-mcp` needs pi ≥ 1.0.4 for `--no-mcp`. Between 1.0.1 and 1.1.0 there are also two dashboard-visible changes: a breaking provider rename (`azure-openai-responses` → `azure`, 1.0.3), and recorded tool execution times (`durationMs`, 1.1.0).

## What Changes

### Pin bump + floor (atomic)
- Pin `@earendil-works/pi-coding-agent`, `pi-ai` and `pi-tui` to `1.1.0` on every governed surface:
  - the server dependency (`^1.1.0`) and `piCompatibility.minimum`/`recommended` (`1.1.0`);
  - the root `package.json` peers and devDependencies;
  - `docker/Dockerfile`;
  - `scripts/verify-release-deps.mjs` `minVersion` (plus an evidence note);
  - the `pnpm-workspace.yaml` `overrides`;
  - `minimumReleaseAgeExclude`: `1.1.0` for every `@earendil-works` package resolved at 1.1.0. The set is derived from the lockfile after `pnpm install`, not hand-listed: pi-coding-agent's direct deps include pi-agent-core, pi-ai, pi-tui, pi-codemode, pi-mcp, pi-client, pi-protocol, pi-server and chord, and pi-ai adds pi-telemetry. Entries that no longer resolve are dropped. First confirm whether the age gate is active (the 1.0 bump's check).
- The pin-encoding fixtures move first (TDD, as in the 1.0 bump): `pi-version-skew.test.ts` (`PINNED_PI`), `bundled-node-meets-pi-floor.test.ts` (new `1.1.0` row, Node 22.19), and `verify-release-deps-pi-coherence.test.mjs`.
- **BREAKING (publishable peers):** every `@earendil-works` pi peer becomes `>=1.1.0` (optional, no upper bound). pi devDependencies become `^1.1.0`. Below-floor users see the existing red advisory.
- Dependency delta, verified from manifests: the `@earendil-works/*` siblings move to `^1.1.0`, and `brace-expansion@5.0.12` becomes a direct dependency of pi. No new transitive package (`brace-expansion` moves from transitive to direct, a GHSA pin). Node engines (`>=22.19.0`) and TypeBox (`1.3.27`) are unchanged.

### Adopted
- **Recorded tool durations.** The chat reducer prefers pi's `tool_execution_end.durationMs` (monotonic, measured around `execute()`) over the bridge timestamp difference for a tool row's `duration`, and falls back to timestamps when it's absent (older pi, or a tool that didn't run). Transcript replay copies the tool-result message's `durationMs` onto the synthesized `tool_execution_end`, as it already does for `nestedCalls`. Burst totals (`ToolBurstGroup`) pick it up unchanged. This applies to top-level rows only (`!isNestedToolEvent`). Live nested calls keep their own timing rule.
- **Per-thinking-level sampling.** The bridge already passes `samplingParams` through when it re-registers `models.json` models (`packages/extension/src/provider-register.ts:264`, 0.84 precedent). It would silently drop pi 1.0.2's `samplingParamsByThinkingLevel`. Pass it through the same way at the three `samplingParams` sites (`packages/shared/src/models-json-reader.ts:43`, `provider-register.ts:80,264`, `packages/server/src/model-proxy/internal-registry.ts:46,108,321`).
- **Azure provider rename notice.** The server reports any remaining `azure-openai-responses` provider id. It reads, side-effect-free, with `tryReadJson`, never the quarantining `readAuthJson`:
  - `auth.json` keys;
  - `settings.json`: `defaultProvider`, both bare and in `<provider>/<model>` form; `enabledModels` entries equal to the id or starting with `id/`; `modelThinkingLevels` keys;
  - `models.json` `providers` keys, matched exactly (pi 1.0.3 `CHANGELOG.md:87` says to rename the key there too).

  The providers page then shows a notice naming each location and pi's fix (rename to `azure`, or `/login` again). The notice also says such sessions fall back to another model and lose their prompt cache (pi 1.0.3 `CHANGELOG.md:87`), because nothing else signals this. Files are read from pi's agent dir (`getAgentDir`, which honours `PI_CODING_AGENT_DIR`). The custom-endpoint **API type** `azure-openai-responses` (`ProviderAddDialog.tsx:39`) is unchanged: it is still a `KnownApi` in pi-ai 1.1.0.

### Audited, deliberately NOT consumed
- **`agent_settled.aborted`.** The bridge forwards it (`extractSerializable` keeps booleans, `packages/extension/src/event-forwarder.ts`), and nothing consumes it. Server unread and push trigger on the `agent_end` status edge (`packages/server/src/session/event-status-extraction.ts:94`, `:282-286`; stamped by `stampUnreadIfTriggered`, `packages/server/src/event-wiring.ts:780-788`), which comes *before* `agent_settled`. A user abort is already visible through `stopReason: "aborted"` (`event-reducer.ts:2197`) and `retryCancelled`. Moving unread/push to the settle edge is a separate behaviour change, recorded as a follow-up.
- **`registerToolRenderer`, `outputPad`, tool render-context `durationMs`.** TUI-only.
- **OSC 7501 program status.** Dashboard sessions run headless (RPC) or under tmux, which doesn't forward OSC 7501. The bridge already reports richer state (`ui_prompt_start` covers "blocked"). Noted for `add-native-pi-tui-view` tier C.
- **`--tools` `+name`/`-name` and `*` patterns.** No dashboard writer emits them, and explicit allowlists stay. The 1.0.4 *behaviour change* (an allowlist keeps MCP tools) does affect the team-plugin spawn (`conversations.ts:553`), and is handled by the dependency `spawn-scope-no-mcp`.

### Documented no-ops
Claude Haiku 5.5, GPT-6 Luna and llama.cpp/Cloudflare classifiers (registry-derived; `oauth-compat.ts` denies only pre-4.x ids). The Radius org-disabled model listing fix (pi-side filtering). Also:
- Nix flake.
- MCP OAuth hardening, CIMD and `/mcp` live updates.
- The retry additions (`server_busy`, Mistral `finish_reason: "error"`, Bedrock stalls): pi-ai classifies them (`pi-ai/dist/utils/retry.js:26-27`), and the dashboard deliberately reads pi's retry events rather than replicating the classifier (`packages/extension/src/retry-tracker.ts:255-256`).
- Codemode output separators and image persistence.
- The context-limit estimate (3.5 chars/token).
- Pricing-tier fixes.
- Managed installer and `pi update` retention, and the npm shrinkwrap removal (1.0.1): the dashboard pins resolution with `pnpm-workspace.yaml` overrides and `scripts/generate-runtime-lock.mjs`. Discovering the managed install location is a separate spike.

The OAuth provider set is identical in 1.0.0 and 1.1.0, verified by `ModelRuntime.create().getProviders()` on both: `anthropic, github-copilot, kimi-coding, meta, openai, openai-codex, openrouter, radius, xai`.

### Out of scope
`--no-mcp` (in `spawn-scope-no-mcp`). MCP project overrides (in `mcp-client-project-overrides`). Unread/push on the settle edge (follow-up).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-core-version-check`: pins, floor, peers and examples move to `1.1.0`.
- `event-reducer`: a tool row's duration prefers pi's recorded `durationMs`, live and on transcript replay.
- `provider-auth-server`: reports legacy `azure-openai-responses` provider keys.
- `provider-auth-ui`: the providers page shows the Azure rename notice.
- `pi-api-feature-detection`: records the 1.0.1–1.1.0 audit (adopted, not consumed, no-ops), and adds the `samplingParamsByThinkingLevel` passthrough.

## Impact

- Pins: `packages/server/package.json`, root and `packages/*/package.json` peers and devDependencies, `pnpm-workspace.yaml`, `docker/Dockerfile` (and its stale `Dockerfile.AGENTS.md` row), `scripts/verify-release-deps.mjs`, plus `pnpm install` (lockfile).
- Docs (DocScribe): `docs/architecture.md`, `docs/faq.md` and `README.md` floor mentions.
- Order: `spawn-scope-no-mcp` lands together with, or after, this change.
- Code: `packages/client/src/lib/chat/event-reducer.ts` (tool-end duration), `packages/server/src/auth/` (legacy-id scan + response field), the providers page (`packages/client/src/components/settings/`).
- Tests: `pi-version-skew.test.ts`, `bundled-node-meets-pi-floor.test.ts`, `verify-release-deps-pi-coherence.test.mjs`, reducer and provider-auth tests.
- `CHANGELOG.md` `[Unreleased]`: the floor raise (breaking for below-floor pi).
- Rollback: revert the commit and run `pnpm install`. No persisted state changes, and the Azure scan is read-only.

## Discipline Skills

- `doubt-driven-review`: the floor raise is a public, irreversible-for-users step (a publishable peer range).
- `security-hardening`: the Azure scan reads `auth.json` (credential file). Only key names may leave the server, never values.
