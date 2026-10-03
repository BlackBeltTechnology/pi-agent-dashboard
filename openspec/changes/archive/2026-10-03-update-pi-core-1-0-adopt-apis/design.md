## Context

- Pinned runtime `0.86.1`, lockstep floor `0.86.1` (`packages/server/package.json#piCompatibility`). `docs/architecture.md` still says `0.85.1` (drift).
- Broad pi ranges today:
  - publishable `@earendil-works` peers `>=0.80.10`; pi-ai `>=0.75.5 <0.87.0` (`@mariozechner/*` ranges are handled by `drop-mariozechner-pi-fork`);
  - the root `package.json` is a published pi package with the same peers;
  - `packages/extension` devDependency `pi-tui >=0.80.10`;
  - `pnpm-workspace.yaml` overrides only `pi-coding-agent`.

  Policy origin: `openspec/changes/archive/2026-09-11-update-pi-core-0-85-adopt-apis/`.
- The floor is **advisory at runtime** (`/api/health` + `PiVersionAdvisory`, no 503). The bridge runs inside whatever pi the user launched.
- Per-session `piVersion` today comes from `sendPiVersionIfChanged(bc, defaultReadPiVersion)`, a by-name resolution. `model-tracker.ts:171-182` documents that it reads a hoisted newer copy instead of the running pi. The argv-anchored `readRunningPiVersion()` exists for exactly that case, but only the slash gate uses it.
- `provider-auth-registry.ts:117-119` derives OAuth providers from pi's provider definitions (excluding `radius`). On 1.0.0 that set gains `openai` (ChatGPT). `FLOW_TYPE_HINT` (`:40-44`) has no `openai` key. 1.0.0 `anthropicOAuth.login()` first calls `interaction.prompt({ type: "select" })` with options `browser` / `copy_code`; `provider-auth-adapter.ts` already maps `select` prompts to a pending `select` step.
- pi 1.0.0 facts: `engines.node >=22.19.0` (unchanged); TypeBox `1.3.27`; dependencies added since 0.86.1: `@earendil-works/pi-codemode`, `@earendil-works/pi-mcp`, `quickjs-wasi` (none removed); the session file is created on the first user message; pi-ai `getSupportedThinkingLevels` offers `max` whenever `thinkingLevelMap.max !== undefined` (no runtime gate) and returns `["off"]` when `!model.reasoning`.

## Goals / Non-Goals

**Goals:** one supported pi (1.0.0) on every `@earendil-works` pin surface; delete gates and the legacy pi-ai branch; one correct below-floor signal; the OpenAI OAuth registry change; tolerate 0.87–1.0 shapes and settings.

**Non-Goals:** fork removal (→ `drop-mariozechner-pi-fork`); nested tool calls (→ `render-nested-tool-calls`); usage accounting (→ `count-non-message-usage`); the `piai-compat` factory seam and the two server runtimes (→ `collapse-model-proxy-onto-modelruntime`); MCP (→ `migrate-mcp-to-pi-builtin`); replacing `filterByEnabledModels` or the thinking-level derivation (D3); roles as virtual models.

## Decisions

### D1 — Every pi range joins the lockstep
- Root and `packages/*` manifests: `@earendil-works` pi peers `>=1.0.0`, `optional: true` kept, no upper bound. `@earendil-works` pi `devDependencies`: `^1.0.0`. `@mariozechner/*` ranges are untouched.
- `pnpm-workspace.yaml` `overrides` pin all three pi packages. The comment's rationale changes from "broad peers" to "deterministic single copy". `minimumReleaseAge` is not configured today (only `minimumReleaseAgeExclude` exists); confirm, and add the 1.0.0 set to the exclude list if it is.
- `scripts/verify-release-deps.mjs` and `dependency-declarations.test.mjs` enforce all of it (modified "release-deps checker" requirement).
- *Alternative:* keep broad peers and remove the gates anyway. Rejected: a standalone consumer on older pi would hit an unguarded API with no install-time warning.

