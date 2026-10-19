# UI plan — add-acme-dns01-certs

Board: `gateway-tls.html` (serve the `mockups/` dir; `?theme=base-dark|base-light|nord-dark`, `?width=375|768|1440`).
Shared assets come from the prereq board `add-tailscale-cert-tls/mockups/` so the two boards render identically:
`mockup.css` (copied verbatim, incl. ToggleField), `probe.js` (copied verbatim), shell recipes (`.sec-title`, `.src`, `.src-h`, `.cert`, `.addr`, `.ep`, `.pill.k-*`) copied into the board `<style>`.
`tokens.css` = current `packages/client/src/index.css` `:root` + `[data-theme=light]` + nord dark (one extra `:root { --composer-lifecycle-w }` block vs the prereq copy; no colour difference).
`icons.js` = generated from `@mdi/js`, a superset of the prereq icon names.

Design Read profile: `product-ui`. Redesign mode: `preserve`. This change adds a source group to an existing list; it does not add a section.

## Ownership (agreed with `add-tailscale-cert-tls`, see its ui-plan "Cross-change ownership")

| Owned by `add-tailscale-cert-tls` (`tls.html`) | Owned here (`gateway-tls.html`) |
|---|---|
| Section "Built-in HTTPS": heading + status pill, switch (writes immediately), Address, Port / Listen on + Apply, listener gates, the **Certificates** list, Tailscale group, shared cert row (name · facts · pill · Renew now / Try again now), trust hint | **Domain certificates** source group inside Certificates, its gates, row badges + stage steps, the "Add domain certificate" button + editor (own Save), the staging note in Accessible at |
| Accessible at restyle; every kind pill (incl. `Domain`) = neutral chip with a word label | — |
| API: `POST /api/tls/issue {sourceId, name?}` (auth-gated, 202, joins a running issuance); per-cert `nextAttemptAt`; source-level `details` in `/api/health.tls` | API: `PUT`/`DELETE /api/tls/acme/:sourceId` (per entry) and `PUT /api/tls/acme/:sourceId/credentials` (vault manage guard `canManageVault`), `operate` rows in `route-tiers.ts`; check time in source `details`; save order. Client: `registerTlsSourceGroup("acme", GatewayAcmeSource)` |

My earlier section A (listener panel with checkbox + panel Save, uppercase legend, ACME-only "Issue now") is **withdrawn**. The prereq's choices win for the reasons in its decision table (NN/g toggle guideline + live reconcile, one Save per page area, contract heading). The Domain pill went tint-orange for one round and is back to the neutral chip (prereq doubt review: tint-orange is the worktree identity, `ui-contract.md` § Colour roles).

## Surfaces → tokens → states

| # | Surface (target source) | States (board ids) | Tokens / recipes |
|---|---|---|---|
| A | Shell context only (replica of `tls.html#tls-ready`) | `shell-context` | prereq recipes, unchanged |
| B | **Domain certificates** group — new `GatewayAcmeSource.tsx`, rendered by the prereq's Certificates list | `acme-add-cloudflare` (B1) · `acme-add-errors` (B2) · `acme-needs-credentials` (B3) · `acme-cname-missing` (B4) · `acme-issuing` (B5) · `acme-staging-done` (B6) · `acme-switch-production` (B7) · `acme-production` (B8) · `acme-failures` (B9) · `acme-other-ca` (B10) | group = `.src`; rows = prereq cert row + `.badges` (warning `Staging · browsers warn`, neutral `Not advertised`, neutral `Wildcard · served, not listed`) + `ol.steps` (`aria-current="step"`); gates = `callout warning|error`; editor = `.src` + radio cards (`--tint-blue-border` selected) + `.netrow`/`.add-row` + write-only password input |
| C | Accessible at (`GatewayEndpoints.tsx`, restyled by prereq) | `endpoints-staging` (C1) · `endpoints-production` (C2) | prereq `.ep` + `pill kind` (neutral chip, word label); staging note = `p-meta` + info icon |

## Status → group pill (first match wins)

