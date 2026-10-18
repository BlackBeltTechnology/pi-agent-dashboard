# UI plan — vault LLM delivery (task 7.0)

Boards: `vault-llm.html` (vault page + session chip; index redirects) and `providers.html` (Settings → Providers). Base: the shipped vault page (`retro-ux-credential-vault`, archived 2026-10-14, landed as #900). The archived board is immutable history, so this change's states live here and reuse its assets: `tokens.css`, `mockup.css`, `vault.css` copied verbatim; `icons.js` regenerated from `@mdi/js`; `llm.css` holds the additions, theme tokens only.

Sources: `packages/client/src/components/settings/vault/{VaultAccountsPanel,VaultVariableCard,VaultVariablesTab,vault-ui}.tsx`, `packages/client/src/components/session/VaultBindingsChip.tsx`; specs `vault-llm-credentials`, `vault-llm-delivery`; design D2, D3, D5, D7, D9.

## Surfaces → states (board ids)

| Surface | States | Tests |
|---|---|---|
| Accounts → Sign-in accounts (retro-ux D10 slot) | `signin-list`, `signin-add`, `enrol-form`, `enrol-waiting`, `enrol-no-identity`, `enrol-refused`, `enrol-replaced`, `identity-changed`, `unlink-confirm` | F1, F5 |
| Variables → Model providers group | `llm-populated`, `llm-new`, `llm-new-codex`, `llm-clone-error`, `pool-off`, `pool-failover-ack`, `pool-failover-on`, `llm-problems`, `remove-lease-grant` | F2, F3 |
| Session chip dialog (7.7) | `session-llm`, `session-offline` | F4 |
| Settings → Providers (`providers.html`) | `providers-list`, `link-to-vault`, `add-picker`, `add-another`, `add-another-waiting`, `add-another-done`, `vault-only` | F1 (link route shared) |

## Design decisions (for approval)

| # | Decision | Rejected alternative |
|---|---|---|
| U1 | `llm` bindings are variable cards in a separate **Model providers** group of the Variables tab, below env variables. | A fourth tab: splits "who gets what" across tabs and breaks the shipped D1 card model. |
| U2 | Delivery has plain labels: **Short-lived token** (`lease`), **Through this dashboard** (`proxy`), **API key** (`key`). The spec term goes in `title` and `data-delivery`. | Raw `lease` / `proxy` / `key` in the UI. |
| U3 | The new-binding form offers only valid deliveries for the provider and account. An unavailable lease is shown disabled with its reason; proxy is omitted with a one-line note (F3). Lease is "Recommended" where allowed. | Offer everything and reject on submit. |
| U4 | "Add sign-in account" asks one radio question: **Link this dashboard's pi login** (pre-selected, no extra refresher) or **Sign in to another account** (enrol). | Two separate buttons in the section header. |
| U5 | When the provider gives no identity, enrolment shows an alertdialog: new or replaces `<label>` radios, a required risk checkbox, Save disabled until ticked, Cancel focused. The confirmation is logged (F5). | A plain confirm(). |
| U6 | Failover is a `role=switch` checkbox. Turning it on opens an inline alertdialog with the provider-terms notice; Cancel (focused) keeps it off. When on, the card shows who turned it on and when, cooling members, and the last failover (F2). | A modal page, or a notice shown only once. |
| U7 | Pool order uses up/down buttons (WCAG 2.5.7), not drag. A pool has no per-project account select; the card says why instead. | Drag handles. |
| U8 | The lease caveat ("a token already handed out works until it expires") appears on the lease card, in the unlink and revoke impact, and when removing a lease grant, each time with the real remaining time. | Only in help text. |
| U9 | The session chip groups rows into Environment and Model providers. A model row adds a mode label plus "expires in N min" (lease) or "Last request N min ago" (proxy). Hub offline turns the chip into "Vault: offline". | Mode shown only in Settings. |
| U10 | Tab order **Accounts, Variables, Import**, and Accounts is the default tab (user decision 2026-10-18). This modifies the shipped `credential-vault` requirement "Vault page is organised by variable" (tab list and default) and retro-ux D1; it needs a MODIFIED delta. | Variables first (shipped). |
| U11 | Providers page option A (user decision 2026-10-18): vault accounts are nested under their provider as `data-row-source="vault"` rows with a 'Vault · <kind>' badge, a usage line and 'Manage in Vault'. A pi login row shows 'Linked to vault as <label>' or a 'Link to vault' action. The Add-provider picker gains the group 'Another account for a connected provider', leading to enrolment with a label; on success the next step 'Make it available to a project' opens the Vault model-provider form. A two-line scope legend says that pi logins work everywhere and vault accounts only in granted projects. A hub with only vault accounts shows a callout instead of 'No providers configured'. The Vault page still owns grants and variables. | B: move Vault into the Models nav group. C: link only. |
| U12 | Row text on the Providers page is lifted to the 11/12 px floor (badges 10 → 12 px, meta from `--text-muted` to `--text-secondary`), including the shipped pi rows, so the list uses one recipe. | Leaving pi rows at 10 px: mixed recipes and a probe failure. |

## Testid map (new; all shipped ids unchanged)

| Testid | Element |
|---|---|
| `vault-accounts-signin` | Sign-in accounts group (replaces the reserved-slot text) |
| `vault-signin-new`, `vault-signin-form` | add toggle / link-or-enrol form |
| `vault-account-<id>` + `data-backend` (`link` \| `vault`) | OAuth row (same id pattern as key rows) |
| `vault-oauth-status` + `data-status` (`ok` \| `needs-reauth` \| `identity-changed`) | row status pill |
| `vault-enrol-pending`, `vault-enrol-warning`, `vault-enrol-ack`, `vault-enrol-refused`, `vault-identity-changed` | enrolment / link states |
| `vault-binding-<name>` + `data-target="llm"` | model provider card (same id pattern as env cards) |
| `vault-llm-form` | new model provider form |
| `vault-pool-failover`, `vault-failover-notice` | failover switch / terms notice |
| `provider-row` + `data-row-source="vault"` + `data-account-id`, `provider-vault-linked`, `provider-link-vault`, `provider-link-form`, `provider-vault-link`, `provider-vault-added`, `providers-vault-only`, `provider-scope-legend` | Providers page additions (shipped `provider-row` / `provider-badge` unchanged) |
| `vault-binding-row` + `data-delivery` (`key` \| `lease` \| `proxy`) | chip dialog row; `data-state` gains `expired`, `name-conflict` |

## Tokens

Only those used by the shipped page: `--bg-{primary,secondary,tertiary,surface}`, `--text-{primary,secondary}`, `--border-{secondary,subtle,strong}`, `--accent-{primary,solid}`, `--focus-ring`, `--severity-*`. No new tokens.

## Measured

`tests/e2e/helpers/computed-contrast.ts` (`contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator`) on `.col.proposed .frame` of all 20 vault states and 7 providers states: **0 / 0 / 0** in base dark, base light and nord dark, at 375 and 1440 px. One nord failure (the `p-link` on an inset, 3.96:1) was fixed by making it a secondary button. `node scripts/theme-token-guard.mjs`: no new violations.

## Related

New-folder access ("All my projects" reach + missing-credential offer, U13–U16) is planned separately in `add-vault-reach-all-projects` (board `../../add-vault-reach-all-projects/mockups/reach.html`).
