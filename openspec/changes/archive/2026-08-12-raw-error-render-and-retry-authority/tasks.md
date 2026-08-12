# Tasks — raw error rendering and retry authority

## 1. Drop the humanizer

- [x] 1.1 Red: assert `extractAgentEndError` returns the raw `errorMessage`
      verbatim for a pure-JSON envelope (today it returns `"type: message"`).
- [x] 1.2 Red: assert `auto_retry_waiting` / `auto_retry_start` set
      `retryState.reason` to the raw string.
- [x] 1.3 Green: delete `humanizeProviderError`; pass raw through all 3 call sites.
- [x] 1.4 Delete the `humanizeProviderError` describe block and its import.
- [x] 1.5 Confirm no other package, plugin, barrel or e2e test referenced it.

## 2. Trailing control states its action

- [x] 2.1 Red: while `waiting: true`, `error-banner-collapse` renders and
      `error-banner-dismiss` does NOT.
- [x] 2.2 Red: same while `waiting: false`.
- [x] 2.3 Red: activating collapse does NOT invoke `onDismiss`.
- [x] 2.4 Red: collapsed row shows the attempt status and `error-banner-expand`.
- [x] 2.5 Red: a collapsed surface re-expands when `retry` clears, and then
      offers `error-banner-dismiss`.
- [x] 2.6 Red: settled error renders `error-banner-dismiss` and NOT
      `error-banner-collapse`; activating it invokes `onDismiss`.
- [x] 2.7 Red: no "stop retrying" control in any state (carried over).
- [x] 2.8 Green: add `dismissIcon` / `dismissLabel` optional props to
      `InlineMessage`; add collapse state + the three affordances to
      `SessionBanner`.

## 3. Spinner + short status

- [x] 3.1 Red: waiting renders a spinner and reads `Retry N` + a seconds suffix.
- [x] 3.2 Red: in flight renders a spinner and no countdown suffix.
- [x] 3.3 Green: `mdiLoading` + `animate-spin` in `--severity-warning-fg`;
      shorten the label; drop "attempt" / "next attempt in" / "retrying now".
- [x] 3.4 Update the existing status-line tests to the new phrasing.

## 4. Authority — dismissal never clears retry state

- [x] 4.1 Red: collapsing while retrying leaves `retryState` untouched.
- [x] 4.2 Green: drop `retryState: undefined` from `App.tsx`'s dismiss handler.
- [x] 4.3 Confirm `CommandInput`'s `isWorking` still sees `retrying` after a
      collapse, so the session abort control stays mounted.

## 5. Verify

- [x] 5.1 `npm test` — no NEW failures vs the pre-change baseline.
- [x] 5.2 Biome + `tsc --noEmit` clean on every touched file.
- [x] 5.3 `review-code` pass on the full diff.

## 6. Manual QA (needs a provider that actually fails)

- [x] 6.1 Manual QA: trigger a real retry; confirm the spinner runs and the label
      reads `Retry 2` then `Retry 3`.
- [x] 6.2 Manual QA: collapse mid-retry; confirm the composer Stop stays on
      screen and the card keeps its retry label.
- [x] 6.3 Manual QA: press Stop while collapsed; confirm the chain ends and the
      surface re-expands with a real ✕.
- [x] 6.4 Manual QA: let a retry succeed; confirm the surface disappears with no
      user action.
- [x] 6.5 Manual QA: verify the raw error string prints in full behind Show more
      and that Copy yields it verbatim.
