## Why

**Symptom (user-reported, 2026-04-30):** "Néha nem tudok választ adni multiselectnél, mivel automatikusan tovább megy. Néha azt mondja 'válasz nélkül folytatja', anélkül hogy én bejelöltem volna bármit." — i.e. when the agent invokes `ask_user` with `method: "multiselect"`, the dashboard either does not show a usable dialog at all, or the dialog appears and is silently auto-cancelled before the user can interact with it. The agent then receives `cancelled: true` and continues the turn as if the user had declined.

The user attributes the regression to commit `a53933f` ("refactor(schema): restructure ask_user tool schemas for OpenAI compatibility"). After investigation, the schema refactor is **not the root cause** but is a strong **frequency multiplier**: it removed every per-method `required` / `minItems` constraint, which lets Anthropic models generate `multiselect` tool calls far more readily than the previous discriminated-union schema did. The latent multiselect bug below has existed since the PromptBus migration; it just wasn't hit often enough to notice.

**Root cause (three independent breakages stacked together):**

```mermaid
flowchart LR
  A[Anthropic / Claude<br/>method:"multiselect"] --> B[ask-user-tool execute]
  B --> C[polyfillMultiselect]
  C --> D{ctx.ui.custom}
  D -- TUI mode --> E[MultiSelectList renders<br/>in terminal ✓]
  D -- Dashboard / RPC mode --> F[no browser dialog<br/>resolves undefined ✗]
  F --> G[polyfill returns undefined]
  G --> H[execute treats as<br/>cancelled, returns<br/>cancelled batch result]
  H --> I[Agent: 'continuing<br/>without answer']

  subgraph "What SHOULD happen on dashboard"
    direction LR
    X[ctx.ui.multiselect<br/>via PromptBus] --> Y[MultiselectRenderer<br/>in browser ✓]
    Y --> Z[user clicks Submit<br/>→ values: string array]
  end
```

Three concrete breakages, all of which need fixing for the dashboard multiselect to actually work end-to-end:

1. **Bridge does not patch `ctx.ui.multiselect`.** `packages/extension/src/bridge.ts:935-948` patches `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.editor` to route through `bus.request({ type, ... })`, but multiselect is omitted (the underlying pi `ExtensionUIContext` has no `multiselect` method, so there is no method to wrap, and nobody added the explicit assignment).
2. **`polyfillMultiselect` calls `ctx.ui.custom` directly.** `packages/extension/src/multiselect-polyfill.ts` always calls the TUI-only `ctx.ui.custom` primitive, bypassing PromptBus entirely. In dashboard headless / RPC mode there is no terminal renderer, so the call resolves to `undefined` (or hangs until timeout) — the polyfill interprets this as cancellation.
3. **`useSessionActions.handleRespondToUi` does not encode `{ values: [...] }`.** `packages/client/src/hooks/useSessionActions.ts:62` translates renderer `result` payloads to a string `answer` for `prompt_response`, but only handles `result.value` (select/input/editor) and `result.confirmed` (confirm). For multiselect's `{ values: ["a", "b"] }` shape it falls through to `String(undefined ?? "")` and emits `answer: ""` — which downstream is indistinguishable from "user picked nothing". Even if breakages 1 and 2 were fixed, the answer would arrive empty.

The `MultiselectRenderer` component itself is correct (`packages/client/src/components/interactive-renderers/MultiselectRenderer.tsx`) and is correctly registered in `registry.ts`. The wiring around it is what's broken.

**Why commit a53933f surfaced it:** the previous schema declared `multiselect` with `options: minItems: 1` as a required field inside a discriminated union over `method`. Anthropic's tool-call generation respects schema-level constraints aggressively, so Claude models tended to (a) avoid `multiselect` when only a single option made sense and (b) refuse to emit calls without `options`. The flat schema strips both signals; Claude now happily picks `multiselect` for any pick-many situation, which routes every such call into the broken path.

## What Changes

This change has **two layers**: the actual fix (Layer 1: dashboard multiselect wiring) and a defense-in-depth measure (Layer 2: schema strictness restoration that benefits Anthropic without breaking OpenAI).

