# UI plan — Vault operate-refusal callout

Change: `surface-operate-required-remedy`. Surface: Settings → Vault
(`packages/client/src/components/settings/vault/VaultSection.tsx`), the load-error
slot only. Board: `operate-callout.html` (as-built vs proposed per state).

## Ground (sources read)

- As-built: `VaultSection.tsx:56-58` renders `vault-error` as
  `text-sm text-[var(--accent-red-text)]` "Couldn't load the vault: {error}".
- `ui-contract.md`: severity callout recipe (`rounded-md border
  bg-[var(--severity-X-bg)] border-[var(--severity-X-border)]
  text-[var(--severity-X-fg)]`); a11y #7 — `--severity-X-fg` is text-safe only on
  its own bg, `--accent-text` is not text-safe in nord dark, so a link inside a
  callout inherits the callout fg and is underlined; state carries shape or text,
  not colour alone; primary/secondary targets ≥ 44 px below `sm`.
- Kit reused from `retro-ux-credential-vault/mockups` (`mockup.css`, `vault.css`,
  `asbuilt.css`, the `abHeader` shell) so both boards read alike; `tokens.css`
  is today's generated copy (base dark/light verbatim + nord dark).
- `retro-ux-credential-vault` board state `load-error` (F1) proposed a red error
  callout "You can't manage the vault from this browser…" with Try again. This
  plan supersedes that one state; its shell redesign is unaffected.

## Decisions

| # | Decision | Rule cited |
|---|---|---|
| D1 | Info severity, not error: the refusal is a by-design permission boundary, not a fault the user caused. | Nielsen #9 (help users recognize, diagnose, recover — name the cause, not just "error"); GOV.UK error-message guidance (reserve error styling for something the user must fix in a field) |
| D2 | `role="status"` (polite), not `role="alert"`. | WAI-ARIA APG Alert pattern — alerts are for important, time-sensitive information; this appears on load and is not urgent |
| D3 | Title in words + lock glyph: "This device can't open the vault". | WCAG 2.2 SC 1.4.1 Use of Color; Nielsen #2 (match the real world — "device", not "operate-tier credential") |
| D4 | One sentence of why, then a "What you can do" list, one row per remedy in server order; each row = glyph + instruction. | Nielsen #9; Hick's law (only the applicable options, never a menu of everything); WCAG 1.3.1 (a real `<ul>`, labelled) |
| D5 | `sign-in` row carries an inline "Sign in" link to `/auth/login`; underlined, inherits the callout fg. | ui-contract a11y #7; WCAG 1.4.1 (underline, not colour, marks the link); Fitts (action next to its instruction) |
| D6 | A "Try again" ghost button re-runs the load (after pairing or signing in elsewhere) — no full reload. | Nielsen #3 (user control and freedom); ui-contract touch floor (≥ 44 px below `sm`) |
| D7 | No server-supplied names in copy: "the computer that runs it", never a host name or IP. | Spec disclosure rule (`operate-required-remedy`) |
| D8 | Any other failure, and an older server's body without `remedies`, keep today's `vault-error` line unchanged. | Spec "Older server" / "Other failure"; Jakob's law (no surprise change outside scope) |
| D9 | `re-pair` copy states the HTTPS requirement up front, since a plain-http LAN browser cannot pair. | Nielsen #5 (error prevention — don't send the user into a dead end) |

## Protected elements

`data-testid="vault-section"`, `vault-error` (other failures), the section
heading and description, the `vault.loadFailed` i18n key.

## New test ids

`vault-operate-required` (callout), `vault-operate-remedy` with `data-remedy`
(row), `vault-operate-signin` (link), `vault-operate-retry` (button).

## Copy

| key | text |
|---|---|
| `vault.operateRequired.title` | This device can't open the vault |
| `vault.operateRequired.why` | The vault shows which keys exist and where they go, so it opens only for an operator. |
| `vault.operateRequired.listLabel` | What you can do |
| `vault.operateRequired.use-host` | Open the dashboard on the computer that runs it. |
| `vault.operateRequired.re-pair` | This device is paired with less than Operate access, and access is fixed when a device is paired. On the host, revoke it in Paired devices, then pair it again with Operate access. Pairing needs an HTTPS address of this dashboard. |
| `vault.operateRequired.sign-in` | Sign in with an operator account. |
| `vault.operateRequired.signInLink` | Sign in |
| `vault.operateRequired.retry` | Try again |

## Score (TEST step)

Captured with `score_mockup` (Playwright; URL params `theme`, `width`, `view`):
proposed-only base dark 1440 + 375, side-by-side base light 1440, proposed-only
nord dark at 375 frame. `validate_mockup` L2 (axe contrast floor) on all three
palettes.

| Check | Result | Evidence / reason |
|---|---|---|
| Contrast (WCAG AA) light + dark + nord | PASS | axe L2 PASS ×3; text is `--severity-info-fg` on `--severity-info-bg` only (a11y #7) |
| Responsive / touch ≥ 44 px below `sm` | PASS | 375 frame wraps without overflow; Try again and Sign in floored at 44 px |
| Hierarchy | PASS | one callout; bold title, then why, then the labelled list; no competing primary |
| Spacing from scale | PASS | 4 / 8 / 12 px only |
| Token fidelity | PASS w/ documented exceptions | L1 hits are `tokens.css` (generated definitions) and the copied retro-ux kit (`#fff` primary-button recipe, `#882` in a comment); `callout.css` has none |
| Anti-slop | PASS | contract severity recipe, real product copy, no gradient or decorative illustration |
| Console clean | UNVERIFIED | Playwright captures raised no page error; console not inspected |

Score: 6/7 PASS, 1 unverified.
