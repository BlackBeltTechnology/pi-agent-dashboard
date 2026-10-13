# UI plan — retire-trusted-networks-bypass

Board: `network-trust.html` (serve the `mockups/` dir). Tokens: `tokens.css` (generated from `packages/client/src/index.css` + nord dark from `themes.ts`). Recipes: `mockup.css` (ui-contract.md component invariants). The as-built replica (`asbuilt.css`) is used only for the "today" columns.

Design Read profile: `product-ui`. Redesign mode: `preserve` — every existing `data-testid` in `TrustedNetworksSection`, `BlockEventTrustBanner`, `AccessSection`, `ConnectionStatusBanner` is kept; new ones are additive.

## Surfaces → tokens → states

| # | Surface (source) | States | Tokens / recipes |
|---|---|---|---|
| A | Settings ▸ Security ▸ **Network access** (was "Trusted Networks"; `SettingsPanel.tsx` `TrustedNetworksSection`, `BlockEventTrustBanner`) | A1 legacy (decided at upgrade) with 3 network-only devices · A2 legacy → Pair selected, unsaved (consequence shown) · A3 pair with list + refused LAN peer · A4 pair, empty list | radio cards = inset panel + `--tint-blue-*` selected ring; consequence = severity callout warning; list rows = `p-row`; pair-mode refusal row = severity callout info; legacy warning = severity callout warning (replaces `text-amber-400/80`) |
| B | Settings ▸ Access (`AccessSection.tsx`) | B1 legacy, origin upgrade · B2 legacy, origin operator · B3 pair | B1 severity callout warning + `p-link` to Security; B2 severity callout info; store heading text by mode |
| C | App-wide **Network not allowed** banner (`ConnectionStatusBanner.tsx`) on the denied device | C1 pair: Request access · C2 knock pending (hand-off to `add-lan-knock-pairing` PairLanding) · C3 knock refused · C0 legacy today | severity callout warning bar (replaces `bg-amber-500/15 … text-amber-200`); primary button `--accent-solid` |

## Decisions (each cites a public rule)

| Decision | Rule |
|---|---|
| Mode is a two-option radio card with "Recommended" on Pair, not a toggle | Hick's Law (lawsofux.com/hicks-law) — two named choices; NN/g "Toggle-switch guidelines" — a toggle implies immediate effect, this one saves with the panel |
| Switching to Pair shows the consequence inline ("3 devices will be refused until paired") before Save, no modal | Nielsen #5 Error prevention; NN/g "Confirmation dialogs" — avoid modals for routine, reversible choices (legacy is one click back) |
| Section title + list label change with the mode ("Networks that may request access") | Nielsen #2 Match between system and the real world — the label states what the entry does now |
| Pair-mode refusal row names the next step on the *other* device, no "+ Trust" button | Nielsen #9 Help users recognize, diagnose, recover; removes the retired action rather than disabling it (GOV.UK "Don't show users things they can't use") |
| Denied device gets one primary "Request access" action; sign-in and Settings → Servers stay secondary | Von Restorff / one primary action per view (ui-contract anti-slop guardrails) |
| Refused knock shows the server's reason verbatim plus what to ask the operator | Nielsen #9; GOV.UK error-message pattern (say what happened + how to fix) |
| Migration banner states a count ("3 devices"), not a percentage or IP list | Nielsen #1 Visibility of system status; disclosure: `/api/health` carries no peer addresses |
| State never by colour alone: every callout carries an icon + a leading bold phrase | WCAG 1.4.1; ui-contract a11y #4 |

## Copy (en source; i18n keys under `settings.networkAccess.*`, `access.networkTrust.*`, `connection.requestAccess.*`)

- Mode radio: **Pair each device** (Recommended) — "Every phone, laptop or browser is approved once with a code and can be revoked on its own." / **Trust whole networks** (Legacy) — "Any device on the listed networks gets full access without signing in."
- Pair list title: "Networks that may request access". Hint: "Devices on private networks (192.168.x.x, 10.x.x.x, 172.16–31.x.x, Tailscale 100.64.0.0/10) can always request access. Add other ranges here. Listing a network never grants access by itself."
- Legacy list title: "Trusted networks — admitted without sign-in".
- Consequence (Pair selected, unsaved): "**3 devices used network trust in the last 7 days or since the last restart.** After you save, they will be refused until each one pairs (Request access → you approve with a code)." + when `pairing.acceptLanRequests` is off: "Devices can't request access while LAN requests are off on this dashboard." with a checked checkbox "Also accept access requests from devices on this network" (same Save).
- Pair refusal row (private peer): "**192.168.16.31** was refused 4×. On that device, open this dashboard and choose Request access. You'll approve it here with a code."
- Banner (denied device, pair): "**This device isn't paired with home-imac.** Request access, then type the code shown here on home-imac."

## Out of scope here

The knock flow screens themselves (code display, waiting, approval dialog) belong to `add-lan-knock-pairing`; C2 shows only the hand-off point.

## Revision (doubt-review cycle 1)

- Mode is decided once at boot and never re-derived; banner tone keys on `trustModeOrigin` (upgrade → warning, operator → info).
- A2 adds the knock dependency + `acceptLanRequests` checkbox (Nielsen #5: the flip must not strand devices without a self-service path).
- A3 "allow requests" adds the exact address, not a /24 (least privilege).
- C1 keeps Settings → Servers as a secondary action (prerequisite `add-lan-knock-pairing` requires it).

## Revision (doubt-review cycle 3)

- A2 checkbox is **unchecked** by default — `pairing.acceptLanRequests` is off by design in `add-lan-knock-pairing`; switching mode must not silently open knock prompts.
- A2 adds the Operate-tier note (the live UI socket needs `operate`).
- Live previews get a per-preview capability path (no UI surface change; `LiveServerViewer` frames it).