### D2 — Dead gates out; one correct below-floor signal in
- Remove the `0.84.2` gate from `slash-dispatch.ts` (the `supportsExpandPromptTemplates`-style check and its "requires pi 0.84.2+" error), from reload self-dispatch in `bridge.ts:1801`, and from `terminal-reload.ts`. Remove the legacy `piai-compat` generation.
- **Keep `readRunningPiVersion()` (`model-tracker.ts`) and repurpose it:** `sendPiVersionIfChanged` switches to it, so `piVersion` is the running pi, not a hoisted copy. Its name list is unchanged here (fork handling is a sibling change). The `protocol.ts` comment ("ground truth for the session") becomes true.
- The server compares the reported `piVersion` with `piCompatibility.minimum` and sets a below-floor flag on the session record; the session card and chat view render it. Unknown or unparseable versions raise no flag: bun-compiled or manifest-less runs lose the signal, accepted and documented.

### D3 — Audited non-adoptions
- `filterByEnabledModels` stays. `ctx.scopedModels` is a read-only startup snapshot (`dist/core/extensions/types.d.ts:232`). `resolveModelScopeFromModels` exists (`dist/core/model-resolver.d.ts:63`) but is not reachable through pi's `exports` map, and the exported `resolveModelScopeWithDiagnostics` needs a `ModelRuntime`. The dashboard's matcher re-applies patterns after async discovery (`bridge.ts:1319` `onProviderChanged`, `:3960` credentials-reload push).
- `deriveSupportedThinkingLevels` stays. pi-ai's `max` handling is fail-open and it collapses metadata-less models to `["off"]`; `model-selector` mandates the opposite.

### D4 — OpenAI OAuth registry
Add `openai: "auth_code"` to `FLOW_TYPE_HINT`. Update the exact-set spec and `provider-auth-registry.test.ts` to the 1.0.0 set (`anthropic`, `openai`, `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai`). A real-browser sign-in check with ChatGPT is a manual task.

Anthropic (1.0.0): the first step is now a method `select`, not the auth URL. No code change: the pane follows the emitted step and the `anthropic: "auth_code"` hint stays. A test drives the select → browser path with a fake interaction; a manual check covers copy-code.

### D5 — Version-level tolerance
- `agent_before_settle` goes on the bridge pass-through list with no status effect. `context_edit` is ignored by replay (UI history is unchanged by definition).
- Settings writers treat `extensions` / `defaultTools` as opaque arrays and preserve `-builtin:`, `+name`, `-name`.
- Session file: `session-sync.ts:119,242` and `bridge.ts:3060` must tolerate a path whose file does not exist yet, and pick it up later.

### D6 — Bump obligations (standing `pi-api-feature-detection` requirements)
- Re-verify the in-memory session path (`commit-draft-agent.ts`, `SessionManager.inMemory`) against 1.0.0 at runtime, and record the evidence and the restore-API decision. 0.87 made `SessionManager` canonical for provider context.
- Record a repo-wide search showing that the added sub-dependencies (`@earendil-works/pi-codemode`, `@earendil-works/pi-mcp`, `quickjs-wasi`; none removed since 0.86.1) are unreferenced, and that import specifiers are unchanged.

### D7 — Auth label for environment auth without a key variable
- `provider-register.ts` already reads `modelRegistry.getProviderAuthStatus(id)` for `configured`/`source`; it also copies `label` → `authLabel`. pi 1.0.0 `ModelRuntime.getProviderAuthStatus` returns `{ configured: true, source: "environment", label: "workload identity federation" }` for Anthropic federation.
- `provider-auth-storage.ts` `_buildAuthStatus`: `authenticated` also true for an environment row with `authLabel`, no stored key, no `envVar` and not `ambient`; `row.authLabel` copied. pi 1.0.0 labels EVERY environment credential (env-var rows get the variable name), so the gate keeps env-var rows unchanged (user decision during implementation). Client Environment mechanism text = `envVar ? from <envVar> : authLabel ?? ambient text`.
- Generic: any future pi env auth with a label is named, not just Anthropic.

