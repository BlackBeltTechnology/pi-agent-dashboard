## Context

Five gaps land on one surface, the Gateway Setup tab. They are grouped because
they are not independent: Gap 1 adds a control to a tab that Gap 3 shows is
unreadable, and Gap 4's readiness board is the surface Gap 5's concurrency needs
in order to be operable at all. Splitting them would mean building a control
into a broken tab, or shipping N concurrent tunnels with no way to see them.

Three facts about the current code shape every decision below.

**The engine is complete; the surface is not.** `mintReservedName(existing?)`
already forwards a caller-supplied name to `zrok create name -n public <name>`.
`TunnelProvider` already declares `detectBinary()`, `isEnrolled()` and
`status()`, and all four providers implement all three. Neither has a caller
that reaches it from the UI. Most of this change is wiring, not invention.

**One abstraction only half-landed.** `add-tunnel-providers` built the provider
seam, but `tunnel.ts` still delegates to zrok by name (`getTunnelUrl()` →
`zrokRuntime.getTunnelUrl()`) and `ChildTunnelRuntime` caches a single
`tunnelUrl`. Concurrency is finishing that abstraction, not loosening a config
field.

**One invariant constrains the whole of Gap 5.** `oauth-authentication` states
that `resolveRedirectBase()` is *"the single resolution both `buildRedirectUri`
and the session-cookie `Secure` flag derive from, so the minted URI and the
cookie can never describe different origins."* Any design that yields N base
URLs breaks it.

Constraints carried in: the zrok namespace is global across accounts, so
collisions are routine, not exceptional; zrok exposes no availability dry-run,
so attempting a reservation *is* the check; readiness costs a subprocess per
provider per evaluation.

## Goals / Non-Goals

**Goals:**

- Make an already-supported capability (a chosen reserved name) reachable
  without hand-editing `config.json`.
- Convert every silent degrade into a stated reason, at the moment and place the
  user can act on it.
- Make the Gateway Setup tab readable in both themes, and make the *class* of
  defect that broke it fail loudly next time.
- Show what is installed, enrolled and connected, per provider, including
  changes made outside the dashboard.
- Run several tunnels at once without disturbing the OAuth/cookie origin
  invariant.

**Non-Goals:**

- Changing the default of `persistent`. This change makes the existing opt-in
  reachable; flipping the default is a behaviour change for every install.
- A repo-wide `--text-muted` audit. This change repairs the surface it ships
  into and adds the guard that catches the class.
- Availability checking without reserving. No dry-run exists; a name the user
  sets is a name they now hold.
- Auto-promoting a primary when the configured one is down.
- Readiness evaluation outside the Gateway dialog.

## Decisions

### D1 — Validate the reserved name at set time, via a dedicated endpoint

A new endpoint attempts the reservation while the user is still looking at the
input and returns a typed outcome — `ok` / `taken` / `invalid` / `write-failed`
— instead of the current bare `null`.

*Alternative rejected:* plumb `Result<name, reason>` up through
`ensureReservedName` → `ZrokProvider.connect()` → route → `TunnelStatus`, adding
a fourth `degraded` state. Rejected on three counts: the feedback would arrive
during a connect flow, detached from the input that caused it; it modifies the
shared provider seam that all four providers implement for a zrok-only concern;
and the watchdog recycles on a timer, so every recycle would re-run the fallback
and require repeat-notification suppression.

Set-time validation uses a seam that already exists. The cost is that it cannot
cover the window between set and connect — which D2 covers.

### D2 — The degraded banner is a reconciliation, not a new state machine

`TunnelStatus` stays `active | inactive | unavailable`. The banner is derived by
comparing the **stored** `tunnel.zrok.reservedName` against the **effective**
name in the live URL. A mismatch while active means the connect fell back.

This deliberately keeps the missing-state problem out of the shared type. It
covers exactly the residue D1 cannot: a name released or hijacked between set
and connect. Warning severity, not error — the tunnel works, just not at the
requested name.

### D3 — `tunnel.provider` is retained and redefined as *the primary*

Extra providers opt in via `tunnel.<id>.enabled`. `getTunnelUrl()` returns the
primary's URL.

This is the decision that keeps the change small. Because the primary's URL is
what `getTunnelUrl()` returns, **every existing OAuth, cookie and redirect
scenario stays true verbatim**, and the legacy `reservedToken` migration is
untouched.

