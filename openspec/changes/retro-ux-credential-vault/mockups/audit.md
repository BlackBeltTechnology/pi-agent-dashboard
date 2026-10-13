# Audit — credential vault UI (#882, add-credential-vault)

Shipped without a mockup: `add-credential-vault` (archived 2026-10-13) has no `mockups/` and no `See change:` row in `mockups/AGENTS.md`.
Surfaces: Settings ▸ Network ▸ Vault (`settings/vault/*.tsx`, 6 files, 678 lines) and the session-header Vault chip (`session/VaultBindingsChip.tsx`).
Board: `vault.html` (27 states, 5 surfaces), as-built replica `asbuilt.css` (classes 1:1 from `vault-ui.tsx` + chip), proposed recipes `mockup.css` + `vault.css`, tokens `tokens.css` (identical to `packages/client/src/index.css` `:root` + `[data-theme=light]`; nord from `THEMES`).

## Measured — repo probes on the board

`tests/e2e/helpers/computed-contrast.ts` (`measureText` → `contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator`) on `.col.<asbuilt|proposed> .frame` of every `article.state`, run with bun + playwright.

| Theme | As-built contrast / size / focus | Proposed contrast / size / focus |
|---|---|---|
| Base dark | 0 / 13 / 0 | 0 / 0 / 0 |
| Base light | 0 / 13 / 0 | 0 / 0 / 0 |
| Nord dark | 0 / 13 / 0 | 0 / 0 / 0 |

As-built size failures: 10 px and 11 px text in the chip, its dialog and the last-contact line (`text-[11px]`, `text-[10px]`). Console errors: 0. Proposed column also checked at 375 px (container query collapses the field grid and wraps row actions).

The probes pass most of the as-built page. Its defects are information architecture and interaction, listed below.

## Findings

