## 1. Theme tokens — repair the surface before building on it

- [x] 1.1 Write a failing test asserting `--accent`, `--accent-soft`, `--accent-solid` and `--accent-text` are declared in both `:root` and `[data-theme="light"]` in `packages/client/src/index.css`
- [x] 1.2 Write a failing contrast test for each token's role floor: `--accent-soft` behind `--text-primary` (≥4.5:1), `--accent-solid` behind white (≥4.5:1), `--accent-text` on page bg (≥4.5:1), `--accent` as border (≥3:1 non-text), in BOTH themes
- [x] 1.3 Declare the four tokens per theme per the D8 table; confirm `--accent-solid` is `#2563eb` in dark too (white on `#3b82f6` is 3.68:1 in both themes)
- [x] 1.4 Verify tests 1.1–1.2 pass and that causes A and C required no component change (existing `var(--accent-soft, …)` call sites stop hitting their fallback)
- [x] 1.5 Write a failing guard test that rejects NEWLY added/modified `var(--token, <literal>)` fallbacks for themed paints, against an enumerated baseline of the 72 (19 files) that already exist
- [x] 1.6 Implement the guard as a ratchet (baseline only shrinks); verify it passes on an unmodified tree and fails on a newly added fallback binding
- [x] 1.6a Baseline the **undeclared-token** arm too — `--border` (9 files), `--danger` (8), `--success`, `--accent-fg`, `--bg-input`, `--border-focus` are undeclared TODAY. Without a baseline this arm fails on the untouched tree, contradicting 1.6
- [x] 1.7 Strip the inline fallback literals from the **11 fallback-form occurrences in 7 files** (6 `Gateway/` + `ProcessList.tsx`). Scope by exact token — `--accent-blue`/`--accent-primary`/etc. are ALREADY declared (index.css:67-73) and must not be touched
- [x] 1.7a **Repoint all 6 white-on-accent sites to `--accent-solid`** — 4 that already paint it (`GatewayDialog.tsx:179`, `GatewayDialog.tsx:188`, `GatewayPage.tsx:140`, `GatewayUrlManager.tsx:282`) and 2 that would NEWLY start (`SpreadsheetPreview.tsx:104`, `PptxPreview.tsx:77`). Declaring `--accent:#3b82f6` leaves white on it at 3.68:1. Write the failing contrast test FIRST
- [x] 1.7c Declare `--accent-fg` or repoint `PptxPreview.tsx:77` off it — it currently reads `var(--accent-fg,#fff)` against a token this change otherwise leaves undeclared and baselined
- [x] 1.7b Raise the Gateway's failing `--text-muted` usages to `--text-secondary`
- [x] 1.8 **[doubt-driven-review]** Verify the **9 bare `var(--accent)` occurrences in 7 non-Gateway files** (`BashOutputCard`, `ToolCallStep`×2, `FallbackPreview`×2, `SpreadsheetPreview`, `TruncationBanner`, `ThinkingLevelSelector`, `PptxPreview`) — these paint NOTHING today and will START painting. Screenshot each before/after in both themes
- [x] 1.8a **[doubt-driven-review]** Handle the PLUGIN blast radius: `--accent` is declared at `:root`, so `automation-plugin` and `flows-plugin` (**12 fallback-form occurrences / 4 files**, written against `#6366f1`, `#0969da`, `#f59e0b`) get repainted. Decide per-site: repoint, or keep the plugin's own token. Do not silently restyle two plugins
- [x] 1.9 Verify `ProcessList.tsx:136` (the only non-Gateway fallback site) did not depend on the dark-navy literal

## 2. Reserved-name engine — typed outcomes

- [x] 2.1 Write failing unit tests in `packages/server/src/tunnel-providers/zrok.test.ts` for each `mintReservedName` outcome: `ok`, `taken`, `invalid`, `write-failed`
- [x] 2.2 Pin the stderr classification against **captured real zrok output** for both branches (`already exist` mine vs another account); assert the neither-branch case yields an honest-but-vague message, not a guess
- [x] 2.3 Change `mintReservedName` to return a typed outcome instead of `null`; keep the `pi-dash-<8 hex>` fallback behaviour for the no-name-supplied path
- [x] 2.4 Write a failing test that changing a name releases the OLD reservation **only after** the new one succeeds (a failed replace must leave the original intact)
- [x] 2.5 Implement release-on-change in `saveReservedName`; verify repeated edits cannot accumulate orphaned reservations
- [x] 2.5a Write a failing test that a release NEVER runs against a name whose share is still live — tear the share down first, mirroring the shipped forget path which calls `deleteTunnel()` before `releaseShare()` (`system-routes.ts:522`). Covers both clear and the old name during replace
- [x] 2.6 **[doubt-driven-review]** Stress-test the irreversibility of release before it stands — decide inline release vs the deferred-release open question in design.md

