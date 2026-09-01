# Design — persistent onboarding card

## Context

`LandingPage` derives three step states inline (`LandingPage.tsx:119-127`) and renders them in the content-router's fallback slot. The slot is exclusive; two of the three CTAs navigate out of it. See `proposal.md` for the defect table.

```
                     BEFORE                                    AFTER

   ┌─ content router (exclusive slot) ─┐      ┌─ content router (exclusive slot) ─┐
   │  settings │ folder │ chat │ LANDING│      │  settings │ folder │ chat │ LANDING│
   └───────────────────────────────────┘      └───────────────────────────────────┘
              ▲                                            ▲            ▲
              └── checklist lives here only                └── cards ───┘
                  (dies on navigate)                            (unchanged)

                                              ┌─ fixed overlay layer (route-independent) ─┐
                                              │  Toast z-50 · WorktreeInitStack z-40      │
                                              │  ► OnboardingCard z-30  ◄  NEW            │
                                              └───────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals**
- The checklist survives every navigation the CTAs themselves cause.
- One derivation of step state, consumed by both surfaces.
- Silent once onboarding is genuinely complete, and stays silent.

**Non-Goals**
- Changing the steps, their order, or their CTAs.
- Cross-device onboarding state.
- Contextual nudges inside the destination surfaces.

## Decisions

### D1 — Extract `useOnboardingSteps()`; both surfaces consume it

The derivation moves out of `LandingPage` into `packages/client/src/hooks/useOnboardingSteps.ts`:

```ts
useOnboardingSteps({
  providersReady,    // boolean  — useProvidersReady().ready
  providersLoading,  // boolean  — useProvidersReady().loading   (D2c)
  pinnedCount,       // number
  sessionsCount,     // number   — USER-VISIBLE sessions only     (D2b)
}) → {
  step1, step2, step3,   // StepState = pending | done | locked
  allDone,               // boolean
  resolved,              // boolean — false while readiness is loading (D2c)
}
```

Gate order:

```
  step1 = providersReady                    → done    : pending
  step2 = !providersReady                   → locked
        : pinnedCount > 0                   → done    : pending
  step3 = pinnedCount === 0                 → locked
        : sessionsCount > 0 || everStarted  → done    : pending
```

`step3` deliberately does not consult `providersReady`, so a credentials regression yields `① pending / ② locked / ③ done`. That is faithful to the shipped derivation and is specified explicitly rather than left to a reader to find surprising.

The hook takes the inputs as arguments rather than calling `useProvidersReady()` itself, so `App.tsx` keeps its single `useProvidersReady()` call (`App.tsx:561`) and both consumers observe identical values in the same render. A hook that fetched internally would mount twice, double the network traffic, and permit the two surfaces to disagree for one tick.

**Alternative rejected:** lift the derived object into `App.tsx` and prop-drill it. Equivalent correctness, but the ③ latch (D2) needs an effect, and effects belong in a hook rather than in the 2000-line shell component.

### D2 — Step ③ latches via `localStorage`

> **Corrected after adversarial review.** An earlier draft justified this decision with "`sessionsCount > 0` is transient — a user who ends every session is re-onboarded." **That is false.** `session_removed` sets `status: "ended"` and *keeps* the entry (`useMessageHandler.ts:377-386`); the server's `unregister()` likewise retains the record; `sessions_snapshot` ships ended sessions. `sessions.size` does **not** fall back to `0` when sessions end. The latch survives review on different, real grounds — recorded here so nobody "simplifies" it away after discovering the original rationale was wrong.

The two reachable exposures:

1. **Fresh server or cleared store.** `sessions.size` genuinely is `0`. Without a latch, a user who completed onboarding months ago is re-onboarded by a persistent, cross-route overlay.
2. **`sessions.size` counts sessions the user never knowingly started.** `session_added` puts `hidden` subagent sessions in the map (`useMessageHandler.ts:258-290`). Step ③ would flip to done because a background subagent spawned. This is fixed by *defining the count* (D2b), not by the latch — but it is why the count could not simply be trusted as-is.

```
  step3 = pinnedCount === 0                 → locked
        : sessionsCount > 0 || everStarted  → done
        : pending

  everStarted: localStorage["dashboard:onboarding-session-started"] === "1"
               written by an effect WHEN ABSENT, the first time sessionsCount > 0