| # | Finding | Evidence (as-built) | Heuristic / rule |
|---|---|---|---|
| F1 | A server older than the client answers `GET /api/vault` with `index.html` (200). The page says "Couldn't load the vault: HTTP 200". | `vault-api.ts` `call()` swallows the JSON parse error (`.catch(() => ({}))`); server SPA fallback serves unknown `/api/*` as HTML. Reproduced 2026-10-13 (server pid started before #882 merged). | Nielsen #9 (help users recognise and recover from errors) |
| F2 | Loading shows the header and nothing else. | `VaultSection` renders panels only when `overview` is set. | Nielsen #1 (visibility of system status) |
| F3 | An empty vault shows four "No X yet" panels; the first useful action (import) sits second. | `VaultSection` panel order. | Nielsen #6, #10; Hick's law |
| F4 | Corrupt banner is plain bordered text; forms stay enabled although writes are refused. | `vault-corrupt` div; panels unchanged. | Nielsen #5 (error prevention) |
| F5 | "Which projects get `GEMINI_API_KEY`?" has no answer on screen; grants are a flat subject × binding list. | `VaultBindingsPanel` grants list. | Nielsen #6 (recognition over recall) |
| F6 | Confirmed checkouts are a separate list, disconnected from the repository grant they unlock. | `vault-confirmations-list`. | Gestalt proximity |
| F7 | State is colour-only text (`needs an account`, `no account: delivers nothing`); a pending repository grant shows no state at all on the settings page. | `--accent-yellow-text` spans. | WCAG 1.4.1 (use of colour) |
| F8 | A grant whose override account was revoked offers no repair action, only Delete. | grant row. | Nielsen #9 |
| F9 | Granting asks for raw identifiers: a normalised repository key, or a device id plus an absolute path. The hub already knows `{deviceId, dir, repoKey}` for every synced session. | `vault-grant-form` (`placeholder="hub"`, `github.com/acme/app`). | Nielsen #6, #7 |
| F10 | Plugin approvals are a separate panel; a plugin that declares a name with no variable (real: `demo` → `POLY_PIZZA_KEY`) gives no way forward. | `VaultPluginsPanel`. | Nielsen #6 |
| F11 | A reserved name error appears at the top of the page, far from the field, and does not say what to use instead. | `ErrorLine` "Invalid or reserved environment variable name". | Nielsen #9; WCAG 3.3.1/3.3.3 |
| F12 | Delete variable is one click and silently removes every grant and plugin approval for it (`deleteBinding` filters `grants` and `pluginApprovals`). | `vault-bindings.ts:93`. | Nielsen #5 |
| F13 | Accounts show provider + label only; you can't see what an account is used for before rotating or revoking it. | `VaultAccountsPanel` rows. | Nielsen #1 |
| F14 | Inputs have no visible labels (placeholder + aria-label only); the 8-character minimum is checked only by the server. | account form. | WCAG 3.3.2; Nielsen #5 |
| F15 | Rotate gives no hint that running processes keep the old value. | rotate row. | Nielsen #1 |
| F16 | Revoke is one click; its impact (`affectedBindings`, override grants turning `no-account`) is visible only afterwards. | `revokeAccount`. | Nielsen #5 |
| F17 | No place for the two in-flight vault changes: OAuth/LLM accounts (`add-vault-llm-delivery` task 7.6, no mockup) and `service:*` accounts (`absorb-service-secrets-into-vault` D2 "Services" group). Today they would be hidden as "N account(s) of another kind". | `vault-accounts-other`. | Consistency (Nielsen #4) |
| F18 | Import creates accounts only; the user must then create a variable per key by hand. | `confirmImport`. | Nielsen #7 |
| F19 | After import there is no next step. | `vault-import-done`. | Nielsen #1 |
| F20 | The chip and its dialog use 10 px / 11 px text and colour-only states. | probes: 13 size failures per theme. | ui-contract 12 px floor; WCAG 1.4.1 |
| F21 | Checkout confirmation is a security decision (any clone can claim an origin) but is a small secondary button under a one-line question. | `vault-confirm`. | Nielsen #5; docs/credential-vault.md §4 |
| F22 | States such as `local-override`, `inherited` and `blocked-name` carry no explanation. | `STATE_LABEL_EN`. | Nielsen #10 |
| F23 | From a session you can see what it gets but not grant what it lacks; the chip is hidden when the session has no binding. | `VaultBindingsChip` returns null at 0 bindings. | Direction C (project view) |

## Approval

2026-10-13, via `ask_user` on the served board (`vault.html`, 27 states). Approved: D1, D3, D4, D5, D6, D7, D8, D9, D10 (all offered). D2: option **B**, open sessions plus projects remembered by the hub (new persisted list). After approval the D3 add-key copy was corrected on the board (an account becomes a variable's default; it is not "attached"), with no change in scope; the probes were re-run (proposed 0/0/0 in all three themes).

| Decision | Findings | Board states |
|---|---|---|
| D1 Tabs + one card per variable (projects, checkouts, plugins inline) | F5, F6, F10 | variables-populated, variables-plugin-request, variables-plugin-approve |
| D2-B Project picker: open sessions + remembered projects + manual fallback | F9 | variables-grant-picker-recent, variables-grant-manual (picker-live shows option A for comparison) |
| D3 Combined creation (add key → variable default; import → same-name variables) | F14, F18, F19 | accounts-add, import-review, import-done |
| D4 Grant from the session dialog (operators) | F23 | session-grant-from-session |
| D5 Checkout confirmation callout + primary action | F21 | session-pending-confirmation |
| D6 Two-step confirm with impact | F12, F16 | variables-delete-confirm, accounts-revoke-confirm |
| D7 Stale-server / non-JSON detection + `/api/*` JSON 404 | F1 | page-stale-server, page-load-error |
| D8 First run, loading, corrupt, inline validation | F2, F3, F4, F11, F14 | page-first-run, page-loading, page-corrupt, variables-bad-name, accounts-add-too-short |
| D9 Status pills + explanations | F7, F8, F20, F22 | variables-repair, session-delivered, session-mixed |
| D10 Reserved sections for later account kinds | F17 | accounts-future-slots |

F13 and F15 (usage line, rotate hint) ride on D1/D6: they share the account row recipe.

### Doubt-review cycle 1 (2026-10-13): board changes

- `page-load-error` proposed: superseded. The 403 `operate_required` callout is owned by the in-flight `surface-operate-required-remedy`.
- `accounts-add-partial`: new state, D3 partial-failure copy. It awaits confirmation with the cycle results.
- Delete-impact copy: "Connected sessions lose it within seconds" replaces "on their next sync", per `credential-delivery` 5 s propagation.
- Plugin approval: `<input type="checkbox" role="switch">` styled as a switch. The existing tests keep `.checked`.
- Grant rows: `data-state` stays the server grant state (`ok` | `no-account`); the pill status moves to `data-status`.
- Chip "Not granted" rows: repository note added.
- Re-probed: proposed 0 / 0 / 0 in all three themes.

### Post-review decisions (2026-10-13, `ask_user` after doubt cycle 3)

- **Authority: option B (design D11).** Every vault route requires `operate` for `session` and `principal` callers too. Device and local trust are unchanged.
- **Retention confirmed:** 200 entries, 100 per device, 90 days unseen, at most one write per project per hour.
- **Approved board additions:**
  - `accounts-add-partial` state;
  - "Applies to every session in this checkout" on the confirm callout;
  - a neutral "Not delivered to sessions" pill for non-project subjects;
  - `page-load-error` proposed dropped (owned by `surface-operate-required-remedy`).

### After capture (implementation, 2026-10-14)

- `tests/e2e/retro-ux-credential-vault.spec.ts` with `RETRO_UX_CAPTURE=1` against the docker harness: 7 of 7 passed; every contrast, size and focus list empty in base dark, base light and nord dark at 375 / 768 / 1440. 261 screenshots in `mockups/after/` (page shell, variables, accounts, import, session chip, chip trigger).
- Replica vs capture: the real render follows the proposed column (tabs with counts, flow strip, variable cards with status pills, inline field errors). Differences are limited to real data (long repository keys wrap) and the Settings shell around the page. The chip trigger surface (2 states) is probed in addition to the board's 27 states.
- `page-load-error` stays out (owned by `surface-operate-required-remedy`), as agreed.
- Visual sign-off against the board stays a human review (test-plan #F7, task 5.48).
