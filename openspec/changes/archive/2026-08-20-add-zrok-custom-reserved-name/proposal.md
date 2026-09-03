# Let a user choose their own zrok reserved name, and say why it failed

## Why

A persistent zrok URL already works. What does not work is *choosing* it,
finding out when your choice was ignored, or reading the tab you choose it on.

Reported as *"I would like to make zrok use persistent URL"*, then
*"In the setup tab colors are not OK"*, then *"detect whether the service is
installed and show its status"*. On investigation these are five distinct gaps
sitting behind one surface — the Gateway Setup tab.

### Gap 1 — a custom name is reachable only by hand-editing a file

`mintReservedName(existing?)` already accepts a caller-supplied name and passes
it verbatim to `zrok create name -n public <name>`. The auto-generated
`pi-dash-<8 hex>` is only the fallback when the caller supplies nothing. The
engine is complete.

The UI is not. `GatewayDialog.tsx` ships exactly one reserved-name control:

| testid | Direction |
|---|---|
| `gateway-forget-reserved` | releases the name |
| — | *(nothing sets one)* |

`gateway-url-input` in `GatewayUrlManager.tsx` is a custom **domain** field
(`https://pi.example.com`), unrelated to the zrok namespace. So the only way to
run on `robson-home-mac` instead of `pi-dash-a3f9c012` is to hand-edit
`~/.pi/dashboard/config.json` and restart. A Forget button with no Remember
button is the whole defect in miniature.

### Gap 2 — every failure degrades to ephemeral, silently

This is the sharper half. Trace the reason as it travels up:

```
zrok create name -n public robson-home-mac
      │  stderr: name already exists (another account)
      ▼
mintReservedName()      ──▶ null          console.warn ← REASON DIES HERE
      ▼
ensureReservedName()    ──▶ undefined     (invalid-name collapses here too)
      ▼
ZrokProvider.connect()  ──▶ ProviderEndpoints    { endpoints: [...] }
      ▼
POST /api/tunnel-connect ─▶ { ok: true, url }    "success"
      ▼
TunnelStatus            ──▶ { status: "active", url }
```

Every layer reports the truth. The connect **does** succeed — an ephemeral
tunnel is a working tunnel. The problem is that `TunnelStatus` has three states:

```
active { url }  │  inactive  │  unavailable
```

and none of them can express *"active, but not at the name you asked for,
because X."* This is a **missing state**, not a missing error path. The user
sets a name, sees a green active tunnel at a URL they did not choose, and the
only record of why is a `console.warn` in the server log.

Three separate causes all funnel into that same silent fallback:

| Cause | Detected at | Currently surfaces as |
|---|---|---|
| Name taken by another account | `mintReservedName` stderr match | nothing |
| Name fails `RESERVED_NAME_RE` | `ensureReservedName` | nothing |
| `saveReservedName` write fails | `mintReservedName` | nothing |

The namespace is **global across all zrok accounts**, so "taken" is a routine
outcome for any short, desirable name — not an edge case.

### Gap 3 — the tab this lands on is unreadable in light mode

Found by probing computed styles in the running dialog, not by reading source.

`--accent` and `--accent-soft` are referenced by component code but **declared
nowhere** — not in `:root`, not in `[data-theme="light"]`:

```
rg -- "--accent-soft\s*:" packages/   →  no matches
rg -- "--accent\s*:"      packages/   →  no matches
```

Every call site therefore falls back to the literal baked into the class string.
`bg-[var(--accent-soft,#1d3a63)] text-[var(--text-primary)]` paints a dark-navy
fill in **both** themes while the text on top stays theme-aware. In light mode
that is `#1a1a1a` on `#1d3a63`.

Counted at source, and **only for the two genuinely undeclared tokens**. This
distinction is load-bearing: `--accent-blue`, `--accent-primary`, `--accent-green`
and friends *are* declared (`index.css:67-73`), so bindings against them never hit
their fallbacks and are not affected. Two earlier drafts of this proposal both got
this wrong by matching `--accent*` as a prefix.

In `packages/client/src` (excluding tests) `var(--accent[-soft])` appears **20
times across 14 files**, in two forms that fail differently:

| Form | Occ. | Files | Failure today |
|---|---|---|---|
| `var(--accent, #3b82f6)` — fallback | 11 | 7 — the 6 accent-using `Gateway/` files **+ `ProcessList.tsx`** | paints the dark-mode literal in *both* themes |
| `var(--accent)` — bare | 9 | 7, **all outside `Gateway/`** | resolves to empty string; paints nothing |

