## Context

The agent-facing `list_models` tool (`packages/extension/src/role-model-tools.ts`,
capability `agent-role-model-tools`) reads the in-process session registry via a
`getRegistry: () => cachedModelRegistry` dependency wired at bridge activation
(`packages/extension/src/bridge.ts:1807`). Its row builder is:

```ts
export function buildModelRows(registry: any, annotated: boolean): ModelRow[] {
  if (!registry) return [];                         // state A — registry ABSENT
  const custom = getCustomProviderNames();
  if (!annotated) {
    const avail = registry.getAvailable?.() ?? [];  // state B — present, 0 creds → []
    return avail.map(...);
  }
  ...
}
```

`cachedModelRegistry` is captured from `ctx.modelRegistry` during session
bootstrap (`bridge.ts:2244`). `provider-register.ts:589` documents the race
explicitly: *"If the flow spawns before discovery resolves"* the captured
registry is missing. So `list_models` has **three** distinct runtime states that
today produce only **two** observable outputs:

| # | Registry state | `getAvailable()` | Today's output | Meaning |
|---|---|---|---|---|
| A | absent (`!registry`) | n/a | `{ models: [] }` | not ready — retry |
| B | present, no creds | `[]` | `{ models: [] }` | truly empty — actionable |
| C | present, populated | `[...]` | `{ models: [...] }` | normal |

States **A** and **B** are indistinguishable. An agent (especially in a
freshly-spawned / headless `pi` child, where hydration lags) receives `{ models: [] }`
and cannot tell "wait and retry" from "you have zero credentialed models." Live
verification confirms the main session and dashboard Model Selector both render
the full ~120-model catalogue, so this is a per-process readiness ambiguity, not
a global defect.

## Goals / Non-Goals

**Goals:**

- Make an empty `list_models` response **self-describing**: the caller can always
  tell state A (registry absent → retry) from state B (registry present, empty →
  real answer).
- Keep the change **additive and backward-compatible** — existing callers reading
  only `models[]` are unaffected.
- Cover the three registry states with regression tests.

**Non-Goals:**

- Changing **when/how** `cachedModelRegistry` hydrates (bootstrap timing,
  `ctx.modelRegistry` capture, `model:resolve`). The tool becomes honest about
  state; it does not re-plumb hydration.
- Blocking/awaiting registry readiness inside the tool (see Decision 2 — rejected).
- Any server (`/api/models`), client, protocol, or bridge-wiring change.
- Touching the `roles_list` / `builtinRoleNames` path (that is
  `fix-builtin-role-names-relay`, an unrelated subsystem).

## Decisions

### D1. Add a `registryReady` discriminator (+ optional `reason`) to the tool result

`list_models` returns, in addition to `models`:

- `registryReady: boolean` — `false` iff `getRegistry()` is falsy (state A),
  `true` otherwise (states B and C).
- `reason?: string` — present only when `registryReady === false`, a short
  human/agent-readable explanation, e.g. `"model registry not yet hydrated in
  this session; retry shortly"`.

Shape:

```jsonc
// state A
{ "models": [], "registryReady": false,
  "reason": "model registry not yet hydrated in this session; retry shortly" }
// state B
{ "models": [], "registryReady": true }
// state C
{ "models": [ ... ], "registryReady": true }
```

`buildModelRows` stays pure and unchanged in its mapping logic; the branch that
today does `if (!registry) return []` is lifted into the tool's `execute` (or a
thin wrapper) so the tool can emit the discriminator. `buildModelRows(null, …)`
continuing to return `[]` is fine — the tool decides the envelope.

**Why a boolean discriminator, not an error/throw:** returning an error tool
result would break callers that today tolerate an empty list, and it conflates
"transient not-ready" with "failure." A boolean keeps the response a normal,
parseable catalogue envelope while adding the one bit the caller was missing.

**Why additive fields, not a breaking reshape:** the archived
`add-agent-role-model-tools` shipped the `{ models }` shape and
`surface-model-introspection-to-agents` shipped `/api/models` with `{ object,
data }`; both have consumers. Adding optional sibling fields to the in-process
tool touches neither and cannot break a reader that ignores them.

### D2. Signal-and-let-agent-retry — NOT block-and-await (rejected)

Considered: when the registry is absent, have `list_models` await hydration (poll
`getRegistry()` with a short timeout) and return the real catalogue once ready.

Rejected for this change:

- It re-enters the hydration-timing problem the proposal declares a **Non-Goal** —
  the tool would need a readiness signal / event to await, which is exactly the
  larger plumbing we are deferring.
- It adds a blocking code path (timeout, partial-hydration, cancellation) to a
  read tool that is supposed to be cheap and synchronous.
- The signal approach already unblocks the caller: an agent that sees
  `registryReady: false` can retry on its next turn, which is when hydration has
  almost always completed. The bit of information is the fix; the await is
  gold-plating.

Await-with-timeout remains a clean **follow-up** if telemetry later shows agents
retry-looping; it is not needed to remove the ambiguity.

### D3. `annotated: true` obeys the same discriminator

The `annotated` path (`getAll()` + `no-credential` derivation) also short-circuits
on `!registry`. It returns the same `registryReady: false` envelope in state A.
In states B/C it returns `registryReady: true` with the annotated rows. This keeps
the two tool modes consistent — an agent that falls back from default to
`annotated: true` to "see everything" is not misled by a silent empty.

## Risks / Trade-offs

- **Callers that pattern-match the exact old JSON.** Mitigated: fields are purely
  additive; `models` keeps its position and shape. A strict-schema consumer that
  *rejects unknown keys* would break, but no in-repo consumer does that (the tool
  result is free-form `content`/`details`).
- **`registryReady: true` + empty is still "empty."** That is correct and
  intended — state B is a true answer. The accompanying tool description will hint
  that an unexpected empty-with-`registryReady:true` should try `annotated: true`
  to reveal `no-credential` exclusions, distinguishing "no providers configured"
  from "providers present but unauthenticated."
- **Does not fix the underlying race.** By design (Non-Goal). If a caller never
  retries, it still sees an empty `models[]` — but now with `registryReady: false`
  telling it exactly why. Removing the race itself is deferred and can build on
  this discriminator.