## 3. Reserved-name endpoint and shared types

- [x] 3.1 Add the reserved-name outcome type to `packages/shared/src/rest-api.ts`
- [x] 3.2 Write failing route tests for the set/clear endpoint covering all four outcomes
- [x] 3.3 Implement the endpoint in `packages/server/src/routes/system-routes.ts` alongside `tunnel-connect` / `tunnel-disconnect`; set `persistent: true` on save
- [x] 3.4 **[security-hardening]** Verify `RESERVED_NAME_RE` still rejects leading hyphens so a user-supplied value cannot reach `execFileSync` argv as an option; add a test for the option-injection case
- [x] 3.4a Write a failing test that the endpoint is refused without the network guard + auth gate applied to config-mutating routes (it writes config AND creates/destroys a remote zrok resource)
- [x] 3.4b Define and test set-while-connected: either reconnect onto the new name, or return the outcome plus an explicit "live tunnel still serves the previous URL" indication — never store a name the live tunnel does not serve with no signal. A failed reservation leaves the running tunnel untouched
- [x] 3.5 Add a `tunnel-config-migration` test for the persistence toggle

## 4. Reserved-name UI and degraded banner

- [x] 4.1 Write failing component tests for Gateway Setup step 3: idle, typing-valid, invalid, taken, write-failed, reserved, replace-confirm
- [x] 4.2 Add the reserved-name input to `GatewayDialog.tsx` as step 3, mirroring `RESERVED_NAME_RE` client-side for inline feedback before the round trip
- [x] 4.3 Validate on blur, not per keystroke; error text must state a fix
- [x] 4.4 Rename `Forget reserved URL` to a zrok-only, confirm-gated `Release` that names the exact URL being destroyed
- [x] 4.5 Write a failing test for the degraded banner: stored `reservedName` ≠ effective name in the live URL while `active` ⇒ warning banner
- [x] 4.6 Implement the banner as a reconciliation (D2) — `TunnelStatus` stays `active | inactive | unavailable`
- [x] 4.7 Route all new strings through `t(...)` following `gateway.forgetReserved`

## 5. Per-provider readiness — server

- [x] 5.1 Write a failing readiness truth-table test per provider covering all four states from `detectBinary()` / `isEnrolled()` / liveness — liveness is `status().active` for `kind:"child"` and `probeLive()` for `kind:"daemon"` (see 5.4-5.5)
- [x] 5.2 Write a failing test that a **throwing** predicate degrades only its own provider and never blanks the board
- [x] 5.3 Write a failing test that a stale tool-registry cache is refreshed — `rescan(name)` runs before `detectBinary()` so a terminal install is seen without a restart
- [x] 5.4 Write a failing test that a `kind:"daemon"` provider started OUTSIDE the dashboard reports `connected`, and one that died reports `disconnected` — `status().active` (in-memory `lastEndpoints`) cannot satisfy either
- [x] 5.5 Add `probeLive()` to the daemon providers (tailscale backend state, zerotier network authorization); readiness uses it instead of `status().active` for `kind:"daemon"`. It SHALL return reachable **endpoints**, not a bare boolean — a daemon connected outside the dashboard has an empty `lastEndpoints` and the report still owes endpoints
- [x] 5.6 Write a failing test that install/removal is detected for **both** memoizing providers — `registry.rescan()` clears neither zrok's `zrokAvailable` (`zrok.ts:38`) nor ngrok's `ngrokAvailable` (`ngrok.ts:27`); add a public invalidation entry point to each (not the test-only `_resetBinaryCache`)
- [x] 5.7 Write a failing test that a HUNG predicate (not just a throwing one) degrades only its own provider: bound every predicate below the poll interval, mark it `stale`, return the providers that answered
- [x] 5.8 Implement the readiness endpoint returning four-state readiness for every known provider
- [x] 5.9 **[observability-instrumentation]** Make a misclassification diagnosable — log which predicate produced each state

