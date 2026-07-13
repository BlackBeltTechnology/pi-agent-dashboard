## Why

The agent-facing `list_models` tool can return `{ "models": [] }` — an empty
catalogue — in two structurally different situations that are **indistinguishable**
to the caller:

1. **Registry absent** — `getRegistry()` returns `undefined`. The session's
   `cachedModelRegistry` is captured from `ctx.modelRegistry` during bootstrap
   (`packages/extension/src/bridge.ts:2244`); a `list_models` call that lands
   before discovery resolves — the exact window flagged at
   `packages/extension/src/provider-register.ts:589` ("if the flow spawns before
   discovery resolves") — hits the guard `if (!registry) return []`
   (`packages/extension/src/role-model-tools.ts`, `buildModelRows`).
2. **Catalogue genuinely empty** — registry present, but `getAvailable()` returns
   `[]` because no provider has a resolved credential.

Both collapse to the identical `{ "models": [] }`. An agent that receives it
cannot tell "the registry is not ready yet, retry" from "you truly have zero
credentialed models" — so it either gives up wrongly or loops. Verified live: the
main session's `list_models` returns the full ~120-model catalogue and the
dashboard Model Selector renders it, so this is **not** a global/server defect —
it is a per-process readiness ambiguity that bites freshly-spawned / headless
`pi` children whose registry has not hydrated.

This is distinct from `fix-builtin-role-names-relay` (role-NAME relay to the
Settings UI — a different message, handler, and consumer; touches none of the
model-catalogue path) and from the archived `add-agent-role-model-tools` (which
shipped `list_models`) and `surface-model-introspection-to-agents` (server
`/api/models`). No active or archived change addresses the empty-vs-unhydrated
ambiguity in the in-process `list_models` tool.

## What Changes

- **Distinguish "registry not ready" from "catalogue empty" in `list_models`.**
  When `getRegistry()` returns a falsy registry, `list_models` MUST NOT return a
  bare empty catalogue as if it were the true answer. It returns a structured,
  actionable readiness signal (e.g. `{ models: [], registryReady: false,
  reason: "model registry not yet hydrated in this session" }`), so the calling
  agent can retry rather than conclude "no models exist."
- **Keep the genuinely-empty case explicit too.** When the registry IS present
  but `getAvailable()` is empty, return `{ models: [], registryReady: true }`
  (optionally with a hint to try `annotated: true` to see `no-credential`
  exclusions) — a true, actionable "no credentialed models" answer.
- **No change to the model-resolution mechanism, the registry hydration timing,
  or `model:resolve`.** This change makes the tool HONEST about registry state;
  it does not alter when/how `cachedModelRegistry` is populated. Fixing hydration
  timing (if desired) is a separate, larger change and is called out as a
  Non-Goal.
- **Regression guard** asserting: (a) falsy registry → `registryReady: false`
  + non-empty `reason`, never a silent empty; (b) present-but-empty registry →
  `registryReady: true` + `models: []`; (c) populated registry → unchanged
  catalogue shape (backward-compatible additive field).

Additive and backward-compatible: existing callers that read only `models[]` are
unaffected; the new `registryReady` / `reason` fields are optional.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `agent-role-model-tools` — the `list_models` tool gains a readiness discriminator
  so an empty response is never ambiguous between "registry absent" and
  "catalogue empty".

## Impact

- `packages/extension/src/role-model-tools.ts` — `buildModelRows` / the
  `list_models` `execute` handler: branch on registry presence, emit
  `registryReady` + `reason`.
- `packages/extension/src/__tests__/role-model-tools.test.ts` (or sibling) —
  regression cases for the three registry states.
- Docs: the `list_models` tool description updated to document `registryReady`.
- No server, client, protocol, or bridge-wiring change. No behavior change for the
  populated-registry path.

## Discipline Skills

- `systematic-debugging` — the change is rooted in a reproduced ambiguity; tasks
  reproduce each registry state before asserting the fix.
- `observability-instrumentation` — the fix is fundamentally about making an
  opaque runtime state (registry-not-ready) visible and actionable to the caller.