So the fallback defect is almost entirely a Gateway problem (10 of 11), with
`ProcessList.tsx` the single outside site. The bare-reference sites
(`BashOutputCard`, `ToolCallStep`×2, `FallbackPreview`×2, `SpreadsheetPreview`,
`TruncationBanner`, `ThinkingLevelSelector`, `PptxPreview`) currently paint
*nothing* and will **start** painting once the token is declared.

**The bundled plugins are also in the blast radius.** `--accent` is declared at
`:root`, so it reaches every client rendered in the same document — including
`automation-plugin` and `flows-plugin`, which carry **12 further fallback-form
occurrences across 4 files** written against *different* literals (`#6366f1`,
`#0969da`, `#f59e0b`). Declaring the token repaints those too, changing colours
the plugin authors chose deliberately. No earlier draft accounted for them.

**Declaring the token also creates two NEW AA failures.**
`SpreadsheetPreview.tsx:104` (`bg-[var(--accent)] text-white`) and
`PptxPreview.tsx:77` (`bg-[var(--accent)] text-[var(--accent-fg,#fff)]`) paint
nothing today; once `--accent` resolves they become white on `#3b82f6` — 3.68:1 in
dark. They must be repointed to `--accent-solid` in the same change, or this
change violates its own new requirement on the day it lands.

**Declaring `--accent` alone does not fix cause C.** Four sites pair it with white
text — `GatewayDialog.tsx:179,188`, `GatewayPage.tsx:140`,
`GatewayUrlManager.tsx:282` all read `bg-[var(--accent,#3b82f6)] … text-white`.
Declaring `--accent: #3b82f6` in dark leaves white-on-it at exactly the 3.68:1 this
proposal reports as a defect. Those four MUST be repointed to `--accent-solid`
(`#2563eb`, 5.17:1); a token declaration by itself is not the fix.

Measured on the running dialog under `[data-theme="light"]` — **13 of 15
controls fail**:

| Control | fg on bg | ratio |
|---|---|---|
| selected provider chip `zerotier` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| selected mode chip `Private` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| step action `Connect` / `Authenticate` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| unselected chips, inactive tabs, footer | `#aaaaaa` on `#fafafa` | **2.23:1** |
| `Open admin console` link | `#3b82f6` on `#ffffff` | **3.68:1** |
| primary `Done` — **both** themes | `#ffffff` on `#3b82f6` | **3.68:1** |

The **selected** item is the least readable element on the tab — an inverted
affordance. `disabled:opacity-50` masks it until the button becomes enabled,
which is why a source read alone does not surface it.

This is folded in rather than deferred because the reserved-name control is a
new step **on this tab**  : shipping step 3 into a surface where the selected
state measures 1.52:1 would mean building the fix and the defect in the same
place, in the same week.

The repo has met this before and under-fixed it. `shutdown-session-recovery`
bans `--accent` in one component, reasoning that an undeclared property
"resolves to the empty string and yields an unset background". That reasoning
does not cover the **fallback** form used here — `var(--accent-soft,#1d3a63)`
resolves to a very visible dark navy. Banning one token in one component cannot
address the class; declaring the tokens does.

### Gap 4 — the tab cannot tell you whether anything is installed

The same pattern as Gap 1: **the capability already exists at the seam and
nothing reaches it.** `TunnelProvider` declares three predicates, and all four
providers implement all three:

```
detectBinary()    → binary present on PATH (shared ToolResolver)
isEnrolled()      → zrok env | ngrok authtoken | tailscale logged-in | zt authorized
status().active   → at least one endpoint currently reachable
```

Which composes into the four states directly, with no new detection logic:

```
detectBinary()  false ─────────────────▶  not installed
        true → isEnrolled()  false ───────▶  not set
              true → status().active false ▶  disconnected
                          true ────────────▶  connected
```

`detectBinary` and `isEnrolled` have exactly one consumer — `tunnel-core.ts:186,190`
uses them as **connect-time preconditions**, not as a reportable state. Nothing
surfaces them. So the provider chips in `GatewayProviderSection.tsx` render from a
hardcoded static list and look identical whether a provider is installed or absent.
The tab offers a fixed step list regardless of what is already done.

(Note on `isEnrolled` for daemon providers: tailscale implements it as
`BackendState === "Running"` — a live daemon query — so for daemons "not set up"
and "daemon down" are not cleanly separable by that predicate alone.)

Detection of an install performed **outside** the dashboard is likewise already
solved: the tool registry caches resolutions but ships `rescan(name)` — *"Drop
cached Resolution(s). Next resolve() re-runs strategies."*