That matters mechanically, not just aesthetically: a MODIFIED block must
reproduce every scenario of the requirement it replaces, and the auth
requirements it would otherwise have touched carry twelve scenarios between them
(nine on redirect-URI resolution, three on the cookie `Secure` flag).

**Correction — this does not make the change MODIFIED-free.** An earlier draft
claimed "no MODIFIED requirement anywhere"; adversarial review disproved it:

- `tunnel.mode` is a **single field** (`config.ts:315`), and `PROVIDER_MODES`
  makes zerotier private-only while zrok/ngrok are public-only. "zrok primary +
  zerotier enabled" is inexpressible under one shared mode, so concurrency needs
  `tunnel.<id>.mode` — a MODIFIED block on **"Provider and mode selection"**,
  reproducing its six scenarios. Mode rejection also becomes per-provider:
  unsupported mode on the primary still refuses the connect; on a non-primary it
  disables only that provider.
- `server-cors` escapes a MODIFIED block only via an explicit carve-out — see D4.

The auth requirements remain untouched, which was the load-bearing half.

*Alternatives rejected:* a `tunnel.providers[]` array (breaks legacy migration
and forces a MODIFIED block on config); deriving the base from the request's
`Host` header (the redirect URI would vary per request, which is precisely what
the invariant forbids).

### D4 — CORS widens to all live origins; the redirect base does not

They answer different questions. CORS asks *"may this origin, already in the
address bar, read a response?"* — for a tunnel the operator started, yes. The
redirect base asks *"which single origin do we mint OAuth URIs and set cookies
for?"* — that must stay pinned to the primary, or the minted URI and the cookie
can describe different origins.

So the allowlist is every **connected** provider's origin, recomputed as tunnels
come and go; a disconnected provider's origin stops being allowed.

**Carve-out, found at source.** `cors-origin.ts:58` allows **any**
`*.share.zrok.io` / `*.shares.zrok.io` host with no tunnel required, and the
shipped spec mandates it (*"allowance SHALL be identical to before"*). So
"disconnected origins stop being allowed" is unsatisfiable for zrok. Narrowing a
shipped allowance is a behaviour change beyond this change's scope, so the new
requirement is scoped to providers **without** a standing wildcard (tailscale,
zerotier, ngrok), with the zrok carve-out stated as its own scenario. This adds
allowances and removes none.

### D5 — One runtime, PID file and watchdog per provider

`tunnel.ts` becomes a registry keyed by provider id; `tunnel-core.ts` holds one
`ChildTunnelRuntime` per entry rather than one process globally. Each has its
own PID file and watchdog so a recycle of one cannot disturb another.

**Scoped to `kind: "child"` providers only.** The shipped "Provider abstraction"
requirement already states that `kind: "daemon"` providers (tailscale, zerotier)
SKIP the child-PID-file and child-watchdog paths, being driven by idempotent
commands against a long-lived daemon. So the registry holds a `ChildTunnelRuntime`
for zrok and ngrok only; daemon entries carry no PID file and no watchdog. An
earlier phrasing said "per provider" without that scope and contradicted the
shipped requirement.

This is the largest mechanical piece and the one that finishes the half-landed
abstraction. It is also where an orphaned-process bug would live, so PID-file
naming must be per-provider from the first commit, not retrofitted.

### D6 — Readiness composes the three predicates that already exist

```
detectBinary()  false ─────────────────▶  not installed
        true → isEnrolled()  false ───────▶  not set up
              true → liveness (below) false ▶  disconnected
                          true ────────────▶  connected
```

**Correction — "no new detection logic" was false, in two places.**

1. **Daemon providers need a live probe.** `tailscale.ts:233` and `zerotier.ts:137`
   both return `this.lastEndpoints.length > 0` — in-memory state recording only
   whether *this server process* completed a `connect()`. A daemon brought up
   outside the dashboard reads `disconnected` forever; a daemon that died reads
   `connected` forever. Both are exactly what Gap 4 exists to report. So
   `kind: "daemon"` providers gain a `probeLive()` that queries the daemon itself,
   and readiness uses it instead of `status().active`. `status()` keeps its meaning
   for the tunnel lifecycle — this adds to the seam rather than redefining it.
