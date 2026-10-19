# UI plan — add-tailscale-cert-tls

Board: `tls.html` (serve the `mockups/` dir; `index.html` redirects). Tokens: `tokens.css`, copied from `add-pi-spec-driven-schema` (byte-identical to the current `:root` / `[data-theme=light]` blocks of `packages/client/src/index.css` + nord dark from `themes.ts`; re-checked 2026-10-19). Recipes: `mockup.css` (copied from `add-remote-access-wizard` + the ToggleField recipe). As-built replica: `asbuilt.css`. Contrast/size probe: `probe.js` (inject, `__probeAll()`).

Sources (develop @ HEAD): `packages/client/src/components/Gateway/GatewayPage.tsx`, `GatewayEndpoints.tsx`, `components/connectivity/connectivity-ui.ts` (current recipe set: `severityPill`, `callout`, `BTN_*`, `INPUT`, `ROW`, `INSET`), `components/remote-access/{Landing,ra-ui}.tsx` (the newest Gateway-adjacent UI, used for its conventions), `dashboard-plugin-runtime` ToggleField.

Design Read profile: `product-ui`. Redesign mode: `preserve` for `GatewayPage` / `GatewayEndpoints` (section order, every `data-testid`, `gateway-add-https-*` stay); the TLS section is new.

## Surfaces → tokens → states

| # | Surface | States (board ids) | Tokens / recipes |
|---|---|---|---|
| A | `GatewayPage` section order | `page-outline` | unchanged except one inserted section |
| B | **Built-in HTTPS** (new `GatewayTlsSection.tsx`; listener + `Certificates` list grouped by source) | `tls-off` · `tls-checking` · `tls-gate-daemon` · `tls-gates` · `tls-issuing` · `tls-ready` · `tls-renewing` · `tls-renew-failed` · `tls-failed` · `tls-port-busy` · `tls-port-invalid` | heading = contract section heading; status = `severityPill` + MDI icon + word; switch = ToggleField; gates = `callout("warning")`; cert row = `ROW`; address + fields = `INSET` + `INPUT`; actions `BTN_SMALL` / `BTN_PRIMARY` (one primary per state); info hint = `callout("info")` |
| C | Accessible at (`GatewayEndpoints`) | `endpoints` | kind pill: contract chip (`--bg-tertiary` / `--text-primary` / `--border-secondary`), kind as a word — identity tints are reserved (`ui-contract.md` § Colour roles: orange = worktree, green = new session…); TLS → `severityPill("success")` + `mdiLockOutline` "HTTPS"; no TLS → `severityPill("warning")` + `mdiAlert` "No TLS"; copy = `BTN_ICON_GHOST` with `aria-label` |

## Status → pill → body (first match wins)

| Condition (from `/api/health.tls` detail) | Pill | Body |
|---|---|---|
| not read yet | neutral "Checking…" | "Checking…" only |
| `enabled:false` | neutral "Off" | purpose sentence + switch |
| `bound:false` with bind error | error "Stopped" | Port field `aria-invalid` + reason |
| any unmet gate | warning "Setup needed" | one callout per unmet gate, then fields |
| held cert, `lastError` | warning "On, renewal failing" | address + cert row with warning callout (`lastError` verbatim, ≤ 500 chars) + retry ETA |
| held cert | success "On" | address (+ name-only note) + cert row + fields + trust hint |
| no cert, `lastError` | error "Failed" | cert row with error callout + ETA + "Try again now" |
| no cert, requesting | info "Getting certificate…" | cert row busy, "up to 2 minutes" |

## Decisions (each cites a public rule)