### Gap 5 — only one tunnel can be live

`add-tunnel-providers` built the seam and four implementations, but the
top-level module was never wired to it. `tunnel.ts` remains *"a thin delegation
layer over `tunnel-core.ts` + `tunnel-providers/zrok.ts"*:

```
getTunnelUrl()  →  zrokRuntime.getTunnelUrl()               ← zrok, literally
ChildTunnelRuntime:  private activeTunnelUrl: string|null   ← ONE url per runtime
```

So running zrok and tailscale together is not a config change — it is finishing
an abstraction that only half-landed.

The sharp edge is **not** the plumbing. `getTunnelUrl()` feeds
`buildRedirectUri()`, and `resolveRedirectBase()`'s own docstring
(`packages/server/src/auth/auth.ts`) states the invariant plainly: it is *"the
single resolution both `buildRedirectUri` and the session-cookie `Secure` flag
derive from, so the minted URI and the cookie can never describe different
origins."* The `oauth-authentication` spec encodes the same thing across its
redirect-URI-resolution and cookie-`Secure` requirements, though not in those
words. With N tunnels there is no longer an obvious single base —
opening the dashboard over tailscale while the redirect was minted for zrok is
exactly the mismatch that sentence exists to prevent.

**The primary-provider model resolves this without touching the auth spec.**
`tunnel.provider` is retained and simply *means* the primary; additional
providers opt in via `tunnel.<id>.enabled`. `getTunnelUrl()` returns the
primary's URL, so every existing OAuth and cookie scenario stays true verbatim
and the legacy-config migration is untouched. CORS widens to all live origins
(read-authority for an origin already in the address bar) while the redirect
base stays pinned to the primary — the two answer different questions.

Net effect: concurrency leaves the **auth** requirements untouched. It does not
leave the change MODIFIED-free — an earlier draft claimed that and adversarial
review disproved it at source:

- **`tunnel-provider` → "Provider and mode selection" requires a MODIFIED block.**
  `config.tunnel.mode` is a single field (`config.ts:315`) and `PROVIDER_MODES`
  makes zerotier private-only while zrok and ngrok are public-only. `zrok` primary
  with `zerotier` also enabled is therefore **inexpressible** under one shared
  mode. Concurrency needs `tunnel.<id>.mode`, which changes that requirement.
- **`server-cors` does not need one, but only after a carve-out.** The shipped
  spec allows *any* `*.share.zrok.io` / `*.shares.zrok.io` host with no tunnel at
  all (`cors-origin.ts:58`), so "a disconnected provider's origin stops being
  allowed" is unsatisfiable for zrok. Rather than narrow a shipped allowance,
  the new requirement is scoped to providers with no standing wildcard and the
  zrok carve-out is stated explicitly.

What still holds is the part that matters most: because `getTunnelUrl()` returns
the primary's URL, **no OAuth, cookie or redirect requirement is modified**. Those
carry twelve scenarios between them (nine on redirect-URI resolution, three on the
cookie `Secure` flag) and a MODIFIED block must reproduce every one.

## What Changes

Reserving a name and connecting a tunnel are different user intents. zrok
already separates them (`create name` is a distinct call from `share`); this
change stops the UI from collapsing them.

- **Add a reserved-name input to the Gateway dialog.** Sets, changes and clears
  `tunnel.zrok.reservedName`, and sets `persistent: true` on save — so
  persistence is switchable from the UI instead of only being a side effect of
  a successful auto-mint.
- **Validate at name-set time, not connect time.** New endpoint attempts the
  reservation while the user is still looking at the input, and returns a
  typed outcome (`ok` / `taken` / `invalid` / `write-failed`) rather than a
  bare `null`. Client mirrors `RESERVED_NAME_RE` for instant inline feedback
  before the round trip.
- **Release the previous name when the name changes.** `saveReservedName`
  currently overwrites `reservedName` and leaves the old reservation alive on
  the account; only the `forget` path calls `delete name`. Changing a name will
  release the old one, so repeated edits cannot silently accumulate orphaned
  reservations against the account's limit.
- **Add a thin degraded-state banner as a safety net.** Name-set-time validation
  cannot cover a name released or hijacked *between* set and connect. When a
  connect falls back despite a stored name, surface it — a warning banner
  keyed off the stored-vs-effective name, not a full `Result` refactor of the
  provider seam.
- **Declare the accent ramp in both theme scopes** — `--accent` (border / ring),
  `--accent-soft` (soft fill behind `--text-primary`), `--accent-solid` (solid
  fill behind white) and `--accent-text` (link text). Causes A and C need **no
  component change**: the existing `var(--accent-soft, …)` call sites simply stop
  hitting their fallback.

  | Token | Dark | Light | Role | Floor |
  |---|---|---|---|---|
  | `--accent` | `#3b82f6` | `#2563eb` | border, ring, focus | 3:1 non-text ✓ |
  | `--accent-soft` | `#1d3a63` | `#dbeafe` | fill behind `--text-primary` | 9.07 / 14.27 ✓ |
  | `--accent-solid` | `#2563eb` | `#2563eb` | fill behind white | 5.17 ✓ |
  | `--accent-text` | `#60a5fa` | `#1d4ed8` | link text on page bg | 7.79 / 6.70 ✓ |

  Dark mode is not exempt: white on `--accent-primary #3b82f6` measures 3.68:1 in
  **both** themes, so `--accent-solid` is `#2563eb` in dark too.