2. **`registry.rescan()` is insufficient for zrok.** `zrok.ts:38-53` memoizes
   `zrokAvailable` at module scope and never re-consults the registry; only the
   test-only `_resetBinaryCache()` clears it. Readiness must call a **public**
   provider-local invalidation entry point alongside `rescan`, or install/removal
   detection silently fails for the flagship provider.

**A throwing predicate degrades only its own provider.** Throwing is not the only
failure mode: CLI calls carry 30s exec timeouts, so a *hung* predicate would stall
the whole report under overlap suppression. Every predicate is therefore bounded
by a timeout **shorter than the poll interval**; a timed-out provider is reported
with its `false`-branch state plus a `stale` marker; readiness returns the
providers that answered rather than waiting for the slowest.

### D7 — Poll at 5s, bound to the dialog's lifetime

One tick immediately on open, every 5s while open, stopped on close, overlapping
ticks suppressed, plus a manual refresh. Readiness shells out per provider
(~4 subprocesses per tick), which is affordable while someone is looking at the
tab and not affordable as a background service. The cadence is provisional until
a real tick is measured — see Risks.

### D8 — Declare the accent ramp; ban the fallback literal

The root cause is that `--accent` and `--accent-soft` are declared nowhere, so
every reference paints `var(--accent-soft,#1d3a63)`'s dark-navy literal in *both*
themes while the text above it stays theme-aware.

Declaring four tokens per theme fixes causes A and C with **no component
change** — the existing call sites simply stop hitting their fallback.

**Blast radius, counted at source — for the two undeclared tokens only.**
`--accent-blue`, `--accent-primary` and friends *are* declared (`index.css:67-73`);
matching `--accent*` as a prefix conflates them and inflates the count. Two earlier
drafts did exactly that.

In `packages/client/src` (excluding tests) `var(--accent[-soft])` appears **20
times across 14 files**: **11 fallback-form** in 7 files (10 in `Gateway/`, plus
`ProcessList.tsx` — the only outside one), painting the dark literal in both
themes; and **9 bare** in 7 files, all outside `Gateway/`, which paint nothing and
**start** painting once the token is declared.

**The bundled plugins render in the same document.** `--accent` is declared at
`:root`, so `automation-plugin` and `flows-plugin` — **12 further fallback-form
occurrences across 4 files**, written against different literals (`#6366f1`,
`#0969da`, `#f59e0b`) — are repainted too. Their authors picked those colours
deliberately. Either they are repointed with the client, or the change silently
restyles two plugins.

**Declaring the tokens is necessary but not sufficient — and naïvely it makes
things worse.** Six sites end up as white-on-accent:

- Four already paint it — `GatewayDialog.tsx:179,188`, `GatewayPage.tsx:140`,
  `GatewayUrlManager.tsx:282` read `bg-[var(--accent,#3b82f6)] … text-white`.
  With `--accent: #3b82f6` declared in dark, white on it is still **3.68:1**, the
  exact defect this change reports.
- Two would **newly** start painting it — `SpreadsheetPreview.tsx:104`
  (`bg-[var(--accent)] text-white`) and `PptxPreview.tsx:77`
  (`bg-[var(--accent)] text-[var(--accent-fg,#fff)]`) render nothing today.