| # | Decision | Rule |
|---|---|---|
| D1 | Insert between **Gateway URLs** and **Accessible at**; nothing else moves | Gestalt proximity (cause next to effect); redesign mode `preserve` |
| D2 | One switch; port + listen-address appear only when on | NN/g progressive disclosure; Hick's Law |
| D3 | Each unmet gate = its own warning callout with the exact fix: numbered admin-console steps + external link (`noopener noreferrer`, "opens in a new tab" sr text), **Use 100.83.0.1**, **Set up Tailscale above** (focuses the readiness board, same handler as `GatewayPairQR` `onSetupRequested`), **Check now** | Nielsen #9 (help users recover: say what and how); Nielsen #5 |
| D4 | Long-running issuance states its expectation ("up to 2 minutes"); busy button disabled | Nielsen #1 visibility of system status; Doherty threshold (say when > 400 ms) |
| D5 | The address is the focal result, with Copy / Open and "connect using this name — an IP won't work" | Von Restorff (one focal point); Nielsen #5 (prevents the no-SNI handshake failure, design D2) |
| D6 | Cert row: name, "Valid · N days left", renewal rule, **Renew now** / **Try again now** (operator `trigger()`, bypasses backoff) | Nielsen #3 user control; #1 |
| D7 | Trusted-network hint = info callout, never a gate | Nielsen #8 (only what matters is loud) |
| D8 | Failure with a held cert = warning (still serving); without = error. `lastError` verbatim in mono + next-retry ETA | Nielsen #9; severity by consequence |
| D9 | "Checking…" while unknown, never a default shown as fact | Nielsen #1 (Remote access convention) |
| D10 | Port errors at field level, plain words (`role=alert`, `aria-invalid`, `aria-describedby`), spanning both columns | GOV.UK error-message pattern; WCAG 3.3.1 |
| D11 | Accessible at: replace raw hex / undefined vars with the neutral chip + severity tokens, human kind labels ("MagicDNS", "Domain"), 11 px pills, lock icon + word | ui-contract § Colour roles; WCAG 1.4.1, 1.4.3; contract type floor (11 px) |
| D12 | Toggle writes immediately (`PUT /api/config {tls:{enabled}}`, reconcile, no restart); Port/Listen-on use an explicit **Apply** | Nielsen #1; matches `GatewayLanRequestPanel` (switch writes immediately) |

## Panel anatomy (source-neutral, shared with add-acme-dns01-certs)

1. Heading `Built-in HTTPS` + overall status pill.
2. Switch `Serve HTTPS on its own port` (writes immediately).
3. When on: **Address** (result: URL + Copy/Open + "connect using this name") → listener gates (`bind-reachable`) → **Port / Listen on** + Apply → **Certificates**: one group per source (`Tailscale` here; `Domain certificates` from `add-acme-dns01-certs`), each group = its source gates + one cert row per name (name · pill · facts · Renew now / Try again now) → trust hint.

Gates sit with what they block. Cert row anatomy is the same for every source, so ACME domain rows reuse it (plus their own badges: staging, not advertised, wildcard).

## Cross-change ownership (vs `add-acme-dns01-certs/mockups/gateway-tls.html`)

This board owns the panel shell (its section A): it ships first (prereq) and defines the anatomy. The ACME board keeps only its section B (Domain certificate editor, rendered inside **Certificates**) and its staging copy for Accessible at.

