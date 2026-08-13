## Why

The three-step onboarding checklist lives inside `LandingPage`, which the shell renders as the **last fallback of the content-router chain** (`App.tsx:2229` mobile, `App.tsx:2338` desktop). That slot is mutually exclusive with every other primary view. So acting on a step destroys the guidance for the remaining steps:

| Step | CTA | Effect on the checklist |
|---|---|---|
| ① Setup credentials | `navigate("/settings/providers")` | `settingsMatch` wins the slot → **checklist unmounts** |
| ② Add folder | `onOpenPinDialog()` | modal over the same route → checklist survives |
| ③ Start session | `onSpawnSession(cwd)` | `sessionDetail` wins the slot → **checklist unmounts** |

Two of the three steps are self-erasing. A first-run user clicks "Open settings", configures a provider, and is left on the providers page with no indication that steps ② and ③ exist. The checklist is only reachable again by manually navigating back to a route where nothing is selected — which the user has no reason to believe exists.

The shell already solves exactly this problem for other surfaces: `WorktreeInitStack` (`App.tsx:2144`, `2253`) and `SpawnErrorToastHost` (`App.tsx:2145`) are mounted **outside** the route switch as fixed overlays, so they survive navigation. Onboarding has the same requirement and none of the mechanism.

**A second defect makes the fix inert without an additional change.** `useProvidersReady()` refetches on mount, on window `focus`, and on a `provider-auth-event` custom event (`useProvidersReady.ts:61-71`). Nothing in the shipped client or extension ever **dispatches** `provider-auth-event` — the only occurrences are the listener, its `AGENTS.md` row, and its own unit test. Saving an API key on the providers page therefore does **not** update readiness; the user stays on that page, so no `focus` fires either. Without a dispatcher, a persistent card would sit there still showing ① as pending after the user just completed it — worse than the current behaviour, because now they are staring at the stale claim. Adding the dispatcher is part of this change, not an optional follow-up.

**Step ③'s done-condition also needs defining, for reasons the obvious ones do not cover.** `sessionsCount` is `sessions.size` (`App.tsx:2231`, `:2340`), and that map:
- **retains ended sessions** — `session_removed` sets `status: "ended"` and keeps the entry (`useMessageHandler.ts:377-386`), and the server's `unregister()` likewise retains the record. `sessions.size` does not return to `0` when a user ends every session.
- **includes hidden subagent sessions** — `session_added` adds them to the map; only navigation is gated on `hidden` (`useMessageHandler.ts:258-290`).

So the naive worry ("a returning user with no sessions gets re-onboarded") is not reachable within a page lifetime. The real exposures are narrower and both are live: a **fresh server or cleared store** genuinely returns `sessions.size` to `0`, and a **background subagent session** can push it above `0` before the user has knowingly started anything, marking ③ done on the user's behalf.

## What Changes

- Extract the step-state derivation currently inlined in `LandingPage` into a new **`useOnboardingSteps()`** hook — the single source of truth for `pending` / `done` / `locked` and for overall completion. Two surfaces rendering the same checklist from two copies of the derivation would drift.
- Add a **persistent floating onboarding card**: a fixed bottom-right overlay mounted as a sibling of `WorktreeInitStack` in both the mobile and desktop shells, therefore visible on **every** route while onboarding is incomplete. It renders the same three steps with the same CTAs.
- **Dispatch `provider-auth-event`** from the credential-save paths (`ProviderAuthSection` API-key `PUT` and the OAuth/device completion handlers, plus the LLM-providers save). The listener already exists and is already specified; only the dispatcher is missing. Without this the persistent card would display a stale ①.
- **Define `sessionsCount` as user-visible sessions** — `hidden` subagent sessions are excluded. Ended sessions still count (the user did start them), which is what the existing done-row copy already means.
- **Latch step ③.** Introduce a `localStorage`-persisted flag recording that a session has ever been started, covering the fresh-server / cleared-store case. Step ③'s done-state reads `sessionsCount > 0 || everStarted`. The card's visibility condition therefore only regresses if ① or ② regress — which it deliberately still does, so a user who deletes their credentials is guided back.
- The card renders **nothing** when all three steps are satisfied. There is no dismiss button: completing onboarding is the dismissal. The component itself stays **mounted unconditionally** and returns `null` internally — conditionally mounting it at the call site would stop the latch effect from running in the very commit that completes onboarding (design D2a).
- **Suppress the first-paint flash.** `useProvidersReady()` starts `{ loading: true, ready: false }`, so a fully-configured user would otherwise see the card appear and vanish on every reload. The hook consumes `loading` and reports "not yet determined" rather than "incomplete".
- The card is **collapsible to a pill**, persisted in `localStorage`, so a user who wants it out of the way can shrink it without losing it. It defaults to collapsed below the `sm` breakpoint, via the existing `useMediaQuery` hook and the jsdom-absent-means-desktop convention already established by `InstructionsPage.tsx:99-105`.
- On routes that own a composer the card is **raised** clear of it. This is a new prop derived from `selectedId` at the mount site — not, as an earlier draft of this proposal claimed, something already present.
- `LandingPage` keeps its existing three cards unchanged, now fed by the hook. On the landing route both surfaces are visible simultaneously — accepted, see design D3.

