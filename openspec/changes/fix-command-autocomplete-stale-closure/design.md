## Context

`packages/client/src/components/CommandInput.tsx` exposes a controlled-or-uncontrolled textarea with `/`-command and `@`-file autocomplete dropdowns. Selection from those dropdowns flows through two `useCallback` handlers:

```tsx
const setText = useCallback((v: string) => {
  if (!isControlled) setLocalText(v);
  onDraftChange?.(v);
}, [isControlled, onDraftChange]);

const selectCommand = useCallback((cmd) => {
  const newText = `/${cmd.name} `;
  setText(newText);
  setDismissed(newText);
  inputRef.current?.focus();
}, []);                          // ← empty deps

const selectFile = useCallback((file) => {
  // …
  setText(newText);
  setDismissed(newText);
  // …
}, [atQuery, textBeforeCursor, text, cursorPos]);   // ← omits setText
```

Both handlers close over `setText`. `setText`'s identity changes whenever `onDraftChange` (passed by `App.tsx`) gets a new identity — which happens any time `App` rebuilds the `setDraftForSelected` callback, most notably on `selectedId` change (session switch).

`selectCommand`'s deps array is `[]`, so it is built **once at mount** and keeps calling the v1 `setText` whose closed-over `onDraftChange` writes to the *previous* session's draft slot. The current session's draft never updates, so the textarea silently stays as `/dep` instead of becoming `/deploy `.

`selectFile`'s deps include `text`, which changes on every keystroke. As a result the `useCallback` is **rebuilt every render**, accidentally re-capturing a fresh `setText` each time. The `@`-file path therefore works for users today — but only by luck, not by design. If those deps are ever tightened (e.g. by an exhaustive-deps lint pass that decides `text` is unnecessary), `selectFile` will fall into the same trap as `selectCommand`. This is documented in the design but not actively fixed in this change.

A `vitest`+`jsdom` probe (`packages/client/src/components/__tests__/CommandInput.dropdown-select.probe.test.tsx`) reproduces both Tab and click failures for the `/` path deterministically using a parent that mirrors `App.tsx`'s `useCallback(..., [selectedId])` shape. 8 baseline scenarios pass; 2 "after session switch" scenarios fail with `Expected "/deploy " / Received "/dep"`. The matching `@`-path scenario is not in the probe because the bug doesn't reproduce there — the accidental rebuild masks it.

## Goals / Non-Goals

**Goals:**
- Selecting a dropdown entry (Tab or click) MUST insert the value into the textarea / parent draft regardless of how often the parent has rerendered or whether the active session changed since mount.
- Same fix covers `selectCommand` and `selectFile`.
- The probe tests become permanent regression coverage.

**Non-Goals:**
- No protocol, server, or API changes.
- No change to how drafts are persisted or keyed in `App.tsx`.
- No fix for the *focus race* on `mousedown` (Smell 2 from exploration). That hypothesis was not reproducible in jsdom and may be a separate, browser-only bug; if it surfaces post-fix it gets its own change.
- No conversion of the textarea between controlled / uncontrolled — the controlled-when-`draft`-is-defined behaviour stays as-is.

## Decisions

### Decision 1 — Fix `selectCommand`'s deps; leave `selectFile` alone with a comment (chosen)

Add `setText` to the deps of `selectCommand`. Do **not** modify `selectFile`'s deps in this change — the `@`-file path works today (because `text` is in the deps and rebuilds the callback constantly) and modifying it adds risk without addressing user-visible breakage. Instead, leave a code comment on `selectFile` documenting *why* it's safe today and what would re-introduce the bug.

```tsx
const selectCommand = useCallback((cmd) => {
  const newText = `/${cmd.name} `;
  setText(newText);
  setDismissed(newText);
  inputRef.current?.focus();
}, [setText]);

// NOTE: `text` in the deps array re-creates this callback every keystroke,
// which incidentally re-captures the latest `setText`. If those deps are
// ever tightened, `setText` MUST be added explicitly, mirroring selectCommand.
const selectFile = useCallback((file) => { ... },
  [atQuery, textBeforeCursor, text, cursorPos]);
```

Rationale:
- Minimal user-visible-bug-fix diff (one deps array).
- The user reported the `/` path is broken and the `@` path works — the fix should match that observation, not silently change the working path.
- The comment is the contract for the next reviewer / lint pass; it makes the latent bug detectable on inspection.

### Decision 2 — Why not switch to a ref for `setText` (covering both selectors at once)?

A `useRef`-backed `setText` would also fix the bug, but it sacrifices the type-clean controlled flow (the parent's `onDraftChange` should be the source of truth for state) and introduces a new pattern this codebase doesn't otherwise use. We avoid the broader refactor unless a similar bug recurs in another handler.

### Decision 3 — Why not inline the handler at the call site?

`onClick={() => { setText(`/${cmd.name} `); setDismissed(...); ... }}` would also dodge the trap because the arrow is rebuilt every render and closes over the latest `setText`. But it duplicates logic between the click and Tab paths and makes the keyboard handler harder to read. Decision 1 keeps the single helper and is just as correct.

### Decision 4 — Promote the probe file to a regular test, not a one-shot

The probe was written to differentiate Smell 1 from Smell 2. The session-switch scenarios are exactly the scenarios that broke on real desktop sessions; they're cheap and deterministic. Keep them. Rename to drop the `.probe` infix and group with the other `CommandInput` tests, or leave the file in place — the test runner picks them up either way.

## Risks / Trade-offs

- **[Risk]** Adding `setText` to deps causes more `selectCommand` rebuilds → child reference changes more often. **Mitigation**: `selectCommand` is only consumed by the dropdown buttons rendered inside the same component; there is no downstream memo to bust. No measurable cost.
- **[Risk]** `selectFile` is left with the same shape it has today. A future tighten-deps refactor (manual or by a lint rule) could break it the same way. **Mitigation**: the in-source comment + the design.md decision serve as the trip wire; an `@`-path scenario can be added to the regression suite if/when it actually breaks.
- **[Risk]** Smell 2 (focus race on `mousedown`) is unverified. If post-fix users still report click-only failures on certain browsers, they're a separate bug that this change does not pretend to address. **Mitigation**: Document in the proposal that this fix is scoped to the stale-closure path; open a follow-up if needed.
- **[Trade-off]** The fix does not assert the deeper invariant ("any handler that writes through `onDraftChange` must include it in its deps"). A future reviewer may need to apply the same pattern to a new handler. We accept this; the probe tests guard the user-visible behaviour.

## Migration Plan

- Single client-side change. No data migration, no protocol bump.
- Roll forward by deploying a new client bundle. Service worker (`public/sw.js`) will revalidate on next page reload.
- Roll back by reverting the commit. No state shape changed.

## Open Questions

- Should `eslint-plugin-react-hooks/exhaustive-deps` be enabled repo-wide as a follow-up to prevent this category of bug? Out of scope for this change; tracking as a tangent.
