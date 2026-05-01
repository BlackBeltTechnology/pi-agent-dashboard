## Context

`CommandInput` is a controlled React component when used from `App.tsx`:
`App.tsx` passes a `draft` string prop (current text) and an `onDraftChange`
callback that routes keystrokes into a per-session `Map<string, string>` keyed
by `selectedId`. The callback is wrapped in `useCallback(..., [selectedId])`,
so its reference changes every time the user switches sessions.

Inside `CommandInput`, the local `setText` helper is wrapped in
`useCallback(..., [isControlled, onDraftChange])` — correct: its identity
updates whenever the parent gives a new `onDraftChange`.

The bug: the two selection callbacks that handle Tab/Enter and mouse click in
the dropdown — `selectCommand` and `selectFile` — are wrapped in `useCallback`
with dependency arrays that do **not** include `setText`:

```ts
const selectCommand = useCallback((cmd) => {
  setText(`/${cmd.name} `);   // captures FIRST-render setText
  setDismissed(...);
  inputRef.current?.focus();
}, []);                         // ← frozen forever

const selectFile = useCallback((file) => {
  ...
  setText(newText);            // captures FIRST-render setText
  ...
}, [atQuery, textBeforeCursor, text, cursorPos]);  // ← setText missing
```

Because React preserves the first-render `setText` reference forever, these
callbacks permanently invoke the first-render `onDraftChange` — which, on
initial mount, was `setDraftForSelected(v1)` where `selectedId` was `null`,
causing an early return. From the user's perspective, Tab/Enter visually
dismisses the dropdown (via `preventDefault` + the implicit `dropdownMode`
recomputation) but the textarea is neither filled nor cleared.

The `onChange` inline handler on the `<textarea>` is unaffected because inline
arrow functions always close over the latest render scope — which is why the
user can still type, open the dropdown, navigate with arrow keys, and fail only
at the selection step.

### Existing Tab-selection test passes because

```ts
// CommandInput.test.tsx:87
renderInput();  // passes no `draft` / `onDraftChange`
→ isControlled = false
→ setText just calls setLocalText (a stable React-provided setter)
→ stale closure never matters
```

So the bug only manifests when the component is actually controlled AND the
`onDraftChange` reference has changed since the first render — exactly what
production does on every session switch.

## Goals / Non-Goals

**Goals:**
- Tab and Enter (and mouse-click) in the dropdown MUST always invoke the
  current `onDraftChange` prop, regardless of how many prop updates have
  happened since mount.
- Fix applies symmetrically to `/` command dropdown AND `@` file dropdown.
- Add regression tests in controlled mode that specifically simulate an
  `onDraftChange` prop-reference change between mount and selection — this
  is the scenario the existing test suite misses.
- Minimal change surface: no API changes, no state-shape changes, no
  re-architecture of the controlled/uncontrolled duality.

**Non-Goals:**
- Rewriting `CommandInput` to use a reducer or external state management.
- Redesigning how `App.tsx` persists drafts (the per-session Map is fine).
- Fixing the unrelated (but adjacent) file-mode out-of-bounds `selectedIndex`
  discussed in the explore session — that is a separate proposal if pursued.
- Adding `@` file-mode selection tests beyond what is strictly needed to
  verify the stale-closure fix (the broader file-autocomplete gap is out of
  scope here).

## Decisions

### Decision 1: Inline the callbacks (remove `useCallback`) rather than patch deps

**Chosen:** remove the `useCallback` wrappers around `selectCommand` and
`selectFile`; they become plain inner functions reconstructed each render.

**Why:**
- Eliminates the entire class of "forgot a dep" bugs at this call site. The
  bug was introduced precisely because `setText` was not listed; fixing only
  the deps list leaves the same foot-gun for the next editor.
- These callbacks are used exclusively in local `onClick` handlers and one
  `onKeyDown` branch — they are never passed as props to a memoized child,
  so `useCallback` provides zero render-reduction value.
- Each callback's body is 3–6 lines; inlining costs no readability.

**Alternative: fix the dependency arrays** (`[setText]` for `selectCommand`;
`[setText, atQuery, textBeforeCursor, text, cursorPos]` for `selectFile`).
Rejected because it is strictly more fragile than inlining for no performance
win, and the ESLint `react-hooks/exhaustive-deps` rule is not enforced in
this repo's config (the bug survived review precisely because of that).

**Alternative: ref-based indirection** (`setTextRef.current`). Rejected as
over-engineering for a single call site with no performance pressure.

### Decision 2: Two regression tests (command + file), controlled-mode only

**Chosen:** add exactly two tests that each:
1. Render `<CommandInput draft=... onDraftChange={v1} />`.
2. `rerender` with a **different** `onDraftChange` reference (`v2`) — this is
   what React does on every session switch in production.
3. Open the dropdown (type `/dep` or `@`).
4. Press Tab (and Enter in a second assertion).
5. Assert that `v2` (the current prop) was called with the expected text.

**Why this specific shape:**
- Previous test only renders uncontrolled → misses the bug entirely.
- Simply rendering controlled once is not enough — the bug only surfaces when
  the prop reference has changed since mount.
- Testing both Tab and Enter in one scenario confirms both entry points
  share the fix (they both route through `selectCommand` / `selectFile`).

**Alternative: snapshot-test the closure deps.** Rejected; brittle and not
what users care about.

### Decision 3: Leave `selectFile`'s existing dep array otherwise untouched

After inlining, the `atQuery / textBeforeCursor / text / cursorPos` values
are read directly from the enclosing render scope — no `useCallback`, no
deps array, no staleness possible. This is strictly better than the current
state (where those deps exist but `setText` is missing).

## Risks / Trade-offs

- **Risk:** Inlining creates a new function reference per render on every
  `CommandInput` render. → **Mitigation:** The dropdown buttons' `onClick`
  props receive a new reference each render, but the buttons are not
  memoized children, so there is zero measurable impact. Verified by code
  reading: no `React.memo` wrapping the dropdown items.

- **Risk:** Removing `useCallback` could hide a future case where a memoized
  child depends on stable selector references. → **Mitigation:** Not a
  current concern; any future memoization would need to re-introduce
  stability explicitly at that point, not rely on today's incidental
  `useCallback`.

- **Risk:** Tests may be order-sensitive if `rerender` does not correctly
  update the `onDraftChange` prop in React Testing Library. → **Mitigation:**
  Standard RTL pattern; the existing test file already uses `rerender`
  (see session-switch history test at line 507). Low risk.

- **Trade-off:** The fix is surgical rather than structural. A larger
  refactor (e.g., moving draft-persistence into a custom hook) would prevent
  whole categories of similar bugs, but is out of scope here and would
  expand blast radius unnecessarily for a targeted regression fix.