### Layer 1 — Make multiselect actually work on the dashboard

- **MODIFIED**: `packages/extension/src/bridge.ts` — add `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ type: "multiselect", ... }).then(decode)` next to the existing select/input/confirm/editor wrappers (~line 948). The decoder JSON-parses the `string[]` answer or returns `undefined` on cancellation.
- **MODIFIED**: `packages/extension/src/multiselect-polyfill.ts` — `polyfillMultiselect(ctx, ...)` SHALL first check whether `ctx.ui.multiselect` exists (i.e. the bridge patch is active) and delegate to it. If absent (older pi without the patch, or non-bridge embedding), fall back to the existing `ctx.ui.custom` + `MultiSelectList` path so TUI-only sessions still work.
- **MODIFIED**: `packages/extension/src/bridge.ts` (TUI adapter, ~line 866) — extend the `tui` PromptBus adapter so it also handles `prompt.type === "multiselect"`: when `ctx.hasUI === true`, the adapter SHALL render the `MultiSelectList` component via the captured original `ctx.ui.custom`, encode the confirmed selection as `JSON.stringify(values)` in the bus response's `answer` field, and signal `cancelled: true` on Escape. Without this, TUI sessions would lose multiselect when the patch lands (the dashboard adapter would race-win with a browser dialog the terminal user can't see).
- **MODIFIED**: `packages/client/src/hooks/useSessionActions.ts` — `handleRespondToUi`'s string-answer encoding SHALL handle `(result as any).values` by emitting `JSON.stringify(values)` so multiselect answers survive the round trip. Existing `value` / `confirmed` paths remain untouched.
- **NEW**: `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts` — unit test that asserts (a) `bridge.ts` assigns a function to `ctx.ui.multiselect` after PromptBus patching, (b) calling it issues a `bus.request` with `type: "multiselect"`, (c) a successful response with JSON-stringified `["a","b"]` resolves the call to `["a","b"]`, (d) `cancelled: true` resolves to `undefined`.
- **NEW**: `packages/extension/src/__tests__/multiselect-polyfill.test.ts` — unit test that asserts the polyfill calls `ctx.ui.multiselect` when present and falls back to `ctx.ui.custom` when absent.
- **NEW**: `packages/client/src/__tests__/handle-respond-to-ui-multiselect.test.ts` — unit test that asserts `handleRespondToUi(requestId, { values: ["a", "b"] })` emits a `prompt_response` with `answer: '["a","b"]'`, and that `{ values: [] }` emits `answer: '[]'` (empty selection is still a valid answer, distinct from cancellation).

### Layer 2 — Restore Anthropic schema strictness (defense in depth)

