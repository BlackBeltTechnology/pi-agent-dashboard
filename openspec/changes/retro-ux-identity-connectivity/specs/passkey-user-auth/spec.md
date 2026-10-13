## ADDED Requirements

### Requirement: Users section conforms to the UI contract in every state
The Users section, the invite QR panel and the passkey impact note SHALL paint only through theme tokens and semantic families, with no Tailwind palette class, hex or `rgba(` literal except the invite QR's light quiet-zone background (an exception this change adds to `ui-contract.md`), and SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}`. This SHALL hold in each of these states: loading; load error; feature disabled; first-operator bootstrap; a list with active, invited, revoked and orphaned-passkey users; passkeys unavailable on an unstable origin; an open invite (QR and link); copy failed; revoke confirmation; a failed mutation; and the orphaned-passkey impact note on a primary switch.

#### Scenario: Every state passes the probes
- **WHEN** the capture spec installs each listed state and probes the Users section in every default theme
- **THEN** every contrast, size and focus failure list is empty

#### Scenario: User status is a labelled pill
- **WHEN** the list shows an active, an invited and a revoked user, and one user with orphaned passkeys
- **THEN** each status is a text pill of at least 11 px from the severity family (12 px when inside an interactive element), and the orphaned count is a separate warning pill, not a neutral badge

#### Scenario: Actions are real buttons with focus and target size
- **WHEN** the Users section is rendered with users
- **THEN** "Add user" is the section's one primary button, sized by the `ui-contract.md` primary-button recipe (at least 44 px tall below the `sm` breakpoint, 36 px from `sm` up); each row action (tier, Invite QR, Revoke) is at least 32 px tall; and every button, select and input in the section shows a visible `--focus-ring` outline when it receives keyboard focus (checked by focusing each control and reading its computed outline, because `buttonsWithoutFocusIndicator` covers buttons only)

#### Scenario: Existing test ids survive
- **WHEN** the restyle lands
- **THEN** every `data-testid` present in `UsersSection.tsx` before the change is still rendered in the matching state, and `PasskeyImpactNote` still renders the `testId` its callers pass
