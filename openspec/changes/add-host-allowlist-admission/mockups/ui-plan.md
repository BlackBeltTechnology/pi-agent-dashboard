# Host gate surfaces — UI plan

Change: `add-host-allowlist-admission`. Three operator surfaces, one shared
vocabulary: **admitted hostname** (a `Host` the dashboard will answer on) and
its **source** (why it is admitted).

Mockups: `security-allowed-hosts.html`, `refused-403.html`, `gateway-row.html`.
Tokens: `tokens.css` is a verbatim copy of `:root` + `[data-theme="light"]`
from `packages/client/src/index.css` — no mockup-only values.

## Surfaces

| # | Surface | Where | States |
|---|---|---|---|
| 1 | **Allowed hostnames** section | Settings ▸ Security, between *Trusted networks* and *Pair a device* | mode `report` · mode `enforce` · derived list (8 source kinds, server-derived via `GET /api/host-gate`) · extras empty / filled / invalid entry · recent would-refuse list empty / filled |
| 2 | **Refused** page | Any browser navigation that the gate refuses (HTML `Accept`) — JSON body stays for `fetch` | enforce refusal · (report mode never renders it) |
| 3 | Gateway URL row hint | Gateway page + setup guide `GatewayUrlManager` row | admitted-by-gate pill on every row (derived from `publicBaseUrls`, so always true for a gateway URL) |

## Surface 1 — Allowed hostnames

**Layout** (top → bottom). Mirrors the `Section` shape (`text-sm font-semibold`
title, `border-b`, `space-y-3` body) and the field contract of the
Authentication section (label `text-xs font-medium --text-secondary`,
hint in `--text-tertiary` in parentheses).

1. **Mode control** — segmented `report` / `enforce` (same shape as
   `GatewayProviderSection` mode control). Persisted in `config.json` as
   `hostGate.mode`; `PI_DASHBOARD_HOST_GATE` env var, when set, **overrides** and
   the control renders disabled with the reason "set by environment
   PI_DASHBOARD_HOST_GATE" (visibility of system status, NN/g #1).
   - Beside it, one status sentence: *report* → "Refusals are logged only —
     grep `server.log` for `[host-gate] would-refuse`." *enforce* → "Requests
     with an unlisted Host get 403."
   - Switching to `enforce` does NOT use `window.confirm` — the consequence is
     stated inline under the control before commit (repo rule from
     `GatewayProviderActions`; NN/g error prevention #5).
2. **Currently admitted** — read-only list, one row per hostname, each with a
   **source pill**: `loopback` · `IP address` · `bind address` · `.local` ·
   `public base URL` · `CORS origin` · `live tunnel` · `allowed host`. Rows
   grouped by source, source order fixed as above (recognition over recall,
   NN/g #6; Gestalt common region for the group). Pill uses
   `--severity-neutral-*`; `live tunnel` uses `--severity-info-*` because it
   is transient.
   - The `loopback`, `IP address` and `.local` rows are **patterns** (`localhost / 127.0.0.1 / ::1`,
     `any IP address`, `*.local`) — not enumerated. The list is the endpoint's
     `admitted[]`; the client never re-derives admission.
   - Each derived row has a right-aligned "Edit in ▸ Gateway / Trusted
     networks" link, not an inline remove: the source of truth is elsewhere
     (D2 derive, no duplication).
3. **Additional hostnames** — `textarea`, one per line, monospace, same class
   string as *Allowed Users*. Edits the panel draft's `allowedHosts` (saved by the panel Save). Inline validation on blur:
   an entry with a scheme, port, or path, or one failing the gate's own
   hostname regex (shared from `packages/shared`), is rejected with the exact fix
   ("`https://dash.home.arpa:9443/` → `dash.home.arpa`"), `--severity-error-fg`
   (GOV.UK error message pattern: say what is wrong and how to fix it).
   - Helper: "For names not already covered above — reverse-proxy names,
     `*.home.arpa`. A public base URL's host never needs to be repeated here."
4. **Recent refusals** — last N distinct `Host` values the gate refused or
   would-refuse (the server's refusal ring, `GET /api/host-gate` `recent[]`;
   counts every refusal, hostname without port). Each row: hostname · count ·
   last seen · outcome pill per entry (`would-refuse` warning / `refused`
   error) · **Allow** button that appends to the draft `allowedHosts` (one
   click; the row hides and the name shows in *Additional hostnames*; the
   panel Save persists it — no side write, so a later Save cannot clobber it).
   Empty state: "No refusals since start." This list is what makes report
   mode actionable: the operator sees exactly which names will break before
   flipping to enforce (NN/g #1, #9).

**Copy rules.** No em-dashes in body copy except the existing repo pattern
`Incomplete — …` for status pills. Hostnames real-looking but not real:
`pi.example.com`, `dash.home.arpa`, `mac.local`, `rebind.example`.

## Surface 2 — Refused page

Rendered only for `enforce` refusals where the request accepts HTML. Plain,
no dashboard chrome (the client bundle is what a rebinding page would try to
load; serving it here would be self-defeating). Content:

- H1 "This address is not allowed" · one sentence: the dashboard received
  `Host: rebind.example:8000`, which is not in its allowed hostnames.
- **Three ways in**, in order of likelihood: open `http://localhost:<port>`
  (the page never enumerates admitted hosts, tunnel origins or bind addresses:
  a rebinding page is same-origin with this 403 and can read its body);
  add the name under Settings ▸ Security ▸ Allowed hostnames (`allowedHosts`);
  or add it as a gateway URL (`publicBaseUrls`).
- Footer line: `error: host_not_allowed` plus the exact env var / config keys,
  monospace, for the operator who lands here from a proxy.
- No external links, no JS. Received Host is HTML-escaped. Inline CSS with a
  two-scheme palette copied from the tokens, switched by `prefers-color-scheme`
  (no `data-theme` without JS).

## Surface 3 — Gateway row hint

`GatewayUrlManager` row gains a pill after the status pill: **"Host admitted"**
(`--severity-success-fg`, same `text-[9.5px]` size as the status pill) with
`title="pi.example.com is an allowed Host because it is a gateway URL"`. Never
a button, never removable here. Purpose: when the operator later reads the
Security section, the same vocabulary appears on the row (consistency, NN/g #4).

## States → tokens

| State | Token |
|---|---|
| `report` mode sentence | `--severity-warning-fg` |
| `enforce` mode sentence | `--severity-success-fg` |
| would-refuse pill | `--severity-warning-{bg,fg,border}` |
| refused pill | `--severity-error-{bg,fg,border}` |
| source pill (static sources) | `--severity-neutral-{bg,fg,border}` |
| source pill `live tunnel` | `--severity-info-{bg,fg,border}` |
| invalid extra entry | `--severity-error-fg`, border `--severity-error-border` |
| env-override disabled control | `--text-muted`, `--bg-tertiary` |
| focus | `--focus-ring` |

## Cited rules

- NN/g heuristics #1 (status), #4 (consistency), #5 (error prevention), #6 (recognition), #9 (recover from errors).
- GOV.UK error message pattern (say what happened + how to fix, in the field).
- Laws of UX: Hick's Law (two modes, not three), Jakob's Law (segmented control shape reused from Gateway).
- WCAG 2.2: 1.4.3 contrast, 2.4.7 focus visible, 1.4.1 color not sole channel (pills carry text), 2.5.8 target size (Allow button ≥ 24px, mode control ≥ 32px).