## 6. Readiness UI — board, steps, poll

- [x] 6.1 Write failing component tests: every state renders a **text label**, never colour alone (WCAG 1.4.1)
- [x] 6.2 Replace the hardcoded chip list in `GatewayProviderSection.tsx` with readiness-driven rows
- [x] 6.3 Drive `GatewaySetupGuide.tsx` content from readiness — a satisfied step renders as satisfied, not as outstanding work
- [x] 6.4 Write a failing test for poll lifecycle: one immediate tick on open, 5s interval while open, stopped on close, **no** polling when closed
- [x] 6.5 Write a failing test that overlapping ticks are suppressed
- [x] 6.6 Implement the poll bound to dialog lifetime plus the manual refresh control and the "checked Ns ago" stamp
- [x] 6.7 **[performance-optimization]** MEASURED, 2026-08-18, macOS, real providers (`zrok=not-set ngrok=not-installed tailscale=connected zerotier=not-set`), registry reset before every tick so each is a cold cache, n=30: **min 582ms · p50 594ms · p95 617ms · max 734ms**. Against the P1 budget (p95 < 2s) that is 31%; against the 5s poll interval, 12.3%. The 5s cadence therefore **stands** — it is not close enough to the interval to justify moving it, and overlap suppression bounds the worst case regardless. Note the sample includes one genuinely connected daemon (tailscale), so the daemon `probeLive()` shell-out IS represented rather than short-circuited by an absent binary.
- [x] 6.8 Implement the mobile treatment per D11: below 560px the board is a 52px-per-row navigation list; verify board height and that `document.scrollWidth` equals the viewport at 375 — `tests/e2e/gateway-board-mobile.spec.ts`; the action group collapses to the SELECTED row below 560px
- [x] 6.9 Verify touch targets stay ≥44px and contrast passes in both themes at 375 — same spec; measured ≥44px per row and the state label ≥4.5:1 in dark AND light

## 7. Concurrency — per-provider runtimes

- [x] 7.1 Add `tunnel.<id>.enabled` to `packages/shared/src/config.ts`; write a test that an existing single-provider config behaves identically (absent ⇒ false)
- [x] 7.1a Add `tunnel.<id>.mode` — a single top-level `mode` cannot express `zrok` primary + `zerotier` enabled (PROVIDER_MODES: zerotier private-only, zrok/ngrok public-only). Default to the provider's sole supported mode when it has exactly one
- [x] 7.1c Write a failing test for the **multi-mode** provider: tailscale supports BOTH `public` and `private` (`tunnel-provider.ts:108`), so an enabled tailscale with no `tunnel.tailscale.mode` is a per-provider config error — no mode can be inferred — while the primary still connects
- [x] 7.1b Write a failing test that an unsupported mode on a NON-primary disables only that provider, while an unsupported mode on the primary still refuses the connect as today
- [x] 7.2 Write a failing test that `tunnel.provider` now means *primary* and `getTunnelUrl()` returns the primary's URL
- [x] 7.3 Replace zrok-hardcoded delegation in `packages/server/src/tunnel/tunnel.ts` with a per-provider runtime registry
- [x] 7.4 Give each **`kind:"child"`** provider (zrok, ngrok) its own runtime instance, **per-provider PID file** and watchdog in `tunnel-core.ts` — per-provider naming from the first commit. Daemon providers (tailscale, zerotier) carry NO PID file and NO watchdog, per the shipped "child vs daemon lifecycle" scenario
- [x] 7.5 Write a failing recycle test: restarting one provider leaves every other provider's PID untouched
- [x] 7.6 Write a failing two-tunnel test asserting the OAuth redirect URI derives from the **primary only**
- [x] 7.7 Write a failing test that a disconnected primary falls back exactly as today, with **no** silent promotion of another live tunnel
- [x] 7.8 Implement the confirm-gated primary switch (D10), stating inline that switching re-mints the redirect URI

## 8. CORS

- [x] 8.1 Write a failing test that every **connected** tunnel origin is CORS-allowed
- [x] 8.2 Write a failing test that a disconnected provider's origin stops being allowed
- [x] 8.2a Write a test that the pre-existing `*.share(s).zrok.io` wildcard (`cors-origin.ts:58`) is UNCHANGED — a disconnected zrok origin stays allowed by it; scope 8.2 to providers with no standing wildcard
- [x] 8.3 Implement the allowlist in `packages/server/src/auth/cors-origin.ts` against all live tunnel origins, recomputed as tunnels come and go, adding allowances without removing any
- [x] 8.4 **[security-hardening]** Confirm the widened allowlist does not widen the redirect base — the two must stay separate resolutions