Not in scope: changing which steps exist, their order, their CTAs, or their done-conditions (beyond the ③ latch). No server-side persistence of onboarding state — this is a per-browser hint (design D2). No contextual "next step" nudges embedded in the destination surfaces (settings, chat); that is a plausible follow-up, deliberately excluded to keep one mechanism.

## Capabilities

### New Capabilities
<!-- none — this extends one existing capability -->

### Modified Capabilities
- `landing-page-onboarding`: the capability grows a second rendering surface. New requirements for the shared derivation hook, the persistent floating card (visibility, placement, collapse, layering), and the latched step-③ condition. The existing `LandingPage` requirements are amended only where the latch changes step ③'s done-condition.

## Impact

**Client**
- `packages/client/src/hooks/useOnboardingSteps.ts` — NEW. Derives the three step states plus `allDone` from `providersReady`, `providersLoading`, `pinnedCount`, `sessionsCount`; owns the ③ latch (read + write) against `localStorage`.
- `packages/client/src/components/settings/ProviderAuthSection.tsx` — dispatches `provider-auth-event` after a successful API-key `PUT` (`:362`), OAuth completion, and device-flow completion. Two or three `window.dispatchEvent` calls; no other behaviour changes.
- The LLM-providers save path in the settings panel — same one-line dispatch.
- `packages/client/src/components/shell/OnboardingCard.tsx` — NEW. The fixed overlay. Expanded and collapsed (pill) renderings; consumes the hook; takes the same `onOpenPinDialog` / `onSpawnSession` / `navigate` callbacks `LandingPage` already receives.
- `packages/client/src/components/shell/LandingPage.tsx` — step-state derivation deleted, replaced by the hook (called **before** the legacy early return at `:104-113`, or it is a rules-of-hooks violation). Two markup changes: a new `providersLoading` prop threaded through, and the step-③ done row must render a count-free label in the latched-zero case rather than "0 active sessions" beside a ✔. All other markup unchanged.
- `packages/client/src/App.tsx` — mounts `<OnboardingCard>` **unconditionally** beside `<WorktreeInitStack />` in both shell branches (D2a). The existing `sessionsCount={sessions.size}` at `:2231` / `:2340` must become a hidden-filtered count for both `<LandingPage>` and the card (D2b), and both surfaces additionally receive `providersLoading` and the composer-clearing offset flag.
- i18n: new keys for the card header, progress counter, collapse/expand controls, reusing the existing step title/description keys.

**Unaffected**
- `useProvidersReady()`'s own logic is consumed as-is — only its `loading` field starts being read, and the `provider-auth-event` it already listens for finally starts being fired.
- No server, protocol, or config surface. Nothing is sent over the WebSocket.
- The sidebar "Add folder" button and `PinDirectoryDialog` are untouched.

**Tests**
- Unit: `useOnboardingSteps` truth table — the input space is **16 rows**, not 8: `providersReady × pinnedCount>0 × sessionsCount>0 × latch`. Plus the `loading` suppression row, latch write-on-absent, latch read on mount, and prerequisite-regression behaviour.
- Client: card visibility per state, unmount at completion, collapse persistence, CTA wiring, collapsed-by-default under `sm`, coexistence with `LandingPage` on the landing route.
- Regression: existing `LandingPage.test.tsx` must pass unchanged except where the ③ latch alters an assertion.

**Rollback**: purely additive client UI. Reverting restores current behaviour. The only persisted artifact is two `localStorage` keys, which become inert — no migration, no server state, no cleanup required.

## Discipline Skills

- `review-code` — the change touches the shell's mount graph (`App.tsx`) in two places that must stay in sync; a review pass before commit is warranted.
- `code-simplification` — the hook extraction exists to remove duplication, so the result must be measurably simpler than two copies of the derivation, not a third abstraction layered on top.

No `security-hardening` (no untrusted input, auth, secrets, or PII), no `performance-optimization` (no latency budget or large-data path), and no `observability-instrumentation` (no new endpoint, job, or external call) checkpoint fires for this change.
