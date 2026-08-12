# Raw error rendering and retry authority

## Why

Two defects on the error/retry surface, found while reviewing
`unify-retry-visibility` before merge.

### Defect 1 — dismissing a retry deletes the user's only handle

`CommandInput.tsx:217` already renders Stop during a backoff
(`isWorking = sessionStatus === "streaming" || retrying === true`), and the
bridge already aborts mid-backoff — `abortLatch.request()` fires *before*
`cachedCtx.abort()`, a raw abort re-arms every 200 ms for 2 s, and the latch
re-aborts on sight when the turn wakes. That is specced
(*"Abort during a backoff stops the chain promptly"*) and covered by six tests
in `abort-latch.test.ts`.

But `App.tsx`'s dismiss handler clears `retryState`. So pressing ✕ mid-retry
makes `retrying` false, which **unmounts the existing Stop** while pi keeps
retrying underneath — an invisible, unstoppable loop. Nothing needs to be
added to fix this; something needs to stop being deleted.

The ✕ is also **dishonest**: while retrying it does not close the card in any
useful sense — the next attempt re-opens it. An ✕ that does not close promises
an outcome it does not deliver.

### Defect 2 — `humanizeProviderError` destroys the payload and is mostly inert

`errorMessage` is typed `Type.TOptional<Type.TString>` in pi's protocol — a
string, no structure. Providers set it from `String(error)`, so its content is
unconstrained: `docs/rpc.md` shows `529 {"type":"error",…}` (status, space,
then JSON), `529 overloaded_error: Overloaded`, and the bare word `terminated`.

`humanizeProviderError` parses the JSON envelope and returns
`` `${type}: ${message}` `` — **a string**, discarding status code,
`request_id`, `retry-after` and any nested detail. Worse, it guards with
`startsWith("{")`, so on the documented `529 {…}` payload **it does nothing at
all**. It is simultaneously lossy and inert. And when `error.message` is absent
it falls through and renders the raw JSON *as the headline* — the ugliest
possible outcome.

No provider schema is safe to assume: Google carries no `error.type`, and
`error.code` is a number there and a string at OpenAI.

## What Changes

- **`event-reducer.ts`** — delete `humanizeProviderError`. Its three call sites
  pass the raw `errorMessage` through. Error *printing* is unchanged:
  `SessionBanner` already renders with `whitespace-pre-wrap break-words`,
  truncates past `collapseThreshold` behind Show more / Show less, and offers
  Copy (already icon-only). Only the string it receives changes.
- **`SessionBanner.tsx`** — the trailing control's icon states what it does:
  - retrying → `mdiChevronUp`, `error-banner-collapse`, "Collapse". Collapses
    to a one-line compact row. **Component-local state; `retryState` untouched.**
  - collapsed → `mdiChevronDown`, `error-banner-expand`, "Show error".
  - settled → `mdiClose`, `error-banner-dismiss`, "Dismiss". Really closes.
- **Retry status is shortened and gains a spinner**: `mdiLoading` +
  `animate-spin` in `--severity-warning-fg`, text `Retry 3 · 12s` while waiting
  and `Retry 3` in flight. The spinner carries the in-flight signal that the
  words "retrying now…" carried before.
- **`App.tsx`** — the dismiss handler no longer clears `retryState`.
- **`InlineMessage.tsx`** — two additive optional props (`dismissIcon`,
  `dismissLabel`) so the shared primitive can express collapse vs close without
  a second component.

Explicitly **out of scope**: any new Stop control. Session abort already ends
the retry chain; the fix is to stop unmounting the one that exists.

Mock: `mockups/raw-error-payload/index.html`.

## Impact

- `packages/client/src/lib/chat/event-reducer.ts` (+ tests)
- `packages/client/src/components/session/SessionBanner.tsx` (+ tests)
- `packages/client/src/components/primitives/InlineMessage.tsx`
- `packages/client/src/App.tsx`
- Specs: `error-detection`, `session-status-banner`, `provider-retry-state`
- No protocol, persistence or server change.

## Discipline Skills

- `review-code` — three surfaces plus a shared primitive; run before commit.
- `doubt-driven-review` — deleting an exported helper and changing a
  user-facing affordance are both hard to walk back once shipped.