- **MODIFIED**: `packages/extension/src/ask-user-tool.ts` — keep the flat `Type.Object` root (preserving OpenAI compatibility per commit a53933f's rationale) but attach a body-level `oneOf` discriminator over `method` so Anthropic regains per-arm `required` and `minItems` enforcement. The shape is:
  ```
  parameters: Type.Object({...same flat fields...}, {
    oneOf: [
      { properties: { method: { const: "confirm" } },     required: ["method", "title"] },
      { properties: { method: { const: "select" } },      required: ["method", "title", "options"], properties: { options: { minItems: 2 } } },
      { properties: { method: { const: "multiselect" } }, required: ["method", "title", "options"], properties: { options: { minItems: 1 } } },
      { properties: { method: { const: "input" } },       required: ["method", "title"] },
      { properties: { method: { const: "batch" } },       required: ["method", "questions"], properties: { questions: { minItems: 1 } } },
    ],
  })
  ```
  And the analogous body-level `oneOf` over the four sub-question methods on `SubQuestionSchema`.
- **NEW**: `packages/extension/src/__tests__/ask-user-schema-discriminator.test.ts` — unit test that compiles the parameters schema via `Type.Strict` (or equivalent JSON Schema export) and asserts (a) root is `type: "object"` (OpenAI rule preserved), (b) `oneOf` is present at body level with 5 arms, (c) the multiselect arm requires `options` with `minItems: 1`, (d) the select arm requires `options` with `minItems: 2`, (e) the batch arm requires `questions` with `minItems: 1`.

### Capabilities

#### New Capabilities

None.

#### Modified Capabilities

- **`multiselect-dialog`**: replace the obsolete `ui-proxy multiselect forwarding` requirement (legacy, pre-PromptBus) with three new requirements: (1) `ctx.ui.multiselect` SHALL be patched by the bridge to route through PromptBus with `type: "multiselect"`; (2) the TUI adapter SHALL handle `multiselect` via `MultiSelectList` when `ctx.hasUI === true`; (3) the dashboard client's response encoder SHALL JSON-stringify `values` arrays into the `answer` field. The `MultiselectRenderer component` and `ask_user tool supports multiselect method` requirements remain unchanged.
- **`bridge-extension`**: add a Requirement that `ctx.ui.multiselect` MUST be assigned alongside select/input/confirm/editor in the bridge's PromptBus patching block, with a regression test that fails if the assignment is missing.
- **`ask-user-tool`**: modify the existing `Strict parameter schema per method` requirement to specify the *body-level* `oneOf` discriminator pattern (root remains `type: "object"`), and re-state that select/multiselect/batch retain their `minItems` and `required` constraints on the appropriate arms.

## Impact

- `packages/extension/src/bridge.ts` (multiselect patch + TUI adapter extension)
- `packages/extension/src/multiselect-polyfill.ts` (fallback chain)
- `packages/extension/src/ask-user-tool.ts` (body-level `oneOf`)
- `packages/client/src/hooks/useSessionActions.ts` (values encoding)
- `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts` (new)
- `packages/extension/src/__tests__/multiselect-polyfill.test.ts` (new)
- `packages/extension/src/__tests__/ask-user-schema-discriminator.test.ts` (new)
- `packages/client/src/__tests__/handle-respond-to-ui-multiselect.test.ts` (new)
- `openspec/specs/multiselect-dialog/spec.md` (delta)
- `openspec/specs/bridge-extension/spec.md` (delta)
- `openspec/specs/ask-user-tool/spec.md` (delta)
- `AGENTS.md` (one-line note in the `multiselect-polyfill.ts` row mentioning the new bridge-routed primary path)

No data migration. No protocol break — `prompt_response` already carries `answer: string`; we change *what we put in the string* for multiselect, but the field shape is unchanged.

## References

- Commit `a53933f` — "refactor(schema): restructure ask_user tool schemas for OpenAI compatibility" — surfaced the latent dashboard multiselect bug by drastically increasing the rate at which Anthropic models emit `multiselect` calls.
- `packages/extension/src/bridge.ts:850-958` — current PromptBus patching block (lacks multiselect).
- `packages/extension/src/multiselect-polyfill.ts` — current polyfill that hard-codes `ctx.ui.custom`.
- `packages/client/src/hooks/useSessionActions.ts:55-65` — current `handleRespondToUi` answer encoder.
- `packages/client/src/components/interactive-renderers/MultiselectRenderer.tsx` — already-correct renderer; calls `onRespond({ values: [...] })`.
- `packages/client/src/components/interactive-renderers/registry.ts` — already registers `["multiselect", MultiselectRenderer]`; the lookup path is sound, only the upstream wiring is broken.
- AGENTS.md row on `prompt-bus.ts`: "PromptBus — unified prompt routing to registered adapters (TUI, dashboard, custom)".
- AGENTS.md row on `multiselect-polyfill.ts`: documents the current "thin wrapper around `ctx.ui.custom<T>()`" — this row will be updated once Layer 1 lands.
- `openspec/specs/multiselect-dialog/spec.md` — current spec; the "UI proxy multiselect forwarding" requirement is obsolete (PromptBus replaced ui-proxy per `bridge.ts:290` comment).
- `openspec/specs/ui-proxy/spec.md` — also legacy; out of scope for this change but flagged for a future cleanup.