```

Never cleared by the app. The regression rule follows mechanically: the card returns only when ① or ② regress, because ③ can no longer regress on its own.

**"Written exactly once" is not implementable literally** and must not be specified that way. Two hook instances (`LandingPage` + `OnboardingCard`) both run the effect, and React StrictMode fires each effect twice in dev. The writes are idempotent. The requirement is *write when the key is absent*; the assertion is *final value*, never call count.

Both keys introduced by this change use the colon form — `dashboard:onboarding-session-started` and `dashboard:onboarding-collapsed`. The repo ships both colon (`dashboard:sidebar-width`, `pi-dashboard:device-bearer`) and dotted (`modelselector.providerFilter`) keys, so there is no single convention to appeal to; the requirement here is only that this change's two keys agree with each other, which an earlier draft's mixed forms did not. Note it is origin-scoped: with `ServerSelector` multi-server support, a second server on the same origin inherits the first's latch. Accepted — the failure mode is one suppressed checklist, and per-server onboarding state would require the server-side persistence this decision already rejects.

Per-browser rather than server-side is a deliberate trade. Onboarding is a *hint about this browser's first-run experience*; storing it in dashboard config would mean a protocol message, a config key, a migration, and a rollback story for a value whose worst-case failure is "a returning user briefly sees a checklist they've already completed". `localStorage` is proportionate. It is recorded here so the trade is explicit rather than incidental.

**Alternative rejected:** derive `everStarted` from persisted session history. The dashboard does have session persistence, but reading it for this would couple an onboarding hint to the session store's retention policy — hidden sessions and a fresh server both change the answer.

### D2a — The card is mounted unconditionally and returns `null` internally

**The latch write is fragile in a way the obvious implementation gets wrong.** `session_added` calls `setSessions(...)` and `navigate('/session/:id')` in the same handler (`useMessageHandler.ts:258-312`), so React batches them into **one commit** in which `sessionsCount` becomes `1`, the route changes, and `allDone` becomes `true` simultaneously.

If the shell mounts the card conditionally —

```tsx
{!allDone && <OnboardingCard … />}     // ✗ WRONG
```

— the card unmounts in that same commit, its effect never runs, and the latch is **never written** on the mainline happy path. The user then hits the fresh-server case (D2 exposure 1) with no latch and is re-onboarded. Contract silently broken, on the most common path, invisible in any test that does not reload.

Therefore: `<OnboardingCard>` is mounted **unconditionally**, calls the hook at the top level, and returns `null` internally when `allDone`. The spec states this as a requirement rather than leaving it to implementer taste, because the wrong version looks more idiomatic.

For the same reason, `useOnboardingSteps()` must be called **before** `LandingPage`'s early return for the legacy no-props path (`LandingPage.tsx:102-108`) — a hook after a conditional return is a rules-of-hooks violation.

### D2b — `sessionsCount` means *user-visible* sessions

`sessions.size` includes `hidden` subagent sessions, so a background subagent would complete step ③ on the user's behalf and latch it. The count feeding the hook excludes `hidden` sessions. **Ended sessions still count** — the user did start them, and the existing done-row copy ("N active sessions") already reflects the shipped map's contents.

That copy is wrong for the latched case, where the count can be `0` while the step is done. The label for the latched-zero state is specified separately rather than rendering "0 active sessions" beside a ✔.

### D2c — `loading` suppresses the first-paint flash

`useProvidersReady()` initialises `{ loading: true, ready: false }` and resolves after two `fetch`es. A fully-configured user would see the card mount and unmount on **every reload**. The hook therefore takes `providersLoading` and reports *undetermined* — the card renders nothing — until readiness resolves. Discarding `loading` (as the first draft's signature did) makes this flash unavoidable and makes every card test racy.

### D3 — `LandingPage` keeps its cards; duplication on the landing route is accepted

Three options were weighed: suppress the overlay on the landing route; show both; show both with the overlay pre-collapsed there. **Show both** was chosen (user decision).

The cost is real and should be stated plainly: on the landing route a first-run user sees the same three steps twice in one viewport, which violates the "no element fails to serve the goal" heuristic for that one route. The benefit is that the overlay's presence is *constant* — it does not appear and disappear as a function of route, so the user never has to build a mental model of when it exists. Route-conditional overlays are the more common source of confusion.

If this proves annoying in practice, D3 is the cheapest decision to revisit: it is one boolean at the mount site.

**Reviewed and upheld.** The UX review raised this as Finding 1 (Severity 2 — two identical filled primary CTAs on the landing route, ~600px apart, costing hesitation rather than error) and recommended rendering the overlay pre-collapsed there. The recommendation was **considered and declined**: constant, unconditional presence of the card is the property being bought, and a route-conditional rendering — even a collapsed one — reintroduces the "when does this thing appear?" question the change exists to remove. The duplication stands as a deliberate trade, not an oversight. Implementations SHALL NOT quietly "fix" it.

### D4 — Collapse, not dismiss

There is no close button. Onboarding ends by being completed, and the card unmounts at `allDone`. A dismiss button would produce a state where a user is stuck mid-onboarding with the guidance permanently gone and no way to recover it.

Collapse is the pressure valve: the card shrinks to a pill showing `π 2/3` and nothing else, persisted in `localStorage["pi-dashboard.onboarding.collapsed"]`. Expanding is one click. The pill is the default below `sm`.

### D5 — Layering: `z-30`, below the transient overlays

```
  z-[100] toast slot
  z-[60]  Dialog
  z-50    SpawnErrorToastHost / RecoveryOfferHost / FirstLaunchDisplayModal
  z-40    WorktreeInitStack                bottom-4 right-4   ← same corner
  z-30    OnboardingCard                   bottom-4 right-4   ← NEW
