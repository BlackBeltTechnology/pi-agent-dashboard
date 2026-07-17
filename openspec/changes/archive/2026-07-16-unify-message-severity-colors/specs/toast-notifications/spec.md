## MODIFIED Requirements

### Requirement: useToast hook
The `useToast` hook SHALL provide `showToast(text, variant?, opts?)` and `dismissToast(id)`. `variant` SHALL be one of `error | warning | success | info | neutral` and SHALL default to **`neutral`** when omitted, so an unmarked toast is styleless and never reads as an error. Flipping this default SHALL be co-requisite with tagging every currently-untagged **error** call site `"error"` — the default flip SHALL NOT land while any error path still relies on the old red default. Each toast SHALL have a unique auto-incrementing ID.

#### Scenario: Unmarked toast is neutral
- **WHEN** `showToast("Session spawned")` is called with no variant
- **THEN** the toast SHALL render in the **neutral** style (not red)

#### Scenario: No error path silently downgrades
- **WHEN** the default is `neutral`
- **THEN** `notifyError` (`App.tsx`), open-editor failure and spawn-failure (`SessionList.tsx`) SHALL each pass `"error"` explicitly
- **AND** a repo scan of `showToast(` call sites SHALL show no bare error call remaining

#### Scenario: Success is not red
- **WHEN** a spawn succeeds or a commit completes
- **THEN** the call site SHALL pass `"success"` and the toast SHALL render green

#### Scenario: Spawn ternary is split, not trailing-tagged
- **WHEN** `SessionList.tsx:304`'s success/failure ternary is updated
- **THEN** it SHALL be split so the success branch passes `"success"` and the failure branch passes `"error"` — a single trailing variant argument (which would tag both branches) SHALL NOT be used

#### Scenario: Warning tier available
- **WHEN** `showToast(text, "warning")` is called
- **THEN** the toast SHALL render orange (`--severity-warning-*`), distinct from working-yellow

#### Scenario: Info is blue
- **WHEN** `showToast(text, "info")` is called
- **THEN** the toast SHALL render `--severity-info-*` (blue), independent of `--status-notice`

## ADDED Requirements

### Requirement: Single canonical ToastVariant
`ToastVariant` SHALL have one canonical definition enumerating exactly `error | warning | success | info | neutral`. The duplicate in `useAsyncAction.ts` SHALL re-export it, and the inline union at `useMessageHandler.ts:153` SHALL reference it — no independent copy SHALL remain.

#### Scenario: One definition, all consumers agree
- **WHEN** the client type-checks after the change
- **THEN** every `showToast`/`ToastVariant` consumer SHALL resolve to the single five-value type with no `tsc` error

### Requirement: Protocol warn maps to the warning token
`ToastSlot` SHALL map the protocol `ToastPayload.level` value `"warn"` onto `--severity-warning-*`. `ToastPayload.level` SHALL NOT be renamed (protocol non-goal).

#### Scenario: warn renders the warning color
- **WHEN** a plugin emits a toast with `level: "warn"`
- **THEN** `ToastSlot` SHALL render it using `--severity-warning-*`, not a nonexistent `--severity-warn-*`

### Requirement: VARIANT_CLASSES covers every variant from tokens
`VARIANT_CLASSES` SHALL provide a box + close-button style for each of the five variants, sourced from `--severity-*` triples.

#### Scenario: Every severity has a token-sourced style
- **WHEN** a toast renders with any of the five variants
- **THEN** `VARIANT_CLASSES` SHALL resolve its style from `--severity-<level>-{bg,fg,border}`, not raw Tailwind literals