## 9. Gateway-URL registration offer

- [x] 9.1 Write failing tests for the scheme→mode eligibility table (D9): `https:` allows all three; `http:` mesh allows trusted-network only, with CIDR required
- [x] 9.2 Implement the offer — `Add gateway URL…` appears only while a connected provider's URL is unregistered; the row shows `✓ in gateway URLs` once registered
- [x] 9.3 Render ineligible modes **disabled with their reason**, never hidden
- [x] 9.3a Write a failing test that `oauth` is UNAVAILABLE when registering a non-primary URL — `gateway-action.ts:144` writes `auth.redirectBaseUrl`, which would move the sign-in origin off the primary and bypass the 7.8 confirm gate
- [x] 9.3b Write a test that registering with only `trusted-network`/`pairing` never touches `auth.redirectBaseUrl`
- [x] 9.4 Write a test that no gateway record is ever created without an explicit auth-mode choice

## 10. Verification

- [x] 10.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — 14 821 passing. NOT fully green: 11 tests across 3 files fail, ALL pre-existing on `origin/develop` and untouched by this change (`server-auto-start.test.ts` + `connection-suppress-auto-start.test.ts` = 10, `skill-frontmatter.test.mjs` = 1). Verified by reverting this diff to a pristine `origin/develop` tree in the same worktree and re-running. Recorded rather than claimed green.
- [x] 10.2 **[review-code]** Review the diff: server, shared types, theme layer and client in one change — two isolated passes: round 1 (server/theme/client core) found 3 blocking; the D9/D10 pass found 1 blocking (a stale `oauth` selection reaching the write once a tick demoted the provider), 2 major (panels outliving their predicate) and 3 minor. All fixed with fail-closed tests
- [x] 10.3 `npm run quality:changed` — Biome clean on changed files
- [x] 10.4 Manual QA: reserve a name, connect, confirm the URL matches; take a name known to be taken and confirm the stated reason — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 10.5 Manual QA: run zrok (primary, public) and tailscale (`tunnel.tailscale.mode=private`) concurrently; confirm both reachable, redirect URI from the primary only — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 10.5a Manual QA: open a screen from EACH bundled plugin (automation, flows) after the accent ramp lands and confirm no unintended restyle — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 10.6 Manual QA: install a provider from a terminal with the dialog open; confirm readiness updates without a restart — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 10.7 Manual QA: Gateway Setup tab in light AND dark at 375 and 1440 — no control below AA, no horizontal overflow. Explicitly re-measure the 4 repointed white-on-accent buttons in DARK, which is where `--accent` would have left them at 3.68:1 — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 10.8 Confirm `openspec validate add-zrok-custom-reserved-name` still passes

## 11. Test scenarios folded from test-plan.md

Every row in `test-plan.md` maps to exactly one task here. Each carries a
harness-exemplar pointer to copy glue from, the scenario Triple, and its
manifest id. L3 reads the harness port from `.pi-test-harness.json`
(`dashboardPort`) — never hardcode `:18000`.

### 11a. L1 — reserved name, outcomes and lifecycle