### D7a — Sign in with ChatGPT needs a device id (found during implementation)
- pi 1.0.0 `openai` OAuth `login(interaction, options)` throws "Sign in with ChatGPT requires a device ID (UUID) for this installation" without `options.getDeviceId`. pi's TUI passes `SettingsManager.getOrCreateDeviceId()`.
- The adapter passes `{ getDeviceId }` to every `login()`; `beginFlow` pre-loads pi's public `SettingsManager.create(cwd).getOrCreateDeviceId` (same id as the pi TUI; pi writes `deviceId` to `~/.pi/agent/settings.json` only when absent). Failure to load leaves it unset; only flows needing it fail, with pi's message.

### D7b — Built-in MCP vs the dashboard's adapter entry (found in the harness)
- pi 1.0.0 built-in MCP reads `<agentDir>/mcp.json` + `.pi/mcp.json`. The dashboard provisioned `mcpServers["pi-dashboard"]` there using the adapter-only `requestHeadersCommand`; built-in connected without the token and posted "MCP servers need attention: pi-dashboard: needs sign-in" in every session (broke e2e `extension-slash-inprocess` #F1).
- `pi-mcp-adapter` >= 3 owns `<agentDir>/mcp-adapter.json` (2.x reads `mcp.json` only; 5.x also imports Pi's `mcp.json`).
- Provisioning target follows the adapter pi loads: user-installed (`<agentDir>/{npm/,}node_modules`) else dashboard-bundled. Major >= 3 → `mcp-adapter.json`, and the dashboard's own stale adapter-shaped key (`url` + `requestHeadersCommand`) is removed from `mcp.json` via `removeServer`; a user's entry under the key stays. <= 2.x / none → `mcp.json` (unchanged).
- Bundled `pi-mcp-adapter` `^2.20.0` → `^5.0.0` (config API names/signatures unchanged; schema gains 4 `ServerEntry` + 9 `McpSettings` keys). 5.0.0 declares peer pi-ai `^0.99.0` (lags 1.0.0 by hours); verified at runtime in the harness.
- Full MCP migration stays in `migrate-mcp-to-pi-builtin`.

### D8 — Subscription flag
- Registry build reads the pi OAuth provider's `isSubscription` (absent → `false`) into the registry entry and OAuth status rows (`subscription`). Client badge: `subscription === false` → "Account", otherwise "Subscription" (older server keeps today's text).

### D9 — Codemode image attachments
- No code expected: `image-block.ts` + `extractToolImages` already handle flat pi image blocks on `tool_execution_end` and replay. Add regression tests only; a failure becomes a fix task.

## Risks / Trade-offs

- [Standalone npm consumers on pi < 1.0.0] → **BREAKING** CHANGELOG entry; install-time peer warning.
- [User-launched session on old pi misbehaves] → the D2 flag, read from the running pi; unknown version → no flag (accepted).
- [Runtime-only breakage from unexported internals (resource-activation, trust symbols, in-memory sessions)] → D6 evidence; `resource-activation-toggle.test.ts` against the installed pi; real headless and tmux spawns.
- [Hard-coded `0.86.1` in tests, helpers, docs and specs] → a sweep across `packages scripts docker docs pnpm-workspace.yaml package.json openspec/specs`; each hit is updated or justified as historical ("as of pi 0.86.1").

## Migration Plan

1. Pins, peers, devDeps and overrides; `pnpm install`; red-first coherence tests.
2. D2 removals and the flag; D4; D5; D6 evidence.
3. Full rebuild + real-session smoke.

Rollback: revert pins and code together; no persisted data changes.
