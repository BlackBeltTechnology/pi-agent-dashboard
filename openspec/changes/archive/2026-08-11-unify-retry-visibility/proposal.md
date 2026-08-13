# Unify retry visibility across tracker, reducer, banner and card

## Why

Four defects on one user-visible thread: **"pi is retrying, but the dashboard
doesn't say so."** Three were already root-caused and fixed in the working tree
of session `019fd19c` (2026-08-05 → 08-06) but were **never committed and never
specced** — each shipped only as a code comment pointing at a `See change:` slug
that does not exist:

| `See change:` slug in the working tree | Exists? |
|---|---|
| `fix-retry-tracker-last-assistant` | ❌ never created |
| `fix-agent-end-last-assistant` | ❌ never created |
| `restore-error-banner-dismiss` | ❌ never created |

The fourth is still live and unfixed: the session card shows no retry state at
all. This change consolidates all four under one spec, because they are one
bug class on one lifecycle.

### The shared root cause (defects 1 and 2)

Both the bridge tracker and the client reducer decided "did this turn fail?" by
reading **`messages[messages.length - 1]`**. A turn can legitimately end with a
`toolResult` *after* the failed assistant message, so the final array element is
frequently not the assistant message at all.

```ts
// packages/extension/src/retry-tracker.ts — before
const lastMsg = messages[messages.length - 1];   // may be a toolResult
const isError = lastMsg?.stopReason === "error"; // → false → chain never arms
```

Consequences, exactly as reported:

- **Defect 1** — the retry chain never armed, so **no attempt was ever counted**
  even though pi was visibly retrying. (*"IT DOES NOT SHOW THE RETRY COUNTING
  and retries does not trigger"*)
- **Defect 2** — the mirror bug in `isCleanAgentEnd` / `extractAgentEndError`
  meant a successful turn was never recognised as clean, `lastError` never
  cleared, and **the error card stayed up forever**. (*"also did not disappear
  on success!"*)

pi's own `_willRetryAfterAgentEnd` scans backward for `role === "assistant"`.
Both call sites must mirror that. This is a **structural** read of `role` and
`stopReason` — no text matching, per the standing constraint *"never grep and
detect change text use json"*.

### Defect 3 — the dismiss control disappeared

When the collapse pill was removed from `SessionBanner`, the stale gate
`retrying ? undefined : onDismiss` was left behind, so during a retry there was
**neither** collapse **nor** ✕. (*"Where is the x? when did i say to remove the
x?"*) The agreed model: the ✕ is **always present** and **clear-only** — it
never aborts; pi keeps retrying and the next attempt re-opens the surface with
the fresh attempt number.

### Defect 4 — the session card cannot express a retry

```ts
// packages/client/src/App.tsx:1361
if (state.retryState && !state.lastError) ids.add(id);   // ← drops the common case
```

A provider retry normally carries **both** `retryState` and `lastError` — the
error card is up *while* pi retries. The `!state.lastError` clause therefore
excludes precisely the situation the user is looking at. And even when the flag
does arrive, `SessionCard` receives only `isRetrying?: boolean`; the attempt
count has no channel to travel on, so it is **unrepresentable by construction**.

Meanwhile `SessionBanner` shows `attempt 3 · next attempt in 12s`. Hence the
report: *"the session card does not show the retries! but it should and other
uis show it!"*

## What Changes

- **`retry-tracker.ts`** — scan backward for the last message with
  `role === "assistant"` instead of taking the final array element.
- **`event-reducer.ts`** — one shared `lastAssistantMessage()` helper applied to
  both `isCleanAgentEnd` and `extractAgentEndError`, so a successful turn clears
  `lastError` and the card disappears.
- **`SessionBanner.tsx`** — the ✕ renders in every state (waiting and in
  flight). Clear-only; never aborts.
- **`App.tsx`** — drop the `!state.lastError` clause, and publish the attempt
  number (not just a boolean) alongside the retry set.
- **`SessionCard.tsx`** — add a retry branch to the existing `ActivityIndicator`
  precedence chain, rendering `↻ Retry N` in the slot that already prints
  “Thinking…”, “Needs you”, a tool name or “Idle”. Same icon+label shape as the
  existing `currentTool` branch. **No new component and no new layout**: dot
  colour, shape marker and rail keep their existing precedence, so no state that
  ships today changes appearance.

Explicitly **out of scope**: any "Stop retrying" control. pi owns retry;
the scope was locked to the observe-only variant (*"only the retrying stub we
need"*).

Mock: `mockups/retry-visibility/index.html`. It loads the **running dashboard's
own compiled stylesheet** and reuses class strings copied verbatim from the live
DOM and from `InlineMessage.tsx`, so it cannot drift from shipped appearance.
Requires the dashboard up on `:8000`.

## Impact

- `packages/extension/src/retry-tracker.ts` (+ tests)
- `packages/client/src/lib/chat/event-reducer.ts` (+ tests)
- `packages/client/src/components/session/SessionBanner.tsx` (+ tests)
- `packages/client/src/components/session/SessionCard.tsx` (+ tests)
- `packages/client/src/App.tsx` — retry set + attempt map
- Specs: `bridge-retry-observability`, `provider-retry-state`,
  `session-status-banner`, `session-card-status`
- No protocol, persistence or server change. `auto_retry_*` event payloads are
  unchanged — this change only fixes *when* they fire and *how* they render.

### Adopts, does not extend, the severity token system

The retry label reuses the existing `--severity-warning-fg` token rather than
raw `--status-working`. `--accent-yellow` (`#eab308`) measures **1.68:1** on the
light-mode card surface — the identical dark-only-palette defect as the
untokenised ctx error card. The derived token measures **6.13:1 light /
7.75:1 dark** and is already gated across 9 themes × 2 modes by
`tests/e2e/severity-contrast.spec.ts`. No new token is introduced.

The sibling activity branches still use raw status tokens as card text; those
predate the severity system and are `U2`'s scope, not this change's. This change
simply does not add another instance.

## Discipline Skills

- `review-code` — four surfaces across extension + client; run before commit.
- `systematic-debugging` — defects 1 and 2 are a shared root cause reached by
  evidence, and the fix must be verified against a real retry chain, not a
  synthetic one.
- `scenario-design` — the `retryState × lastError` matrix needs explicit
  per-cell coverage; the `!lastError` gate is exactly the cell that was missed.
