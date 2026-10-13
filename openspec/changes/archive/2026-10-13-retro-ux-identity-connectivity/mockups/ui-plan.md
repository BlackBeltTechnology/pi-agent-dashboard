# UI plan — retro-ux-identity-connectivity

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`.
Tokens: `tokens.css` is GENERATED from `packages/client/src/index.css` (`:root`, `[data-theme="light"]`) and `THEMES` nord dark. Do not hand-edit it.
Board: `identity-connectivity.html` shows as-built and proposed for every state, with a theme switch (base dark / base light / nord dark) and a width switch (375 / 768 / 1440).

## Surfaces → states

| Surface | Source | States (fixture ids) |
|---|---|---|
| Users | `connectivity/UsersSection.tsx` | `loading`, `load-error`, `disabled`, `bootstrap`, `list` (active + invited + revoked + orphaned), `unstable` (invite disabled + reason), `invite-open`, `copy-failed`, `revoke-confirm`, `mutation-error` |
| Passkey impact note | `connectivity/PasskeyImpactNote.tsx` | `none` (renders nothing), `impact` |
| Server selector | `connectivity/ServerSelector.tsx` | `trigger-connected`, `trigger-offline`, `open-probing`, `open-mixed` (current, available, unreachable, denied, CORS-blocked, name-not-found, moved-to), `switching` |
| Known servers | `connectivity/KnownServersSection.tsx` | `loading`, `empty`, `list` (verified + unverified + moved-to), `read-only`, `add-open`, `add-error`, `load-error` (as-built: shows `empty`) |
| Network discovery | `connectivity/NetworkDiscoverySection.tsx` | `idle`, `scanning`, `scan-error`, `empty-diagnostic`, `manual-error`, `results` (new, already added, updated, adding) |

## Findings → rule → proposed decision

| # | Surface | As-built (cite) | Rule broken | Proposed |
|---|---|---|---|---|
| F1 | all | information text in `--text-muted` (Users rpId/passkey count/bootstrap hint, known/discovery `host:port`, empty text) | WCAG 1.4.3; `ui-contract.md` "`--text-muted` is decoration only" (2.77:1 / 2.32:1) | `--text-secondary` |
| F2 | selector | `host:port` in `--text-tertiary` | **withdrawn** in doubt-review: light `--text-tertiary` is `#636363` (`index.css:279`), about 4.55:1 on `--bg-surface`, so it passes. The 4.48:1 figure comes from a stale `ui-contract.md` a11y #6 row (`#777777`) | keep `--text-tertiary` |
| F3 | selector | connection = green/red dot only (`bg-green-500`/`bg-red-500`) on trigger and current row | WCAG 1.4.1; contract a11y #4 (shape + text) | dot + text "Connected"/"Offline" (status word in `--text-secondary`, dot `aria-hidden`, status family on shape only) |
| F4 | selector, discovery | Local/Remote chip `bg-blue-500/20 text-blue-400` / `bg-purple-500/20 text-purple-400`; icons `text-blue-400`/`text-purple-400` | `ui-contract.md:66` palette ban | identity pill: `--tint-blue-*` (Local) / `--tint-purple-*` (Remote), 11 px (12 px inside an interactive item) |
| F5 | selector | state words `text-amber-400`/`text-red-400`/`text-green-500` at `text-[10px]` | palette ban; type floor ("below 11px never the only carrier of a state") | severity pill (fg on its own bg) at 12 px — inside an interactive item — plus an icon |
| F6 | selector | blocked rows: reason only in `title` tooltip; `disabled` button cannot be focused | WCAG 1.4.13, 2.1.1; NN/g tooltip guidance | reason as a visible 2nd line; row `aria-disabled` (focusable, not activatable) |
| F7 | selector | no state while probing (blank until the result arrives) | Nielsen #1 visibility of system status | "Checking…" per row until the probe settles |
| F8 | selector | no `aria-expanded`/`aria-haspopup`, no Esc, no arrow keys; panel in a portal breaks Tab order | WCAG 2.1.1, 4.1.2; WAI-ARIA APG menu button | APG menu button: `menuitemradio` per server (`aria-checked` = current, blocked = `aria-disabled` but focusable), move = its own `menuitem` "Update X to Y", Manage = `menuitem`; Enter/Space/↓ opens and focuses the first item, ↑↓ Home End, Enter activates, Esc closes and returns focus to the trigger |
| F9 | selector, known, discovery | Update / Add buttons `bg-blue-600 text-white`; links `text-blue-400` | palette ban | primary button recipe (`--accent-solid`) / secondary button recipe; links `--accent-text` |
| F10 | known, discovery | inputs labelled by placeholder only | WCAG 3.3.2, 1.3.1; contract "input … + persistent label above" | visible field labels |
| F11 | known, discovery | icon-only Remove / Confirm / Cancel with `title`, no target in name | WCAG 4.1.2, 2.5.8 (target ≥24 px) | `aria-label="Remove office-mac (office-mac.local:8000)"`, 32 px targets |
| F12 | known | Remove is one click, no confirm; Users uses two-click revoke | Nielsen #5 error prevention, #4 consistency | same two-click confirm as Users |
| F13 | known | load failure swallowed → shows "No remote servers saved" | Nielsen #9 | severity-error callout + Retry |
| F14 | known, discovery | remove / add-confirm failures swallowed | Nielsen #9 | inline severity-error line on the row |
| F15 | known | read-only viewer: controls silently absent | Nielsen #1 | one-line note "Read-only — an operator credential is needed to change servers." |
| F16 | known | pinned identity (`fingerprint`) invisible; verified = unverified | Nielsen #1; #867 goal "honest labels" | **NEW (needs approval)**: "Verified" severity-success pill with shield icon on pinned entries; nothing on unpinned |
| F17 | known, discovery | moved-to: `text-amber-400` line + blue button | palette ban | severity-warning callout row "Moved to …" + secondary "Update" |
| F18 | discovery | scan error `text-red-400`; "Scan network"/"Scanning..." not i18n | palette ban; i18n | severity-error callout + Retry; i18n keys |
| F19 | discovery | mDNS diagnostic: 5-item list always expanded, `text-amber-400` icon | NN/g progressive disclosure; palette ban | severity-info callout, headline + "Why?" disclosure (content preserved), manual add below |
| F20 | discovery | "Already added"/"Updated existing entry" `text-green-500` | palette ban | severity-success text + check icon |
| F21 | users | badges `text-[10px] uppercase` `--text-muted` for status + orphaned | type floor; F1; WCAG 1.4.1 (orphaned looks like status) | status pill 11 px: active = success, invited = info "Invite pending", revoked = neutral; orphaned = severity-warning pill + subline |
| F22 | users | copy failed in `--status-error` as text | `ui-contract.md:62` status = shapes only | `--severity-error-fg` |
| F23 | users | text-link buttons (Add user, Invite QR, Revoke, Copy link) without focus style, ~16 px tall | WCAG 2.4.7, 2.5.8 | `focus-ring`; Add user = primary button; row actions = 32 px secondary/tint buttons; Revoke confirm = `tint-action-red` |
| F24 | users | unstable reason: bare warning text line | contract severity callout | severity-warning callout (icon + text); invite still `aria-describedby` |
| F25 | users | QR on `bg-white` | palette ban — **documented exception**: a QR needs a light quiet zone (ISO/IEC 18004 §6.3.8) | keep white quiet zone, add a comment that cites it |
| F26 | impact note | `--severity-warning-fg` 11 px `role="status"` | none | ok — unchanged |

## Protected (preserve)

Routes and tab ids (`remote`, `security`); section titles "Known Servers", "Network Discovery", "Users"; i18n keys of existing strings; field names; every `data-testid` in `UsersSection.tsx` (`users-disabled`, `users-unstable`, `users-add-form`, `users-invite`, `user-*`, `user-status-*`, `user-orphaned-*`, `user-invite-*`); `data-unreachable` / `data-denied` / `data-cors-blocked` / `data-name-not-resolved` on selector rows. New testids may be added.

## Verdicts

| Surface | Verdict |
|---|---|
| Users | polish (F1, F21–F25) |
| Passkey impact note | ok |
| Server selector | redesign (F3–F9) |
| Known servers | redesign (F1, F9–F17) |
| Network discovery | polish (F1, F4, F9–F11, F14, F18–F20) |
