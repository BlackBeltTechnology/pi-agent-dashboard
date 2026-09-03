# Test Plan — add-zrok-custom-reserved-name

Stage: design   Generated: 2026-08-18

Clarifications C1–C4 were resolved before this catalog was written (HARD gate),
and the answers are now spec facts: predicate timeout **4s**, readiness tick
**p95 < 2s**, concurrency tested at **2 providers**, release on replace is
**immediate**. No `[NEEDS CLARIFICATION]` markers remain.

Boundary values for reserved names derive from the real regex
`RESERVED_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i` → max length **63**, first
char alphanumeric, hyphen legal only after position 1.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Reserved-name configuration endpoint | BVA (min) | L1 | automated | name `a` (1 char, the minimum) | POST set-name | `ok` outcome; `tunnel.zrok.reservedName === "a"`; `persistent === true` |
| E2 | Reserved-name configuration endpoint | BVA (max) | L1 | automated | name of exactly 63 chars, `a` + 62×`b` | POST set-name | `ok` outcome; name persisted verbatim |
| E3 | Reserved-name configuration endpoint | BVA (just over max) | L1 | automated | name of 64 chars | POST set-name | `invalid` outcome; config unchanged; no `zrok create name` executed |
| E4 | Reserved-name configuration endpoint | BVA (empty) | L1 | automated | name `""` | POST set-name | `invalid` outcome, distinct from the clear/`undefined` path |
| E5 | Reserved-name configuration endpoint | EP (invalid first char) | L1 | automated | name `-lead` | POST set-name | `invalid`; argv never receives a leading-hyphen token (option-injection guard) |
| E6 | Reserved-name configuration endpoint | EP (invalid charset) | L1 | automated | name `has_underscore` | POST set-name | `invalid`, naming the charset rule |
| E7 | Reserved-name lifecycle (MODIFIED) | decision-table | L1 | automated | stderr `name already exists` with none of `another\|different account\|owned by` | classify outcome | classified as reuse-mine, NOT `taken` |
| E8 | Reserved-name lifecycle (MODIFIED) | decision-table | L1 | automated | stderr `already exists (owned by another account)` | classify outcome | `taken` outcome |
| E9 | Reserved-name lifecycle (MODIFIED) | decision-table | L1 | automated | stderr matching neither branch, e.g. `connection refused` | classify outcome | honest-but-vague message; NOT silently classified as reuse-mine |
| E10 | Per-provider readiness state | decision-table | L1 | automated | `detectBinary`=false | evaluate readiness | `not-installed`; `isEnrolled` and liveness never invoked |
| E11 | Per-provider readiness state | decision-table | L1 | automated | `detectBinary`=true, `isEnrolled`=false | evaluate readiness | `not-set` |
| E12 | Per-provider readiness state | decision-table | L1 | automated | child provider, `isEnrolled`=true, `status().active`=false | evaluate readiness | `disconnected` |
| E13 | Provider and mode selection (MODIFIED) | decision-table | L1 | automated | `provider=zrok`, `mode=public`, `zerotier.enabled=true`, `zerotier.mode` unset | resolve config | zerotier defaults to `private` (its sole mode); top-level `mode` not applied to it |
| E14 | Provider and mode selection (MODIFIED) | decision-table | L1 | automated | `tailscale.enabled=true`, `tailscale.mode` unset | resolve config | per-provider config error — tailscale supports both modes, none inferable; primary still connects |
| E15 | Provider and mode selection (MODIFIED) | decision-table | L1 | automated | non-primary `zerotier.mode=public` (unsupported) | connect | zerotier alone disabled; primary and others still connect |
| E16 | Provider and mode selection (MODIFIED) | decision-table | L1 | automated | primary `zrok.mode=private` (unsupported) | connect | whole connect refused, exactly as before this change |
| E17 | Provider and mode selection (MODIFIED) | state-transition | L1 | automated | legacy config: bare `tunnel.reservedToken`, no `provider` | resolve | `{provider:"zrok", mode:"public", zrok:{reservedToken}}`; v1 token never passed to the v2 provider |
| E18 | Offered auth modes gated by scheme | decision-table | L1 | automated | URL `http://10.147.20.4:8000` | build mode offer | `pairing` + `oauth` unavailable with reasons; `trusted-network` required with non-empty CIDR |
| E19 | Offered auth modes gated by scheme | decision-table | L1 | automated | URL `https://x.shares.zrok.io`, provider is NOT primary | build mode offer | `oauth` unavailable citing sign-in-origin; `auth.redirectBaseUrl` unwritten |
| E20 | Accent tokens declared for every theme | BVA (contrast) | L1 | automated | each of the 4 accent tokens, both themes | compute contrast for its role | `--accent-soft` ≥4.5:1 under `--text-primary`; `--accent-solid` ≥4.5:1 under white; `--accent-text` ≥4.5:1 on page bg; `--accent` ≥3:1 as border |
| E21 | Accent tokens declared for every theme | BVA (the survivor) | L1 | automated | the 6 white-on-accent sites, **dark** theme | compute contrast | ≥4.5:1 — fails if any still binds `--accent` (#3b82f6 → 3.68:1) instead of `--accent-solid` |
| E22 | Themed paints SHALL NOT rely on a fallback literal | decision-table | L1 | automated | unmodified tree (72 baselined fallback bindings, 19 files) | run guard | passes — baseline does not fail the build |
| E23 | Themed paints SHALL NOT rely on a fallback literal | decision-table | L1 | automated | one NEW `var(--x,#fff)` binding added outside the baseline | run guard | fails, naming binding + file |
| E24 | Themed paints SHALL NOT rely on a fallback literal | decision-table | L1 | automated | a baselined entry repaired, removed from baseline, then reintroduced | run guard | fails — baseline only shrinks |
| E25 | Every live tunnel origin is CORS-allowed | decision-table | L1 | automated | tailscale connected, then disconnected | request with tailscale origin | allowed while connected; rejected after disconnect |
| E26 | Every live tunnel origin is CORS-allowed | decision-table | L1 | automated | zrok disconnected | request from `*.shares.zrok.io` | still allowed — pre-existing wildcard untouched by this change |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Readiness polled only while dialog open | tail-latency | L2 | automated | full readiness tick across all 4 known providers, cold tool-registry cache | **p95 < 2s** per tick | 10 min |
| P2 | Readiness polled only while dialog open | threshold | L1 | automated | one provider stubbed to hang indefinitely | tick still returns; bound = **4s**; hung provider marked `stale` | single tick |
| P3 | Several providers may run concurrently | soak | L2 | automated | 2 tunnels live (zrok public primary + tailscale private), dialog open, polling | no PID leak; RSS growth < 10% ; both tunnels still reachable | 30 min |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Readiness polled only while dialog open | state-transition | L3 | automated | Gateway dialog closed | open the dialog | a readiness request fires immediately, not after one interval |
| F2 | Readiness polled only while dialog open | state-transition (illegal edge) | L3 | automated | dialog open and polling | close the dialog, wait 15s | zero further readiness requests — converges to no in-flight polling |
| F3 | Readiness polled only while dialog open | state-convergence | L3 | automated | a tick still in flight when the next is due | interval elapses | second tick suppressed; exactly one request in flight at any time |
| F4 | Setup content is driven by readiness | state-transition | L3 | automated | provider reports `not-set` | readiness updates to `connected` | steps already satisfied render satisfied; the list shrinks rather than restating done work |
| F5 | Per-provider readiness state | state-transition | L3 | automated | one provider's predicate throws | readiness renders | that row degrades alone; the other 3 rows still show their state |
| F6 | Setup content is driven by readiness | decision-table | L3 | automated | each of the 4 readiness states | render the board | every state carries a **text label**, never colour alone (WCAG 1.4.1) |
| F7 | Designating the primary is explicit and confirmed | state-transition | L3 | automated | zrok primary, tailscale connected | click "Make primary" on tailscale | confirmation appears naming the redirect-URI consequence; no config write until confirmed |
| F8 | A live tunnel URL may be offered, never added silently | state-transition | L3 | automated | connected provider whose URL is unregistered | tunnel connects | the offer appears; `gateways` unchanged until the operator completes the action |
| F9 | Degraded persistence reporting | state-convergence | L3 | automated | stored `reservedName=robson-home-mac`, connect falls back to an ephemeral URL | status renders | warning banner keyed on stored-vs-effective mismatch; converges to shown-once, not per watchdog recycle |
| F10 | Accent tokens declared for every theme | visual/subjective | — | manual-only | the 9 bare `var(--accent)` sites + 12 plugin sites | human inspects after the token is declared | [judgment: no unintended restyle — these paint nothing today and will start painting] |
| F11 | Mobile readiness board (design D11) | visual/subjective | — | manual-only | Gateway dialog at 375×667 | human inspects the board | [judgment: rows read as one-provider-per-line and the dialog chrome stays on screen] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Reserved-name lifecycle (MODIFIED) | fault-injection (abort) | L1 | automated | `zrok create name` fails for the NEW name during a replace | user replaces the name | old reservation intact; stored name unchanged; no orphaned release |
| X2 | Reserved-name lifecycle (MODIFIED) | ordering | L1 | automated | a share is live on the name being released | clear, or replace the old name | `deleteTunnel()` runs before `delete name`; `delete name` never issued against a running share |
| X3 | Reserved-name lifecycle (MODIFIED) | fault-injection (abort) | L1 | automated | `saveReservedName` disk write fails after a successful remote reservation | POST set-name | `write-failed` outcome surfaced, not a misleading `ok` |
| X4 | Reserved-name configuration endpoint | fault-injection | L1 | automated | request without the network guard / auth gate | POST set-name | refused; nothing reserved, released or persisted |
| X5 | Reserved-name configuration endpoint | state-transition | L1 | automated | tunnel live on URL A | set a different reserved name B | either a reconnect onto B, or an explicit "still serving A until reconnected"; never a silent stored-vs-served divergence |
| X6 | Reserved-name configuration endpoint | fault-injection | L1 | automated | tunnel live; new reservation returns `taken` | POST set-name | running tunnel undisturbed, still serving its URL |
| X7 | Readiness reflects out-of-dashboard changes | fault-injection (stale cache) | L1 | automated | zrok binary installed after `zrokAvailable` memoized true→false | next readiness evaluation | reports the new state; invalidation does not depend on the test-only `_resetBinaryCache` |
| X8 | Readiness reflects out-of-dashboard changes | fault-injection (stale cache) | L1 | automated | same, for **ngrok**'s `ngrokAvailable` memo | next readiness evaluation | reports the new state |
| X9 | Per-provider readiness state | fault-injection (delay) | L1 | automated | `zerotier-cli` stalls 30s (its exec timeout) | readiness tick | zerotier marked `stale` at the 4s bound; other 3 providers returned without waiting |
| X10 | Per-provider readiness state | fault-injection | L1 | automated | daemon provider live but this process never called `connect()` (`lastEndpoints` empty) | readiness tick | `connected` via `probeLive()`, with endpoints from the probe — NOT `disconnected` from `status().active` |
| X11 | Per-provider readiness state | fault-injection | L1 | automated | daemon connected by this process, then the daemon dies | readiness tick | `disconnected` — not `connected` from stale in-memory endpoints |
| X12 | Several providers may run concurrently | fault-injection (abort) | L2 | automated | 2 child tunnels live; one is killed and recycled by its watchdog | watchdog fires | the other provider's PID is untouched and it stays reachable |
| X13 | Several providers may run concurrently | state-transition | L1 | automated | configured primary is not connected; another tunnel is | mint an OAuth redirect URI | falls back exactly as today; **no** silent promotion of the live tunnel |
| X14 | Several providers may run concurrently | decision-table | L1 | automated | daemon provider (tailscale/zerotier) enabled | connect | no child PID file and no watchdog created for it, per the shipped child-vs-daemon rule |

---

## Coverage summary

- Requirements covered: 15/15
- Scenarios by class: edge 26 · perf 3 · frontend 11 · error 14 — **54 total**
- Scenarios by level: L1 39 · L2 4 · L3 9 · manual-only 2
- Scenarios by disposition: automated **52** · manual-only **2**

## New infra needed

- **none.** L1 extends `packages/server/src/tunnel-providers/__tests__/` and the
  client's existing `__tests__` dirs; L2 extends `qa/tests/*.sh`; L3 extends
  `tests/e2e/*.spec.ts` against the docker harness port read from
  `.pi-test-harness.json` (`dashboardPort`, hash-derived per worktree — never
  hardcode `:18000`).
- P3's RSS/PID-leak assertion is the only row needing a measurement helper; it
  fits the existing L2 smoke shape rather than a new harness.
