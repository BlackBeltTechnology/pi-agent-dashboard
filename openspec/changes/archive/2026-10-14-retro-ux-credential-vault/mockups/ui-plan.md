# UI plan — credential vault

Sources (develop @ e3a28e717): `packages/client/src/components/settings/vault/*.tsx`, `packages/client/src/components/session/VaultBindingsChip.tsx`, `packages/client/src/lib/vault/vault-api.ts`. Board: `vault.html`. Findings and approval: `audit.md`.

## Surfaces → states (board ids)

| Surface | States |
|---|---|
| Page shell | `page-stale-server`, `page-load-error`, `page-loading`, `page-first-run`, `page-corrupt` |
| Variables | `variables-populated`, `variables-repair`, `variables-grant-picker-live`, `variables-grant-picker-recent`, `variables-grant-manual`, `variables-plugin-request`, `variables-plugin-approve`, `variables-bad-name`, `variables-delete-confirm` |
| Accounts | `accounts-list`, `accounts-add`, `accounts-add-too-short`, `accounts-add-partial`, `accounts-rotate`, `accounts-revoke-confirm`, `accounts-future-slots` |
| Import | `import-candidates`, `import-review`, `import-done` |
| Session chip | `session-delivered`, `session-pending-confirmation`, `session-mixed`, `session-grant-from-session` |

`variables-grant-picker-live` shows rejected option A for comparison; approved D2 is B (`-recent`). `page-load-error` proposed is superseded by `surface-operate-required-remedy`.

## Component map (proposed)

| Component | Holds | From |
|---|---|---|
| `VaultSection.tsx` | header + flow strip, tablist (component state; inactive panels mounted + `hidden`), load / first-run / corrupt states | today's `VaultSection` |
| `VaultVariablesTab.tsx` (new) | toolbar, new-variable form, plugin-request callouts, card list (`vault-grants-list`), other confirmed checkouts | `VaultBindingsPanel`, `VaultPluginsPanel` |
| `VaultVariableCard.tsx` (new) | default select, project rows, picker toggle, plugin switches, delete confirm | `VaultBindingsPanel` |
| `VaultProjectPicker.tsx` (new) | radio group open / remembered, search, manual entry, account choice | `vault-grant-form` |
| `VaultAccountsPanel.tsx` | account rows with usage, add form (+ variable option), rotate, revoke confirm, kind sections | today's panel |
| `VaultImportPanel.tsx` | candidates, review with variable option, done callout | today's panel |
| `vault-ui.tsx` | `StatusPill`, `ConfirmImpact`, `FieldError`, recipes (no raw class strings duplicated) | today's helpers |
| `VaultBindingsChip.tsx` | chip, dialog: project line, confirm callout, state rows + help, ungranted section, footer link | today's chip |

## Testid map

| Testid | As-built element | Proposed element |
|---|---|---|
| `vault-section` | page root | page root |
| `vault-error` | load error line | load error callout |
| `vault-corrupt` | corrupt banner | corrupt callout |
| `vault-panel-bindings` | bindings panel | Variables tabpanel |
| `vault-panel-accounts` | accounts panel | Accounts tabpanel |
| `vault-panel-import` | import panel | Import tabpanel |
| `vault-panel-grants`, `vault-panel-confirmations`, `vault-panel-plugins` | panels | retired (no test reference) |
| `vault-bindings-list` | bindings list | card list wrapper (outer) |
| `vault-grants-list` | grants list | card list wrapper (inner, contains every `vault-grant-row`) |
| `vault-binding-<NAME>` | binding row | variable card |
| `vault-binding-repair` | "needs an account" text | no-default pill |
| `vault-grant-row` + `data-state` (`ok` \| `no-account`) | grant row | project row; pill status in new `data-status` (`delivering` \| `pending` \| `no-default` \| `no-account`) |
| `vault-grant-no-account` | warning text | error pill |
| `vault-confirmations-list`, `vault-confirmation-row` | confirmations list / row | "Other confirmed checkouts" list / row, and the checkout rows inside a repository grant |
| `vault-plugin-<id>-<NAME>`, `vault-plugin-approve` | row / checkbox | approval row in its variable card, or the request row when no such variable exists / `<input type="checkbox" role="switch">` |
| `vault-accounts-list`, `vault-account-<id>`, `vault-account-label`, `vault-accounts-empty`, `vault-accounts-other`, `vault-account-form` | as today | same meaning |
| `vault-import-*` | as today | same meaning |
| chip testids (`vault-chip` + `data-pending`, `vault-bindings-dialog`, `vault-binding-row` + `data-state`, `vault-binding-state`, `vault-confirm`, `vault-pending-copy`, `vault-revoked-note`, `vault-last-contact`, `vault-bindings-close`, `vault-confirm-error`) | as today | same meaning |
| new | — | `vault-tab-<id>`, `vault-empty`, `vault-grant-picker`, `vault-plugin-request`, `vault-confirm-impact`, `vault-ungranted`, `vault-grant-from-session` |

## Tokens

Proposed recipes use only: `--bg-primary/secondary/tertiary/surface/hover`, `--text-primary/secondary`, `--border-secondary/subtle/strong`, `--accent-primary`, `--accent-solid`, `--focus-ring`, `--link`, `--link-hover`, `--severity-{success,info,warning,error,neutral}-{bg,fg,border}`, `--tint-blue-*`, `--tint-red-*`, `--elevation-rim`, `--shadow-card`. As-built `--accent-{red,yellow,green}-text` state text is replaced by severity pills (D9).