- **Raise the Gateway's muted text to a passing token.** `--text-muted` measures
  2.04–2.78:1 on every surface in both themes and currently carries the Setup
  tab's hints, step numbers, chips, inactive tabs and footer actions.
- **Guard the class, not just the instance.** A check SHALL reject any
  `var(--token, <literal>)` fallback used for a themed paint, so the next
  undeclared token fails loudly instead of silently painting one theme's literal
  into every theme.
- **Pin the stderr classification with a test.** The taken-by-another branch is
  a regex over zrok's stderr:
  `/already exist/i.test(msg) && !/another|different account|owned by/i.test(msg)`.
  It is load-bearing the moment a reason is shown to a user, and a zrok CLI
  wording change would silently reclassify "taken by someone else" as "reuse
  mine". Pin against captured real output, and default to an honest-but-vague
  message when neither branch matches.
- **Expose per-provider readiness.** One endpoint returning the four-state
  readiness for every known provider, derived from the three predicates that
  already ship — no new detection logic. `rescan` is invoked before
  `detectBinary()` so an install done in a terminal is seen without a restart.
  A throwing predicate degrades only its own provider.
- **Drive Setup content from readiness.** Steps already satisfied render as
  satisfied instead of as outstanding work; the outstanding action for a
  provider follows from its state. State carries a text label, never colour
  alone.
- **Poll every 5s while the dialog is open**, once immediately on open, stopped
  on close, with overlapping ticks suppressed and a manual refresh control.
  Readiness shells out per provider, so it must not run unconditionally in the
  background.
- **Allow concurrent tunnels with an explicit primary.** `tunnel.provider`
  becomes the primary; extras opt in via `tunnel.<id>.enabled`. Each provider
  gets its own runtime, PID file and watchdog so one recycle cannot disturb
  another. `getTunnelUrl()` returns the primary's URL; non-primary tunnels are
  additional reachable URLs that never mint OAuth redirect URIs.
- **Widen CORS to every live tunnel origin**, and only while connected — a
  disconnected provider's origin stops being allowed.

### Why validate at set time rather than at connect time

The alternative — plumb `Result<name, reason>` up through `ensureReservedName`,
`ZrokProvider.connect`, the route and `TunnelStatus`, and add a fourth
`degraded` state — was considered and rejected as the primary mechanism:

- Feedback would arrive during a connect flow, detached from the input that
  caused it.
- It touches the shared provider seam that every provider implements, for a
  zrok-only concern.
- The watchdog recycles the tunnel on a timer, so each recycle would re-run the
  fallback and require repeat-notification suppression.

Set-time validation exposes a seam that already exists. The degraded banner
retains the useful half of the rejected option at a fraction of its cost.

## Impact

- `packages/server/src/tunnel-providers/zrok.ts` — typed outcome from
  `mintReservedName`; release-old-name on change; pinned stderr classification
- `packages/server/src/routes/system-routes.ts` — reserved-name set/clear
  endpoint alongside the existing `tunnel-connect` / `tunnel-disconnect`
- `packages/shared/src/rest-api.ts` — reserved-name outcome type; degraded
  signal on `TunnelStatus`
- `packages/client/src/components/Gateway/GatewayDialog.tsx` — the input,
  inline validation, and the degraded banner
- `packages/client/src/index.css` — the accent ramp, declared in `:root` and
  `[data-theme="light"]`
- `packages/client/src/components/Gateway/` — `GatewayProviderSection.tsx`,
  `GatewaySetupGuide.tsx`, `GatewayUrlManager.tsx`, `GatewayPage.tsx`,
  `GatewayPairQR.tsx`: drop the inline fallback literals, raise `--text-muted`
  to a passing token