`--accent` carries the border/ring role (3:1 non-text floor); a solid fill under
white text must use `--accent-solid` (#2563eb, 5.17:1). All six are repointed, not
merely de-literalled. Without that, cause C survives the fix, the change
**introduces** two AA failures that did not exist, and it violates its own new
requirement on the day it lands.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--accent` | `#3b82f6` | `#2563eb` | border, ring, focus |
| `--accent-soft` | `#1d3a63` | `#dbeafe` | fill behind `--text-primary` |
| `--accent-solid` | `#2563eb` | `#2563eb` | fill behind white |
| `--accent-text` | `#60a5fa` | `#1d4ed8` | link text |

`--accent-solid` is `#2563eb` in dark mode too: white on `--accent-primary`
`#3b82f6` measures 3.68:1 in **both** themes, so dark mode is not exempt.

The guard is the durable half — **as a ratchet, not a sweep, on both of its arms.**

The client already contains **72 fallback-form colour bindings across 19 files**
(excluding tests), so a check failing on all of them fails the day it lands and
forces the repo-wide reflow this change declares out of scope. The check therefore
records an enumerated baseline and fails only on bindings **added or modified**
afterwards.

The same applies to its second arm, which an earlier draft left unbounded:
`--border` (9 files), `--danger` (8), `--success`, `--accent-fg`, `--bg-input` and
`--border-focus` are **also undeclared today**. A rule that fails on any undeclared
colour property would fail on the untouched tree just as surely, contradicting the
very scenario that promises the baseline does not break the build. Both arms are
baselined; the baseline only ever shrinks; the accent tokens repaired here are
absent from it. The repo has met
this before and under-fixed it — `shutdown-session-recovery` bans `--accent` in
one component, reasoning an undeclared property "resolves to the empty string";
that reasoning does not cover the fallback form, which resolves to a very
visible colour.

### D9 — Offer gateway registration; never add silently

A live tunnel URL is not a gateway record. `gateway-action.ts` rejects a record
with no auth mode outright — *"a gateway with none is either unreachable or
unprotected"* — and the auth mode **cannot be inferred** from the URL:

| URL scheme | trusted-network | pairing | oauth |
|---|---|---|---|
| `https:` (zrok, tailscale) | ✓ | ✓ | ✓ |
| `http:` mesh IP (zerotier) | required + CIDR | ✗ needs TLS | ✗ providers refuse non-TLS |

Defaulting to `trusted-network` would publish an address protected by a CIDR the
user never chose; defaulting to pairing or OAuth is illegal on a mesh IP. So the
**offer** is automatic and the **decision** is not. Ineligible modes render
disabled *with their reason*, never hidden — hiding leaves the user unable to
distinguish "not allowed" from "not implemented".

**`oauth` is a fourth ineligibility, and it is the sharp one.**
`gateway-action.ts:144` writes `auth.redirectBaseUrl = <url>` whenever `oauth` is
selected — precisely the single value `resolveRedirectBase()` returns. Registering
a **non-primary** tunnel URL with `oauth` would therefore move the sign-in origin
off the primary, silently, via a path that bypasses the confirmation D10 imposes
on that exact consequence. Left unguarded, D9 defeats D10 and D3 together. So
`oauth` is unavailable when the URL is not the primary's, and registering the
primary's URL with `oauth` carries the same confirmation as designating a primary.

### D10 — Making a provider primary is confirmed, not one-click

Switching primary re-mints the OAuth redirect URI. Any provider with the old URI
registered byte-for-byte will reject sign-in until the new one is registered.
The action states that consequence inline and is confirm-gated.

### D11 — On mobile the readiness board is a navigation list

The board renders inside the Gateway dialog, which already spends ~200px on
title, tab strip and footer. Cards at ~186px/row put a five-row board at ~930px —
the dialog outgrows the viewport.

(The mockup renders five rows because it adds a `cloudflared` row purely to
exercise the `not-installed` state. `KNOWN_TUNNEL_PROVIDERS` holds **four**
providers — zrok, ngrok, tailscale, zerotier — and `cloudflared` is not one of
them. The pixel figures are therefore an upper bound on today's real board.)

Below 560px a row is **one 52px line**: `● zrok  ✓ Connected  Primary  ›`. The
URL and action buttons are not deleted; they live in that provider's Setup
panel, which the row opens. Board height: 288px list / 383px with header, all
every provider row visible without scrolling. Touch targets were not reduced — the
saving comes entirely from removing lines. Full measurements and the four-state
severity mapping are in `mockups/ui-plan.md`.

## Risks / Trade-offs

**Releasing the old reserved name on change is irreversible.** → The released
URL returns to a global pool and can be claimed by anyone; a user may have
shared it. Confirmation copy naming the exact URL is *not* by itself a
safeguard. Release must happen only **after** the new reservation succeeds, so a
failed replace never leaves the user with neither. Flagged for
`doubt-driven-review` before it stands.

**The stderr classification is load-bearing and unpinned.**
`/already exist/i && !/another|different account|owned by/i` distinguishes
"reuse mine" from "taken by someone else". A zrok CLI wording change silently
reclassifies one as the other. → Pin against captured real output; when neither
branch matches, emit an honest-but-vague message rather than guessing.

**Declaring the accent tokens repaints 20 occurrences across 14 client files and
12 more across 4 bundled-plugin files, at once**, in three groups that fail
differently. → The 11 fallback-form client sites (10 `Gateway/`, plus
`ProcessList.tsx`) flip from the dark-navy literal to a theme value; the 9 bare
`var(--accent)` sites in 7 non-Gateway files currently paint **nothing** and start
painting; the plugin sites were authored against different literals (`#6366f1`,
`#0969da`, `#f59e0b`) and get overridden by a `:root` declaration they never opted
into. Verify no group depended on its current appearance before the change stands.
Second `doubt-driven-review` trigger.

**The four white-on-accent buttons are a fix that does not fix.** → Declaring
`--accent: #3b82f6` leaves white on it at 3.68:1 in dark, which is the defect being
reported. They must be repointed to `--accent-solid`; a token declaration alone
would ship the change with its headline defect intact.

**A 5s poll spawning ~4 subprocesses per tick is a recurring interactive cost.**
→ Cadence is provisional until a real tick is measured (`performance-optimization`).
Overlap suppression bounds the worst case; if a measured tick approaches the
interval, the cadence moves before the change lands.

**Per-provider PID files and watchdogs multiply the orphaned-process surface.**
→ Naming must be per-provider from the first commit. A recycle test that asserts
one provider's restart leaves the others' PIDs untouched is the gate.

**A user reaching the dashboard over a non-primary tunnel signs in against the
primary's origin.** → Accepted, and preferable to the alternative: silently
promoting a live tunnel to mint OAuth URIs would move the auth origin without
the user asking. If the primary is not connected, the redirect base falls back
exactly as today.

**Daemon liveness probing is new runtime surface, not just a read.** `probeLive()`
shells out per daemon provider per tick. → It shares the readiness timeout bound
and the `stale` marker, and must not be invoked outside the dialog-bound poll.

**The fallback-literal baseline can rot into permanent debt.** A ratchet with 72
entries and no owner stays at 72 forever. → The baseline is enumerated in-repo so
its size is visible in review; entries may only be removed, never added.

**Scope.** This change spans reserved names, a degraded banner, a 24-occurrence
token repair, a readiness board and a multi-tunnel core rewrite. → The cut line, if
review stalls, is splitting Gaps 4–5 out: their spec deltas
(`tunnel-provider`, `server-cors`) are already separate files and contribute no
MODIFIED requirement, so they detach without rewriting anything.

## Migration Plan

No config migration is required — this is the point of D3. `tunnel.provider`
keeps its shape and gains a meaning (*primary*); `tunnel.<id>.enabled` is
additive and absent means false, so an existing single-provider config behaves
identically. The legacy v1 `reservedToken` remains preserved-and-ignored.

Rollback: the accent tokens and the readiness board are additive and revert
cleanly. The per-provider runtime registry is the one piece with state on disk
(PID files); a rollback must tolerate finding per-provider PID files written by
the newer build, so the older naming scheme should be treated as one of the
files to reap rather than assumed absent.

## Resolved Questions

These were open after the first draft and are now settled; each became a
concrete, testable value in the specs.

- **Predicate timeout bound: 4s.** Shorter than the 5s interval, with enough
  headroom for a slow cold CLI that a legitimate first call is not clipped, but
  short enough that a hung provider cannot survive into the next tick.
- **Readiness tick budget: p95 < 2s** across all known providers over a 10-minute
  window. This is the number `performance-optimization` gates on — exceeding it
  means the cadence or the per-provider cost changes before the feature ships.
  The 5s cadence stands or falls on this measurement.
- **Concurrency ceiling for test purposes: 2** — the primary plus one extra. That
  is the realistic operating case (e.g. zrok public + tailscale private) and the
  one the soak scenario loads. The server imposes no hard cap; N>2 is untested
  rather than forbidden.
- **Release on replace: immediate.** The old name is released as soon as the new
  reservation succeeds — no grace period, no second reservation held against the
  account limit. Two guards make this safe: the release never runs before the new
  reservation succeeds (so a failed replace leaves the original intact), and the
  live share is always torn down before `delete name` (so a running tunnel never
  has its reservation pulled out from under it). The residual risk stands and is
  accepted: a replaced URL returns to the global pool immediately and may be
  claimed by anyone, so the confirmation names the exact URL being destroyed.

## Open Questions

- None blocking. The irreversibility of an immediate release is an accepted
  trade-off rather than an unknown — see `doubt-driven-review` in the task list.
