## Why

When two `ask_user` prompts are live at the same time in one session, only one
ever surfaces on the dashboard. The second is silently dropped and its tool
call hangs until the 5-minute PromptBus timeout, with the session stuck showing
"Needs you" and no answerable card.

Reproduce it with `update_roles`: the model repoints two roles in one turn, pi
runs the two tool calls **in parallel**, each calls
`ctx.ui.confirm("Update global roles?", <per-action message>)`
(`role-model-tools.ts:243`). Both reach the client as distinct
`prompt_request`s with distinct `requestId`s — but the client discards the
second at `event-reducer.ts:1028` (`addInteractiveRequest`):

```js
if (state.interactiveRequests.some((r) =>
    r.requestId === requestId ||
    (r.status === "pending" && r.method === method && r.params.title === params.title),
)) {
  return state;   // second prompt silently dropped
}
```

The content-dedup fallback keys on `method` + `params.title` and **ignores the
message body**. `update_roles` uses a constant title (`"Update global
roles?"`) with a varying message, so two genuinely-different writes collapse to
one and the second is lost.

Every other layer already supports concurrency: the PromptBus holds pending
prompts in a `Map` keyed by id and fires `onDashboardRequest` per prompt
(`prompt-bus.ts`); the server tracks each `prompt_request` per `promptId`
(`event-wiring.ts:1783`); the client stores `interactiveRequests[]` as a list
and resolves each independently by `requestId`. The drop is a client-render
false-positive, and the dedup comment even records that its reason
("recursive proxy generates multiple requestIds for the same dialog") predates
the PromptBus "each prompt sent exactly once" invariant.

Beyond correctness, concurrent asks that *do* render today appear as scattered
inline cards. This change also groups the concurrently-pending set into one
cohesive multi-ask panel — the same visual affordance as the atomic
`ask_user{method:"batch"}` wizard — **without** routing through the atomic
batch request type, so each ask keeps its own independent per-id resolution.

## What Changes

- **Fix the drop (correctness).** `addInteractiveRequest` SHALL NOT discard a
  prompt whose `requestId` is new. The content-based fallback is narrowed so it
  can only collapse a genuine re-send of the *same* dialog (same `requestId`),
  not two distinct prompts that merely share a title.
- **Group concurrent asks (UX).** The client SHALL render the set of
  concurrently-pending free-floating asks in one grouped multi-ask panel where
  each entry is answered independently and resolves its own `requestId`. A
  tool-paired ask (carrying `toolCallId`) keeps its existing inline placement.
  A real `type:"batch"` prompt stays a single atomic entry.
- **No new coalescing/windowing/fan-out.** We do NOT buffer requests into one
  synthetic `type:"batch"` bus request. N independent bus requests stay N
  independent requests; only their rendering is unified.

## Impact

- `packages/client/src/lib/chat/event-reducer.ts` — `addInteractiveRequest`
  dedup key.
- `packages/client/src/components/chat/ChatView.tsx` +
  `packages/client/src/components/interactive-renderers/` — grouped panel
  rendering of the pending set.
- No server, bridge, shared-protocol, or PromptBus changes. Resolution
  semantics unchanged.

## Rejected Alternative — Route A (coalesce into `type:"batch"`)

Buffer concurrent `bus.request` calls in a time window, emit ONE synthetic
batch prompt, then fan the answers back out to each caller by id. Rejected: it
forces a windowing latency onto every ask, a fan-out map from one `{answers}`
payload to N `resolve`s, and — worst — a partial-lifecycle problem when one
caller aborts/times out while the atomic batch wizard is mid-submit. Route B is
a strict superset of the fix with none of these hazards.

## Discipline Skills

- `systematic-debugging` — root cause already isolated to the dedup false
  positive (done during exploration); referenced for the verification loop.
- `doubt-driven-review` — before landing, confirm the recursive-proxy path that
  motivated the content fallback is truly gone under the PromptBus, so the
  narrowed key cannot resurrect duplicate cards.
- `review-code` — inline review of the reducer + render change before commit.

No auth/secrets/PII/untrusted-input/webhook or latency-budget surface is
touched, so `security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply.