| Topic | ACME board (A) | This board | Resolution |
|---|---|---|---|
| Framing | source-neutral "HTTPS listener" + Certificate sources list | was tailnet-only | **adopted theirs**: heading "Built-in HTTPS", neutral switch label, Certificates grouped by source |
| Placement | after Gateway URLs, before Accessible at | same | agreed |
| Commit model | checkbox + panel Save/Cancel | switch writes immediately; Apply for port/listen-on; one-click Use-IP writes immediately | **keep this**: NN/g toggle guideline holds (effect is immediate, server reconciles live per design D7), gates show right after enabling, and a panel Save would be the 2nd Save on a page that already has a dirty-Save footer (Nielsen #4). The ACME editor keeps its own Save (a multi-field form) |
| Section heading | GatewayPage uppercase 11 px legend (copies siblings) | contract section heading (12 px, no uppercase) | **contract**: ui-contract.md is the authority; the uppercase siblings are known debt |
| Overall state | none | status pill in the heading | **keep this** (Nielsen #1) |
| Tailscale source states | Not ready / Advertised only | checking · daemon down · issuing · renewing · renew-failed (warning) · failed (error) | **keep this**; ACME domain rows reuse the same row |
| Re-issue | "Issue now" (ACME only) + route listed as ACME-owned | Renew now / Try again now / Check now on every source | **one route in the prereq**: `POST /api/tls/issue {sourceId, name?}`; ACME reuses it |
| Retry ETA | gap 1: `nextAttemptAt` | Q5: `nextAttemptAt` | **define once in the prereq** TLS status (per cert); ACME reuses |
| Domain kind pill | neutral | tint-orange, all kind pills tokenized | **theirs** after doubt review: tint-orange is the worktree identity; every kind pill is the neutral chip, the word distinguishes; all kinds still tokenized |
| Address | example URL in a sentence | Address inset with Copy / Open | **keep this** |
| Bind error | callout | Stopped pill + Port field error | **keep this** (error at the field, GOV.UK) |

## Contract checks (probe.js, 2026-10-19)

Base dark / Base light / Nord dark × 375 / 1440: 0 contrast failures, 0 size failures, 0 frame overflow, 0 console errors. Zero raw colour literals in `tls.html` (the as-built replica in `asbuilt.css` keeps them on purpose: they are the finding).

## Gaps the board exposes (need a decision before folding)

| # | Gap | Proposal |
|---|---|---|
| Q1 | Spec defines gates `https-certs`, `bind-reachable`, `no-sources`, `name-conflict`, but none for "tailscaled not running / logged out" — `tailscale cert` would just fail into `lastError` | add a `tailscale-running` gate to the tailscale source (readiness is cached; status still makes no external call) |
| Q2 | "Use 100.83.0.1" needs the node's Tailscale IPv4 in status; `details` exists only per cert, so it's missing before the first cert | add source-level `details` (non-secret) to the TLS status, tailscale fills `ipv4` |
| Q3 | **Renew now / Try again now / Check now** need an endpoint; design only has in-process `trigger()` | `POST /api/tls/issue {sourceId, name?}` — auth-gated like `PUT /api/config`, 202, joins a running issuance |
| Q4 | Retokenizing all of `GatewayEndpoints` `KIND_CLASS` (5 entries + 2 badges) is beyond task 4.6's "Domain label" | do it (file is touched; `theme-token-guard` blocks a new literal for `domain` anyway) |
| Q5 | Retry ETA ("Next try in 20 minutes") needs `nextAttemptAt` per cert | add `nextAttemptAt` to cert status |

## Copy (en source; i18n keys under `gateway.tls.*`)

- Heading "Built-in HTTPS". Lead: "Serve this dashboard over HTTPS on a second port with trusted certificates, so phones and browsers connect without warnings. Phones need HTTPS to pair and to get notifications. The main port keeps working."
- Switch "Serve HTTPS on its own port" · hint "Applies right away, no restart. Off by default."
- Pills: Off · Checking… · Setup needed · Getting certificate… · On · On, renewal failing · Failed · Stopped.
- Gate https-certs: "HTTPS certificates are off for your tailnet." + 3 steps + "Open Tailscale DNS settings" + "Checked automatically every 15 minutes. Your device name is published in public certificate logs."
- Gate bind-reachable: "Only this computer can open it. HTTPS listens on `127.0.0.1`. Listen on the Tailscale address so your other devices can reach it." → "Use 100.83.0.1".
- Name note: "Connect using this name. An IP address such as `100.83.0.1` won't work: the certificate is issued for the name."
- Trust hint: "Tailnet devices still have to pair before they get in. To skip that for your whole tailnet, add `100.64.0.0/10` as a trusted network on the Security page."
