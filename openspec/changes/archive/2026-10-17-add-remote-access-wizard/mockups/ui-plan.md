# UI plan — add-remote-access-wizard

Board: `remote-access.html` (serve the `mockups/` dir). Tokens: `tokens.css` and recipes `mockup.css`, copied from `retire-trusted-networks-bypass/mockups/` (generated from `packages/client/src/index.css` + nord dark from `themes.ts`). Board sections: A clickable dialog + machine-state simulator, B toolbar icon variants, C screens folded in from in-flight changes, D decisions.

Design Read profile: `product-ui`. Redesign mode: `overhaul` for the dialog shell (tabs → status landing + task wizards), `preserve` for the reused sections — every `data-testid` in `GatewayPairQR`, `GatewaySetupGuide`, `GatewayReservedName`, `GatewayConnectToggle`, `WaitingDevices` stays; new ones are additive.

## Surfaces → tokens → states

| # | Surface (source) | States | Tokens / recipes |
|---|---|---|---|
| A0 | Toolbar button (`connectivity/TunnelButton.tsx`) | local · lan · net · partial · failed; ± waiting badge | glyph `--text-secondary`; state dot `--text-tertiary` / `--accent-primary` / `--status-idle` / `--status-working` / `--status-error`; badge `--accent-solid` + white |
| A1 | Dialog landing (replaces `Gateway/GatewayDialog.tsx` tabs) | roads off/on per row; waiting requests; per-task hint (`N steps` / `Ready` / `On` / `network first`) | road rows = `p-row`-like on `--bg-tertiary`; on = `--severity-success-*`; task buttons = `--tint-blue-*` icon tile; hints = `pill` neutral/success |
| A2 | Wizard step list | step `current` / `todo` / `skipped` (already set) / `done`; footer primary busy | current ring `--tint-blue-border`; done/skipped marker `--severity-success-*`; consequence = `callout warning` (LAN http) or `callout info` (public URL) |
| A3 | Share steps: provider → install → enable → name (public providers only) → connect → who may enter | per provider (zrok/ngrok public; tailscale/zerotier private, no name step) | radio cards (from `retire-trusted-networks-bypass`), `cmd` copy rows on `--bg-code` |
| A4 | Device steps: road → [inserted LAN or share steps] → QR → approve | road known (skipped) / road choice; TLS QR vs LAN link + Request access; approve ok / refused with remedies | `qr` documented light exception; refusal = `callout error` with copy rows (C2) |
| A5 | LAN steps: bind (restart) → accept requests → who may enter | per check | `callout warning` before bind |
| A6 | Remote steps: which machine → reach check → request access (desktop app: native knock, code shown inline as in the mockup; browser: opens the remote's `/pair?request` tab, which shows the code, then "I'm approved") → switch | discovered list Available / Unreachable | `pill success/error` (server-selector vocabulary) |
| C1 | Denied device bar (from `retire-trusted-networks-bypass` C1/C2) | request / waiting with code | `severity-warning` / `severity-info` bar |
| C2 | Approval refusal remedies (from `fix-pairing-approval-credential`) | no credential | `callout error` + copy rows + sign-in link when OAuth set |
| C3 | Legacy trust warning inside "Who may enter" | `network.trustMode=legacy` | `callout warning` + link to Settings ▸ Security |

## Step engine (what the mockup's simulator encodes)

| Step | Applies when | Satisfied (→ collapsed "already set") when |
|---|---|---|
| provider | always in share | `tunnel.provider` configured |
| install | always | readiness `installed` |
| enable | always | readiness enrolled/authenticated |
| name | provider is public (zrok, ngrok) | `tunnel.zrok.reservedName` set |
| connect | always | provider in `connectedProviders` |
| bind | always in lan | bind host non-loopback |
| accept | always in lan | `pairing.acceptLanRequests` |
| door | share, lan | derived, no saved flag: no non-loopback legacy network trust (`resolvedTrustedNetworks`; `network.trustMode=pair` once `retire-trusted-networks-bypass` lands) OR a sign-in provider enabled in `auth.providers` |
| bind | — | `reachability.resolvedBindHost` (GET /api/config) non-loopback; pending ≠ resolved → "restart pending"; pinned by `--host`/`PI_DASHBOARD_HOST` → no action, says so |
| road | device | any road up (prefer TLS) — else operator picks Wi-Fi/anywhere, which inserts lan or share steps |
| qr, approve, addr, reach, request | — | action steps; never pre-satisfied |

Runs of 2+ consecutive non-pending steps (already set OR done this run) fold into one row ("N steps already set" / "N steps done") until expanded.

Not applicable ≠ satisfied: a step that doesn't apply is omitted; a satisfied step is shown collapsed and re-openable.

## Decisions (each cites a public rule)

| Decision | Rule |
|---|---|
| Status landing first, tasks below | Nielsen #1 Visibility of system status |
| Tasks named by intent ("Share over the internet"), not subsystem ("Setup") | Nielsen #2 Match between system and the real world |
| Satisfied steps collapse with ✓ "already set · Change", never vanish | Nielsen #3 User control and freedom; NN/g "Wizards: Definition and Design Recommendations" (show progress, allow revisiting) |
| Non-applicable steps omitted | GOV.UK "Don't show users things they can't use" |
| Exposure consequence stated before the button (LAN http, public request page) | Nielsen #5 Error prevention |
| One primary action per step; Settings ▸ Network linked as expert view | Hick's Law; Von Restorff (one primary per view) |
| Loading = "Checking…", never a default rendered as fact | Nielsen #1; fixes the as-built "Off" while loading |
| State never by colour alone: dot + title text + pill word | WCAG 1.4.1 |

## Copy (en source; i18n keys under `remoteAccess.*`)

- Dialog title: "Remote access". Road rows: "This computer" / "Devices on my network" / "Internet".
- Tasks: "Share over the internet" — "A public HTTPS address for this dashboard, reachable from anywhere." · "Let a phone or laptop in" — "Pair a device with a QR code and a one-time code." · "Allow devices on my network" — "Phones and laptops on the same Wi-Fi can ask to connect." · "Connect to another machine" — "Use another computer's dashboard from here."
- Connect consequence: "**Anyone with the address reaches a sign-in / request-access page.** Nobody gets in until you approve their device or they sign in."
- LAN bind consequence: "**Devices on your Wi-Fi can open this dashboard's request page over plain http (unencrypted).** They still can't get in without your approval."
- Toolbar title: "Remote access: <state>[, N device(s) waiting]".

## Resolved

- Icon: variant A, `mdiAccessPointNetwork` + state dot + waiting badge.
- "Who may enter": derived from existing config, no new key.
- Done-this-run steps fold like already-set steps.