| Condition (`/api/health.tls`, this source's gates + certs) | Group pill | Row |
|---|---|---|
| unmet `credentials` gate | error "Failing" if the token was rejected, else warning "Setup needed" | group gate + token field; rows "No certificate yet." |
| any unmet name-scoped gate (CNAME) | warning "Setup needed" | gate callout full-width under that row, record + Copy + **Check now** + check time |
| any cert `stage ≠ idle` | info "Getting certificates…" | row pill "Requesting…", steps, button "Working…" disabled |
| any cert with `lastError` | error "Failing" | prereq anatomy: held → warning callout "still served", none → error callout; both with `nextAttemptAt` ETA |
| all held, `staging: true` | warning "Staging only" | badges + info callout "Switch to production" |
| all held, advertisable | success "On" | prereq anatomy |

## Decisions (each cites a public rule)

| # | Decision | Rule |
|---|---|---|
| D1 | Domain certificates are one more source group inside the prereq's Certificates list, not a section | Gestalt common region; one place for every certificate (Nielsen #4) |
| D2 | Rows reuse the prereq cert row; this change only adds badges + stage steps | Nielsen #4 consistency; Jakob's Law |
| D3 | Row action = prereq **Renew now / Try again now** via `POST /api/tls/issue {sourceId:"home", name}`; no ACME-only "Issue now" | Nielsen #4; one API for one verb |
| D4 | The editor is a multi-field form with its own Save + Cancel (unlike the switch) | NN/g toggle guideline does not apply to forms; GOV.UK question pages |
| D5 | Staging is the preselected card with "Start here"; switching to production shows the consequence inline before Save, no modal | Nielsen #5; NN/g confirmation dialogs (reversible → no modal) |
| D6 | Secrets are write-only: status word (Saved on this computer / Not set / Rejected by Cloudflare), input always empty | OWASP ASVS V8; spec "Solver credential storage" |
| D7 | Save disabled until the terms are accepted, reason beside it (`aria-describedby`) | GOV.UK "avoid disabled buttons" mitigation; spec "Terms not accepted" |
| D8 | CNAME gate under the blocked row: exact record, Copy, **Check now** (same label as prereq gates), "Checked N minutes ago" | Nielsen #6 recognition over recall; #1 visibility |
| D9 | Certificate Transparency disclosure before the first save | Nielsen #1; privacy by default |
| D10 | Wildcards: badge "served, not listed" instead of silently missing from Accessible at | Nielsen #1; spec non-goal (wildcards never advertised) |
| D11 | Other CA: "Advertise to paired devices" is an opt-in checkbox with the trust condition in words | spec "Custom directory not advertised by default" |
| D12 | Field errors at the field, plain words (`role=alert`, `aria-invalid`, `aria-describedby`) | GOV.UK error messages; WCAG 3.3.1 |

## Contract checks (prereq `probe.js`, 2026-10-19)

Base dark / Base light / Nord dark × 375 / 1440: 0 contrast failures, 0 size failures, 0 frame overflow, 0 console errors. Zero raw colour literals in `gateway-tls.html`. Only target < 32 px: the inline Subscriber Agreement link inside a sentence (WCAG 2.5.8 inline exception).

## Gaps

Status 2026-10-19 (recheck): prereq adopted G1 + G6 (per-name status incl. names being issued, `nextAttemptAt`, source-level `details`, `POST /api/tls/issue` with forced readiness refresh). G2 declined implicitly (`Gate` unchanged) → ACME uses source `details` `checkedAt:<domain>`. G4 dropped: Check now = `POST /api/tls/issue`. ACME write route authorized like `PUT /api/config` + `route-tiers.ts` row (G7).

| # | Gap | Owner | Resolution |
|---|---|---|---|
| G1 | Retry ETA ("Next try in 52 minutes") | prereq | use prereq per-cert `nextAttemptAt`; ACME defines nothing of its own |
| G2 | "Checked 2 minutes ago" on the CNAME gate | here | **Resolved:** source-level `details` `checkedAt:<domain>` (ISO). Earlier request to prereq (not adopted): allow an optional `checkedAt` on `Gate` (your https-certs gate copy "Checked automatically every 15 minutes" could show it too). If you'd rather not, ACME puts it in source-level `details` keyed by domain |
| G3 | New-source save order | here | `PUT /api/tls/acme/:sourceId` (one entry) → `PUT /api/tls/acme/:sourceId/credentials`; if the second call fails the source stays saved and the group shows B3 with the error |
| G4 | DNS **Check now** route | prereq | **Resolved:** no ACME route; Check now calls `POST /api/tls/issue {sourceId, name}` (forced refresh). ACME `obtain()` fails before `createOrder` while the gate is unmet, so no CA order is spent |
| G5 | "Issue now" route | prereq | **drop** `POST /api/tls/acme/:sourceId/issue` from ACME design D5 / task 4.3; use `POST /api/tls/issue {sourceId, name?}` |
| G6 | Status for names with no certificate yet (B3, B5 queued, B9 wildcard) | prereq | prereq spec says "per held certificate"; `tls.html#tls-failed` already renders a not-held entry. **Request:** reword to "per certificate name (held or being obtained)" so first-issuance failures and queued names have status |
| G7 | Route tiers | both | Every `/api/*` route needs a row in `packages/shared/src/route-tiers.ts` (completeness test fails otherwise). ACME: `PUT /api/tls/acme/:sourceId/credentials` → `operate` (task 2.2). **Note for prereq:** `POST /api/tls/issue` needs its row too; its tasks don't mention it |

## Doubt-review fold-back (plan-proposal, 2026-10-19)

- Secrets: credential vault, kind `tls-solver`, namespace `tls:<id>` → copy "Saved in the credential vault"; Cloudflare optional zone id field; token scope copy (DNS:Edit + Zone:Read unless zone id).
- acme-dns editor: `Full domain` field added (`fulldomain` config).
- `id` read-only after first save (rename = remove + add).
- Stage steps start with `order` (Create order).
- B9: Let's Encrypt failed-validation warning beside Try again now.
- Writes: `PUT`/`DELETE /api/tls/acme/:sourceId` per entry (no whole-array save).

## Coordination #2 — prereq extension points (2026-10-19)

Aligned (design Context, D1, D2, D4, D5, D8–D12; spec; tasks 1.1, 1.4, 2.5, 3.2, 3.3, 4.1–4.3, 5.2; test-plan E10, E15, E16, E29, X9):
- `acme` registers via `registerCertSourceType`; common id rule is the prereq's. `validate()` checks a normalized copy; only the editor route stores the normalized entry.
- `names()` never `null` for acme. Fingerprint = canonical directory + effective advertise + name.
- Gate-before-obtain and the 15-min re-check are the prereq's; ACME only reports gates.
- Generic `attemptTimeoutMs` is the backstop; the inner 10-min deadline stays because `obtain()` gets no abort signal.
- Instances are rebuilt on reconcile → the acme-dns lock is module-level, keyed `(server, subdomain)`.
- GC runs from `onReconciled()`, `onRemoved()` and once at type registration.
- Group via `registerTlsSourceGroup("acme", …)`; unknown stages → "Working…".
- `tls.host` default `127.0.0.1` → L3 harness sets it. Neutral Domain chip. Copy: pairing only; this board never said "sign in".

Disagreements / requests (design D12):
- **R1 (needed):** status reads the manager's last readiness result and never calls `source.readiness()`. ACME's unforced `readiness()` re-runs checks older than 5 min (so the 15-min re-check picks up a fixed CNAME); if status called it, status polling would make DNS/Cloudflare calls.
- **R2 (optional):** an `AbortSignal` argument on `obtain()` would let ACME drop its inner deadline.
- **Fingerprint example:** prereq D3's ACME example lists "solver". ACME leaves it out on purpose: the solver doesn't change the certificate, and a solver switch would re-issue every name (Let's Encrypt duplicate-certificate limit). The prereq's normative rule is met either way; suggest dropping "solver" from the example.