```

The onboarding card shares a corner with `WorktreeInitStack`. That stack renders `null` unless **two or more** worktree inits are running concurrently (`WorktreeInitStack.tsx:36`), so the overlap window requires: onboarding incomplete **and** ≥2 concurrent worktree inits. When it happens, the transient surface wins — it is time-sensitive and short-lived; the onboarding card is a standing reminder that loses nothing by being covered for a few seconds.

**Alternative rejected:** a shared bottom-right dock component that stacks both. Correct, and it would eliminate the class of collision — but it means restructuring an existing shipped overlay's positioning for a collision that requires a rare conjunction. Deferred; if a third bottom-right overlay ever appears, build the dock then.

### D6 — Placement and responsive behaviour

- Desktop: `fixed bottom-4 right-4`, width `320px`, capped `max-w-[calc(100vw-2rem)]`.
- Below `sm`: default-collapsed pill, raised to clear `CommandInput` on session routes. The expanded card on mobile is a full-width-minus-margins sheet anchored to the same corner.
- The card never traps focus and is not a dialog. It is `role="complementary"` with an accessible name, so it is reachable in the tab order and skippable by landmark navigation.

**Top-left was evaluated and rejected — measured in the mockup (`?pos=`), not argued.** Two readings of "top-left" exist and both fail:

| Anchor | What it lands on | Verdict |
|---|---|---|
| Top-left of the **viewport** | The sidebar: `ResizableSidebar` + `SessionList` header/filter bar and the first session rows. On mobile, `HamburgerButton` (`MobileOverlay.tsx:15`, `fixed top-2 left-2 z-50`) — the primary navigation control | **Disqualified.** Buries the session list; on mobile it either covers the menu button or is covered by it |
| Top-left of the **content area** | The page heading and first rows of whatever the user just navigated to — e.g. the `Providers` title, immediately after Step ① sent them there | **Disqualified.** Obscures the destination at the exact moment the user arrives |

The sidebar is also user-resizable (`ResizableSidebar` writes an inline `width`), so a viewport-anchored top-left card cannot track the boundary without new plumbing that bottom-right does not need.

Bottom-right is the least-occupied corner: nothing is anchored there except the rare `WorktreeInitStack` (D5).

**The composer conflict needs new plumbing — an earlier draft wrongly claimed otherwise.** That draft said the conflict "is resolved by a single boolean (`raised`) already available at the mount site." No such boolean exists anywhere in the client (`rg '\braised\b'` → no hits). It is *derivable* in one expression from `selectedId`, which the mount site does already have, but it is a **new prop that must be specified, threaded, and tested** — not existing plumbing. Left as written, an implementer following the spec ships a card that overlaps `CommandInput`'s right edge, where the send controls live, on precisely the route step ③ sends the user to.

### D7 — No new theme tokens

The shell ships a complete severity ramp (`index.css:97-111`): `--severity-{info,success,neutral}-{bg,fg,border}`, each a `color-mix` over the theme's own accents and backgrounds, tuned to clear a 3:1 floor across all 9 themes × light/dark. The card uses:

| Element | Token |
|---|---|
| Card surface | `--bg-secondary` + `--border-secondary` (matches `WorktreeInitStack`) |
| Done row indicator | `--severity-success-fg` |
| Active step accent | `--severity-info-fg` / `--severity-info-bg` |
| Locked step | `--severity-neutral-fg` |
| Focus ring | `.focus-ring` utility (`--focus-ring`, 2px, offset 2) |

Introducing a bespoke palette here would repeat the `--amber` / `--amber-soft` mistake documented in `warn-unreachable-trusted-networks` — hardcoded fallbacks that silently fail light-theme contrast.

## Risks

| Risk | Mitigation |
|---|---|
| Two mount sites (`App.tsx` mobile + desktop) drift | Both mount the same component with the same props; a client test asserts presence in both shell branches |
| `localStorage` unavailable (private mode, embedded webview) | Reads are `try`/`catch` with a `false` default: worst case the card behaves as it does today, driven by live state only |
| Overlay obscures content on small viewports | Default-collapsed under `sm` (D6) |
| Duplication on the landing route reads as a bug | Accepted (D3); the two renderings are visually distinct — inline cards vs. a compact overlay list |

## Migration / Rollback

No migration. Two new `localStorage` keys, both optional, both defaulting to the pre-change behaviour when absent. Reverting the commit leaves the keys orphaned and inert.