- [x] 11.1 name `a` (1 char, min) · POST set-name · `ok`, name persisted, `persistent=true` — see `packages/shared/src/__tests__/tunnel-provider.test.ts` (test-plan #E1)
- [x] 11.2 name of exactly 63 chars · POST set-name · `ok`, persisted verbatim — see same exemplar (test-plan #E2)
- [x] 11.3 name of 64 chars · POST set-name · `invalid`, config unchanged, no `zrok create name` executed — see same exemplar (test-plan #E3)
- [x] 11.4 name `""` · POST set-name · `invalid`, distinct from the clear path — see same exemplar (test-plan #E4)
- [x] 11.5 name `-lead` · POST set-name · `invalid`; argv never receives a leading-hyphen token — see same exemplar (test-plan #E5)
- [x] 11.6 name `has_underscore` · POST set-name · `invalid` naming the charset rule — see same exemplar (test-plan #E6)
- [x] 11.7 stderr `name already exists` without another/different-account/owned-by · classify · reuse-mine, NOT `taken` — see same exemplar (test-plan #E7)
- [x] 11.8 stderr `already exists (owned by another account)` · classify · `taken` — see same exemplar (test-plan #E8)
- [x] 11.9 stderr matching neither branch (`connection refused`) · classify · honest-but-vague, not silently reuse-mine — see same exemplar (test-plan #E9)
- [x] 11.10 `zrok create name` fails for the NEW name during replace · user replaces · old reservation intact, stored name unchanged, no orphaned release — see same exemplar (test-plan #X1)
- [x] 11.11 a share is live on the name being released · clear or replace · `deleteTunnel()` before `delete name`; never issued against a running share — see same exemplar (test-plan #X2)
- [x] 11.12 disk write fails after a successful remote reservation · POST set-name · `write-failed` surfaced, not a misleading `ok` — see same exemplar (test-plan #X3)
- [x] 11.13 request without network guard / auth gate · POST set-name · refused; nothing reserved, released or persisted — see `packages/server/src/__tests__/config-api.test.ts` (test-plan #X4)
- [x] 11.14 tunnel live on URL A · set name B · reconnect onto B, or explicit "still serving A until reconnected"; never a silent divergence — see same exemplar (test-plan #X5)
- [x] 11.15 tunnel live; new reservation returns `taken` · POST set-name · running tunnel undisturbed — see same exemplar (test-plan #X6)

### 11b. L1 — readiness

- [x] 11.16 `detectBinary`=false · evaluate · `not-installed`; `isEnrolled` and liveness never invoked — see `packages/shared/src/__tests__/tunnel-provider.test.ts` (test-plan #E10)
- [x] 11.17 `detectBinary`=true, `isEnrolled`=false · evaluate · `not-set` — see same exemplar (test-plan #E11)
- [x] 11.18 child provider, enrolled, `status().active`=false · evaluate · `disconnected` — see same exemplar (test-plan #E12)
- [x] 11.19 zrok binary installed after `zrokAvailable` memoized · next evaluation · reports new state; not via the test-only `_resetBinaryCache` — see same exemplar (test-plan #X7)
- [x] 11.20 same for **ngrok**'s `ngrokAvailable` memo · next evaluation · reports new state — see same exemplar (test-plan #X8)
- [x] 11.21 `zerotier-cli` stalls 30s · readiness tick · marked `stale` at the 4s bound; other 3 returned without waiting — see same exemplar (test-plan #X9)
- [x] 11.22 daemon live but this process never connected (`lastEndpoints` empty) · tick · `connected` via `probeLive()` with probe endpoints, NOT `disconnected` — see same exemplar (test-plan #X10)
- [x] 11.23 daemon connected by this process, then dies · tick · `disconnected`, not `connected` from stale endpoints — see same exemplar (test-plan #X11)
- [x] 11.24 one provider stubbed to hang · single tick · tick returns; 4s bound; hung provider `stale` — see same exemplar (test-plan #P2)

### 11c. L1 — config, concurrency, CORS

- [x] 11.25 `zrok/public` primary + `zerotier.enabled`, mode unset · resolve · zerotier defaults `private`; top-level mode not applied — see `packages/shared/src/__tests__/config.test.ts` (test-plan #E13)
- [x] 11.26 `tailscale.enabled`, mode unset · resolve · per-provider config error (two modes, none inferable); primary still connects — see same exemplar (test-plan #E14)
- [x] 11.27 non-primary `zerotier.mode=public` · connect · zerotier alone disabled; others connect — see same exemplar (test-plan #E15)
- [x] 11.28 primary `zrok.mode=private` · connect · whole connect refused, as before — see same exemplar (test-plan #E16)
- [x] 11.29 legacy bare `tunnel.reservedToken`, no provider · resolve · `{zrok, public}`; v1 token never passed to v2 — see same exemplar (test-plan #E17)
- [x] 11.30 primary not connected, another tunnel is · mint redirect URI · falls back as today, no silent promotion — see same exemplar (test-plan #X13)
- [x] 11.31 daemon provider enabled · connect · no child PID file, no watchdog, per the shipped child-vs-daemon rule — see same exemplar (test-plan #X14)
- [x] 11.32 tailscale connected then disconnected · request with its origin · allowed while connected, rejected after — see `packages/server/src/__tests__/cors.test.ts` (test-plan #E25)
- [x] 11.33 zrok disconnected · request from `*.shares.zrok.io` · still allowed; pre-existing wildcard untouched — see same exemplar (test-plan #E26)

### 11d. L1 — gateway registration and theme

- [x] 11.34 URL `http://10.147.20.4:8000` · build mode offer · pairing+oauth unavailable with reasons; trusted-network required with CIDR — see `packages/client/src/lib/__tests__/gateway-action.test.ts` (test-plan #E18)
- [x] 11.35 `https://` URL of a NON-primary provider · build mode offer · `oauth` unavailable citing sign-in origin; `auth.redirectBaseUrl` unwritten — see same exemplar (test-plan #E19)
- [x] 11.36 each of the 4 accent tokens, both themes · compute contrast per role · soft ≥4.5:1 under text-primary, solid ≥4.5:1 under white, text ≥4.5:1 on bg, accent ≥3:1 as border — see `packages/client/src/lib/__tests__/themes.test.ts` (test-plan #E20)
- [x] 11.37 the 6 white-on-accent sites in **dark** · compute contrast · ≥4.5:1; fails if any still binds `--accent` (3.68:1) — see same exemplar (test-plan #E21)
- [x] 11.38 unmodified tree (72 baselined bindings, 19 files) · run guard · passes — see same exemplar (test-plan #E22)
- [x] 11.39 one NEW out-of-baseline `var(--x,#fff)` · run guard · fails, naming binding + file — see same exemplar (test-plan #E23)
- [x] 11.40 a repaired entry removed from baseline, then reintroduced · run guard · fails; baseline only shrinks — see same exemplar (test-plan #E24)

### 11e. L2 — process/perf smoke

- [x] 11.41 full readiness tick across 4 providers, cold registry cache · **p95 < 2s**, 10-min window — see `qa/tests/02-server-start.sh` (test-plan #P1)
- [x] 11.42 2 tunnels live (zrok public primary + tailscale private), dialog open, polling · 30-min soak · no PID leak, RSS growth <10%, both reachable — see same exemplar (test-plan #P3)
- [x] 11.43 2 child tunnels live, one killed and recycled by its watchdog · other provider's PID untouched and still reachable — see same exemplar (test-plan #X12)

### 11f. L3 — rendered UI (Playwright vs docker harness)

- [x] 11.44 dialog closed · open it · a readiness request fires immediately, not after one interval — see `tests/e2e/zrok-v2-tunnel.spec.ts` (test-plan #F1)
- [x] 11.45 dialog open and polling · close it, wait 15s · zero further readiness requests — see same exemplar (test-plan #F2)
- [x] 11.46 a tick still in flight when the next is due · interval elapses · second suppressed; exactly one in flight — see same exemplar (test-plan #F3)
- [x] 11.47 provider reports `not-set` · readiness updates to `connected` · satisfied steps render satisfied; list shrinks — see same exemplar (test-plan #F4)
- [x] 11.48 one provider's predicate throws · board renders · that row degrades alone; other 3 still show state — see same exemplar (test-plan #F5)
- [x] 11.49 each of the 4 readiness states · render board · every state carries a text label, never colour alone — see same exemplar (test-plan #F6)
- [x] 11.50 zrok primary, tailscale connected · click "Make primary" on tailscale · confirmation names the redirect-URI consequence; no config write until confirmed — see `tests/e2e/gateway-primary-offer.spec.ts` (test-plan #F7)
- [x] 11.51 connected provider with unregistered URL · tunnel connects · offer appears; `gateways` unchanged until the operator acts — see `tests/e2e/gateway-primary-offer.spec.ts` (test-plan #F8)
- [x] 11.52 stored `reservedName` but connect serves an ephemeral URL · status renders · warning banner on stored-vs-effective mismatch; shown once, not per watchdog recycle — see same exemplar (test-plan #F9)

### 11g. Manual-only (no test folded; deferred post-merge)

- [x] 11.53 Inspect the 9 bare `var(--accent)` sites + 12 plugin sites after the token is declared — confirm no unintended restyle. Row F10 (test-plan: manual-only) — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
- [x] 11.54 Inspect the Gateway dialog board at 375×667 — rows read one-provider-per-line and the dialog chrome stays on screen. Row F11 (test-plan: manual-only) — **deferred to post-merge human verification** (manual-only; 11.53/11.54 map to test-plan F10/F11)
