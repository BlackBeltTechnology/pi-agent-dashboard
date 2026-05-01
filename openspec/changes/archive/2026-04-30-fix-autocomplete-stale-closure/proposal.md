## Why

The command autocomplete dropdown in `CommandInput` silently fails when the user
presses **Tab** or **Enter** to select a suggestion: the dropdown displays the
filtered options but the textarea is neither updated with the chosen command
nor cleared. The user has to manually type the full command or abandon
autocomplete entirely. The root cause is a stale-closure bug: `selectCommand`
(and `selectFile`) are wrapped in `useCallback(..., [])` / `useCallback(..., [deps without setText])`,
so they permanently capture the first-render `setText` — which in turn captures
a stale `onDraftChange` prop from when `selectedId` was `null`. Once the user
actually selects a session, keystroke edits keep working (the `onChange` handler
is an inline arrow that always sees the current `setText`), but the dropdown's
selection path runs through the frozen closure and calls a no-op
`setDraftForSelected(v1)` which early-returns because its captured `selectedId`
is `null`. The bug is production-specific (controlled mode only) — the existing
Tab-selection unit test passes because it renders in uncontrolled mode.

## What Changes

- Fix the stale-closure bug in `CommandInput.selectCommand` by inlining the
  callback body at each call site (two `onClick` handlers + the Tab/Enter
  branch of `handleKeyDown`), or by adding `setText` to the `useCallback`
  dependency array. Decision deferred to `design.md`.
- Apply the same fix to `CommandInput.selectFile` (its existing `useCallback`
  deps list already depends on several values but is missing `setText`).
- Add regression tests covering controlled-mode Tab/Enter selection across
  `onDraftChange` prop-reference changes (simulating a session switch) — for
  both the `/` command and `@` file variants.

## Capabilities

### New Capabilities
<!-- None — this is a bug fix in an existing capability. -->

### Modified Capabilities
- `command-autocomplete`: add a requirement that Tab/Enter selection MUST
  invoke the current `onDraftChange` prop, even after the prop reference has
  changed since mount (controlled-mode correctness under session switches).

## Impact

- **Affected code**: `packages/client/src/components/CommandInput.tsx`
  (specifically `selectCommand` at ~line 190 and `selectFile` at ~line 197).
- **Affected tests**: `packages/client/src/components/__tests__/CommandInput.test.tsx`
  gains new cases for controlled-mode selection across prop updates.
- **No breaking changes**: external component API (`Props`) stays identical.
- **No server / protocol / persistence changes**: purely a client-side React
  closure bug.
- **User-visible**: restores the expected "type `/`, press Tab/Enter, command
  is filled in" interaction in every session — the primary regression path.