- `packages/client/src/components/terminal/ProcessList.tsx` — the one
  non-Gateway `var(--accent, …)` call site
- `packages/server/src/tunnel/tunnel.ts` — replace zrok-hardcoded delegation
  with a per-provider runtime registry; `getTunnelUrl()` resolves the primary
- `packages/server/src/tunnel/tunnel-core.ts` — one runtime instance, PID file
  and watchdog per provider
- `packages/server/src/auth/cors-origin.ts` — compare against every live tunnel
  origin, not a single URL
- `packages/client/src/components/Gateway/GatewayProviderSection.tsx`,
  `GatewaySetupGuide.tsx` — readiness badges, state-driven steps, refresh
  control, 5s poll bound to dialog lifetime
- `packages/shared/src/config.ts` — `tunnel.<id>.enabled`; `tunnel.provider`
  retained as the primary selector so legacy migration is untouched
- Specs: `zrok-tunnel` (reserved-name lifecycle + failure reporting),
  `theme-system` (accent ramp + no-fallback-literal rule),
  `tunnel-provider` (readiness taxonomy, refresh, poll, concurrency + primary),
  `server-cors` (all live tunnel origins allowed)
- Tests: `zrok.ts` unit tests for each outcome and for release-on-change;
  `tunnel-config-migration` for the persistence toggle; Gateway component tests;
  a readiness truth-table test per provider (including the throwing-predicate
  and stale-cache cases); a two-tunnel test asserting the redirect URI derives
  from the primary only; a CORS test that a disconnected origin stops being
  allowed
- New UI strings go through `t(...)` like the existing
  `gateway.forgetReserved`.
- No change to the ephemeral path. The watchdog becomes per-provider, and every
  provider is now read for readiness — earlier drafts of this proposal scoped
  those out, which Gaps 4–5 supersede.

### Deliberately out of scope

- **Flipping `persistent` to default `true`.** That is a behavior change for
  every existing install and deserves its own proposal. This change only makes
  the existing opt-in reachable.
- **A repo-wide `--text-muted` audit.** `--text-muted` fails AA on every surface
  in both themes, well beyond the Gateway. This change repairs the Gateway
  surface it is shipping into and adds the guard that catches the class; it does
  not sweep the rest of the client, which would turn a scoped change into an
  untestable repo-wide reflow.
- **Checking name availability without reserving it.** zrok exposes no
  dry-run; attempting the reservation *is* the check. A name the user sets is
  therefore a name they now hold.
- **The legacy v1 `reservedToken`.** Still preserved for downgrade, still
  ignored by the v2 provider. Untouched here.
- **Auto-promoting a primary.** If the configured primary is not connected, the
  redirect base falls back exactly as today. Silently promoting some other live
  tunnel to mint OAuth URIs would move the auth origin without the user asking.
- **Readiness polling outside the Gateway dialog.** No background evaluation, no
  push channel; readiness costs subprocesses and is only needed while someone is
  looking at it.

## Discipline Skills

- `security-hardening` — a config-sourced string reaches `execFileSync` argv;
  additionally the CORS allowlist widens to N origins and the OAuth redirect
  base gains a selection rule. Both are authorization-adjacent.
- `performance-optimization` — a 5s poll spawning ~4 subprocesses per tick is a
  recurring cost on an interactive surface; measure a tick before accepting the
  cadence.
  `RESERVED_NAME_RE` (no leading hyphen, so an option-like value cannot reach
  argv) is the existing guard; this change adds a *user-supplied* path into it
  and must not weaken it.
- `doubt-driven-review` — releasing the old name on change is irreversible and
  destroys a URL a user may have shared. Stress-test that before it stands.
- `observability-instrumentation` — the whole point is replacing a
  `console.warn` with a surfaced reason; the new endpoint needs to be
  diagnosable when it misclassifies.
- `review-code` — server, shared types, theme layer and client in one change.
- `doubt-driven-review` (second trigger) — declaring `--accent` / `--accent-soft`
  changes the paint of **20 occurrences across 14 client files at once**, plus
  **12 more across 4 bundled-plugin files**. 11 are the fallback form (10 in
  `Gateway/`, plus `ProcessList.tsx`) and flip from the dark-navy literal to a
  theme value; 9 are bare references in 7 non-Gateway files that currently paint
  **nothing** and will start painting; the plugin sites were written against
  entirely different literals. Verify no surface depended on the dark-navy
  fallback, the unset paint, or the plugin literals before it stands.
