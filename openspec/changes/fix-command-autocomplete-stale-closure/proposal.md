## Why

The slash-command (`/`) autocomplete dropdown in `CommandInput` silently fails to insert the chosen value (Tab or click) **after the user switches sessions**. The dropdown still renders, the entry highlights, the click registers, but the textarea does not update. Users on desktop hit this any time they navigate between sessions — type-and-Enter still works, so the bug stays just-subtle-enough to ship and just-painful-enough to make the autocomplete UX feel broken. A jsdom probe (`CommandInput.dropdown-select.probe.test.tsx`) reproduces both Tab and click failures for the `/` path deterministically after a session switch.

The `@`-file dropdown shares the same code shape (a `useCallback` selector that closes over `setText`), but its deps array already includes `text` — which changes on every keystroke — so the selector is rebuilt constantly and the stale-closure window never opens in practice. `@` works for users today through that accidental rebuild, not by design. This change scopes to the `/` path that actually breaks; `@` is noted as a latent dependency-correctness gap, not a fix target.

## What Changes

- Fix the stale-closure trap in `selectCommand` inside `packages/client/src/components/CommandInput.tsx` so that selecting a `/` dropdown entry after the parent rerenders with a new `onDraftChange` identity (i.e. after a session switch) correctly updates the textarea / parent draft.
- Promote the probe tests added during exploration into the regular suite as regression coverage for "`/` dropdown select after session switch."
- Add a code comment on `selectFile`'s deps array documenting that `text` being in the deps is what currently saves it; if those deps are ever tightened, `setText` must be added explicitly.
- No protocol changes, no server changes, no API changes. Pure client-side fix.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `command-autocomplete`: Add a requirement that selecting a `/` dropdown entry (Tab or click) MUST update the textarea / controlled draft regardless of how many times the parent has rerendered or whether the active session changed since mount.

## Impact

- **Affected code**:
  - `packages/client/src/components/CommandInput.tsx` — add `setText` to the dependency array on `selectCommand` (currently `[]`). Add a clarifying comment to `selectFile`'s deps about why it works today.
  - `packages/client/src/components/__tests__/CommandInput.dropdown-select.probe.test.tsx` — keep as a permanent regression suite; promote out of `.probe` naming if desired.
- **No server / API / protocol changes**.
- **No config / docs changes** beyond a brief mention in `docs/architecture.md` and `AGENTS.md` for the `CommandInput.tsx` row.
