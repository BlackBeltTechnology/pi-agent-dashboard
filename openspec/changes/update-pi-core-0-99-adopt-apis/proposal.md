## Why

The repo pins `@earendil-works/pi-coding-agent@0.86.1`; upstream is at **0.99.1**. Publishable packages still declare `@earendil-works/pi-coding-agent >=0.80.10` and `@earendil-works/pi-ai >=0.75.5 <0.87.0`. Those ranges are the only reason the dashboard carries:
- a pi-version gate on slash and reload dispatch;
- a legacy pi-ai generation branch in `piai-compat`.

The owner accepted a **0.99.1 floor for every `@earendil-works` range, publishable ones included**, which makes that code dead. 0.99.1 also changes one dashboard-visible surface: the `openai` provider gains an OAuth login (Sign in with ChatGPT), so the derived OAuth registry changes.

First of four 0.99 adoption changes. Siblings that depend on this one:
- `render-nested-tool-calls`;
- `count-non-message-usage`;
- `drop-mariozechner-pi-fork` (removes fork recognition across ~17 capabilities).

## What Changes

### Pin bump + floor (atomic)
- Pin `@earendil-works/pi-coding-agent` to `0.99.1` on every governed surface: `packages/server/package.json` (dependency + `piCompatibility.minimum`/`recommended`), `docker/Dockerfile`, `scripts/verify-release-deps.mjs` `minVersion`. `pnpm-workspace.yaml` `overrides` pin `pi-coding-agent`, `pi-ai` and `pi-tui`. Root devDependency pi-ai `^0.99.1`. Re-resolve with `pnpm install`.
- **BREAKING (publishable peers):** every `@earendil-works` pi peer in the root `package.json` and every `packages/*/package.json` becomes `>=0.99.1`, stays optional and has no upper bound (the pi-ai `<0.87.0` cap goes). `@earendil-works` pi `devDependencies` move to `^0.99.1`. The release-deps checker enforces all of it. `@mariozechner/*` ranges are untouched here.

### Dead code removed
- The pi `0.84.2` gate in `slash-dispatch.ts`, `bridge.ts` reload self-dispatch and `terminal-reload.ts`, with its error paths.
- The legacy (global-registry) generation of `packages/shared/src/piai-compat/`. The factory adapter stays; the whole seam goes in `collapse-model-proxy-onto-modelruntime`.

### One generic below-floor signal
- `readRunningPiVersion()` (argv-anchored, in `model-tracker.ts`) stays and now also feeds `pi_version_update`, replacing the by-name resolver. `model-tracker.ts:171-182` documents that the by-name resolver reads a hoisted copy instead of the running pi.
- The server flags a session whose reported version is below the floor, and the session card and chat show it. This replaces the per-feature gates for user-launched sessions on an old global pi, where the floor is advisory only. Unknown versions raise no flag (accepted trade-off).

### 0.99 surface change
- OAuth registry gains `openai` (ChatGPT). `FLOW_TYPE_HINT` gets `openai: "auth_code"`; the exact-set spec and tests move to the 0.99.1 set.

### Audited, deliberately NOT replaced
- `session-sync.filterByEnabledModels()`: `ctx.scopedModels` is a startup snapshot. `resolveModelScopeFromModels` is not reachable through pi's package exports map, and the exported `resolveModelScopeWithDiagnostics` needs a `ModelRuntime`. The dashboard matcher re-applies patterns after async provider discovery.
- `provider-register.deriveSupportedThinkingLevels()`: pi-ai's `getSupportedThinkingLevels` offers `max` without a runtime gate and returns `["off"]` for metadata-less models, contrary to `model-selector`.

### Version-level tolerance
- 0.87 `agent_before_settle` and `context_edit` tolerated.
- `-builtin:<name>` / `defaultTools` `+name`/`-name` preserved on settings writes.
- Registration works before the session file exists (0.99 creates it on the first user message).
- Bump evidence (standing `pi-api-feature-detection` requirements): in-memory session path re-verified; added sub-dependencies `@earendil-works/pi-codemode`, `@earendil-works/pi-mcp`, `quickjs-wasi` (none removed) verified unreferenced.

### Documented no-ops
System theme / OKHSL colors, fullscreen wheel scrolling, the GPT-6.1 Sol default, HTML-export toggles, pi's TypeScript 7 build, `provider_stream_event`, llama.cpp/Jev classifiers, per-model image limits, `builtin:<name>` naming in RPC source info.

### Out of scope
Nested tool calls, usage accounting, fork removal (sibling changes); model-proxy collapse; MCP; nano-banana (pi-ai 0.99.1's only image API is `openrouter-images`); roles as virtual models.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `pi-core-version-check`: floor 0.99.1; `@earendil-works` ranges (peers, devDeps, three overrides) join the lockstep and the release-deps check; a below-floor session is flagged.
- `command-routing`: slash dispatch and routing order lose the pi version gate.
- `bridge-extension`: the slash dispatch helper loses the gate; the reported pi version is the running pi.
- `headless-reload`: reload dispatch and feedback lose the gate.
- `piai-module-compat`: factory generation only.
- `provider-auth-server`: the OAuth registry and handler ids on 0.99.1 include `openai`.
- `pi-api-feature-detection`: audited non-adoptions (`ctx.scopedModels`, pi-ai thinking levels); 0.87 shapes; built-in settings; session-file timing; no-ops.

## Impact

- **Pins:** root and `packages/*` manifests, `packages/server/package.json`, `pnpm-workspace.yaml`, `docker/Dockerfile`, `scripts/verify-release-deps.mjs`, `pnpm-lock.yaml`.
- **Code:**
  - extension: `slash-dispatch.ts`, `bridge.ts`, `terminal-reload.ts`, `model-tracker.ts`, `session-sync.ts`;
  - shared: `piai-compat/*`, `protocol.ts` (`piVersion` comment);
  - server: `auth/provider-auth-registry.ts` (`FLOW_TYPE_HINT`), session record below-floor flag;
  - client: session card + chat warning;
  - settings writers (resource toggle, project-init).
- **Tests:** pin-coherence and dependency-declaration tests, `bundled-node-meets-pi-floor`, slash / reload / `pi-version-tracker` tests, `provider-auth-registry.test.ts`, piai-compat fakes, and every test hard-coding `0.86.1` (sweep).
- **Docs:** `docs/architecture.md` (floor text still says 0.85.1; pi-ai window), other `docs/*.md` with `0.86.1`, `CHANGELOG.md` **BREAKING** entry, `See change:` rows.
- **Risk:** standalone npm consumers on pi < 0.99.1 (peer break); runtime-only breakage from unexported pi internals. Rollback = revert; no data migration.

## Discipline Skills

`doubt-driven-review` (publishable peer raise is irreversible once published) · `code-simplification` (dead-gate removal) · `systematic-debugging` (runtime-only breakage from unexported pi internals) · `review-code` (cross-package diff).

Subagent checkpoints (not skills): `react-expert` (below-floor warning on session card and chat).
