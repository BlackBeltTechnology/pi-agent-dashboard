# Design: fix-desktop-back-navigation

## Context

`packages/client/src/App.tsx` has two navigation systems:

```
URL-routed (wouter)                  Local React state
──────────────────                  ─────────────────
/                                   previewState
/session/:id                        readmePreview
/settings                           piResourceFilePreview
/tunnel-setup                       piResourcesState
/folder/:cwd/terminals              archiveBrowserCwd
/folder/:cwd/editor                 specsBrowserCwd
                                    flowYamlPreview
                                    diffViewSessionId
                                    architectDetailOpen
                                    flowDetailAgent
```

The **mobile** branch (App.tsx:1370–1390) already merges them via a single `onBack` switch:

```tsx
onBack={() => {
  if (archiveBrowserCwd)         setArchiveBrowserCwd(null);
  else if (specsBrowserCwd)      setSpecsBrowserCwd(null);
  else if (flowYamlPreview)      setFlowYamlPreview(null);
  else if (diffViewSessionId)    setDiffViewSessionId(null);
  else if (piResourceFilePreview) setPiResourceFilePreview(null);
  else if (readmePreview)        setReadmePreview(null);
  else if (piResourcesState)     setPiResourcesState(null);
  else if (previewState)         setPreviewState(null);
  else                           navigate("/");
}}
```

The **desktop** branch never received this. The session header at App.tsx:785 still uses `window.history.back()`, and each overlay component receives its own `onBack={() => setXxx(null)}` with no awareness of siblings.

This design extracts mobile's switch into a shared pure helper so desktop reuses the exact same priority chain.

## Goals

1. The desktop `SessionHeader` back arrow ALWAYS lands somewhere visible — never a silent no-op.
2. Sidebar actions that open content-area overlays do not get masked by `/settings` or `/tunnel-setup`.
3. Single source of truth for "what does back mean" — usable by both mobile and desktop.
4. Zero behaviour change for users who never hit these edge cases.

## Non-Goals

- Not pushing overlay state into URLs (would solve everything via real `history.back()` but is a much larger refactor and changes the deep-link surface).
- Not changing the eight overlay components themselves — their internal back arrows still call their `onBack` prop; we just pass a smarter callback.
- Not changing keyboard / browser-back / forward / swipe-back. Mobile's `useSwipeBack` keeps using its existing `onBack`.
- Not changing how overlays *open*. Only how they close.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│   packages/client/src/lib/desktop-back.ts                       │
│                                                                  │
│   Pure helper: state in → action out                            │
│                                                                  │
│   selectDesktopBackTarget(state) →                              │
│     | { kind: "clear"; target: OverlayKey }                     │
│     | { kind: "navigate"; to: "/" }                             │
│     | { kind: "noop" }                                          │
│                                                                  │
│   Same priority order as mobile onBack switch.                  │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│   packages/client/src/hooks/useDesktopBack.ts                   │
│                                                                  │
│   Reads live overlay state + setters + navigate.                │
│   Returns memoised goBack() callback.                           │
│                                                                  │
│   goBack() { switch(selectDesktopBackTarget(state).kind) … }    │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│   App.tsx:785                                                    │
│     onBack={isMobile ? () => navigate("/") : goBack}            │
└──────────────────────────────────────────────────────────────────┘
```

The hook deliberately accepts the existing `setPreviewState` / `setReadmePreview` / etc. setters by reference rather than introducing a new reducer — minimum diff.

## Priority Chain

Identical to mobile's existing switch:

```
1.  archiveBrowserCwd
2.  specsBrowserCwd
3.  flowYamlPreview
4.  diffViewSessionId
5.  piResourceFilePreview
6.  readmePreview
7.  piResourcesState
8.  previewState
9.  (no overlay) → navigate("/")
```

`flowDetailAgent` and `architectDetailOpen` are NOT in the chain because they are sub-views inside the flow dashboard, not full content-area takeovers. They keep their existing local back behaviour. `extensionModuleOpen` is a `DialogPortal`-rendered modal with its own ESC/close, also not in the chain.

`settingsMatch` and `tunnelSetupMatch` are URL-driven; they fall through to `navigate("/")` because `/` is their natural escape and `window.history.back()` cannot be trusted (Bug 2).

## The Settings-vs-Overlay Conflict (Bug 1)

The fix is at the *open* path, not the *back* path. Sidebar handlers that set overlay state must close the URL-route view first when one is active:

```ts
// useOpenSpecActions.handleReadArtifact (modified)
const handleReadArtifact = useCallback((cwd, changeName, artifactId) => {
  // ... existing lookup ...
  deps.clearAllContentViews?.();
  if (deps.settingsMatch || deps.tunnelSetupMatch) {
    deps.navigate("/");
  }
  setPreviewState({ cwd, changeName, artifactId, artifacts });
}, [...]);
```

Same pattern for `handleViewPiResourceFile` and `handleViewReadme`.

This is preferred over re-layering the JSX because:
- The eight overlays already share one DOM slot. Z-stacking them under Settings would require duplicating the settings panel DOM, breaking iframes, focus trapping, and saved scroll position.
- There are exactly three sidebar entry points that can fire while Settings is open — easy to fix at the source.
- Future overlays added by plugins (`ContentViewSlot`) automatically inherit the right behaviour because they use the same `clearAllContentViews` hook contract.

## Decisions

### D1: Pure helper + thin hook over a reducer

We could rewrite `App.tsx`'s overlay state into a `useReducer` that owns a stack. That is a larger blast radius and breaks the existing `setXxx(null)` callsites used by ~20 components. The helper-plus-hook approach changes one line of `App.tsx` and adds two new files. Reducer is overkill for a fix.

### D2: Mobile's switch stays inline

The mobile branch keeps its inline `onBack` in App.tsx for the moment to minimise this PR's scope. A follow-up can refactor mobile to use the same `selectDesktopBackTarget` helper (renamed to `selectBackTarget`) once we're confident the helper covers every overlay correctly. **Tradeoff:** for now the priority chain is duplicated in two places — the helper and mobile's onBack. A unit test compares them at runtime to keep them in sync (see Tasks T7).

### D3: `navigate("/")` not `navigate(-1)` as fallback

`navigate(-1)` would be wouter's equivalent of `window.history.back()` and has the exact same Bug 2 silent-no-op problem. Forcing `navigate("/")` guarantees a visible destination at the cost of breaking "browser back keeps me on previous session" — but only when overlays *and* URL history are both empty, which is the cold-load case where there is no "previous session" anyway.

### D4: We do NOT push overlay state into URLs

URL-pushing solves all three bugs natively (browser back just works), but:
- 8 overlays × 2 deep links each = 16 new URL surfaces, each needing fallback / not-found / 404 logic
- Server-side SPA fallback (already in place) and `replayPendingUiRequests` would need to handle deep-linked overlay state on cold load
- Two of the overlays carry transient data (`flowYamlPreview` content is computed from session events, not refetchable from a URL alone)

Out of scope. Re-evaluate if the overlay set keeps growing.

## Test Plan

| Test | File | What it asserts |
|------|------|-----------------|
| `selectDesktopBackTarget` priority chain | `desktop-back.test.ts` (new) | Each overlay-set state returns `{kind:"clear", target}` for the right key; empty state returns `{kind:"navigate", to:"/"}`. |
| Mobile/desktop priority parity | `desktop-back.test.ts` | Inline mobile switch (extracted as a test fixture) and `selectDesktopBackTarget` produce identical results across all 256 boolean combinations of overlay flags. |
| Cold-load session back → `/` | `desktop-back.test.tsx` (new) | Mount App at `/session/abc-123` with empty `window.history`, click back arrow, assert URL is `/` and `LandingPage` is rendered. |
| Settings + sidebar artifact → preview opens, settings closes | `desktop-back.test.tsx` | Mount App at `/settings`, simulate `handleReadArtifact` call, assert URL is `/` and `OpenSpecPreview` is rendered. |
| Existing tests pass | `App.test.tsx`, `MobileShell.test.tsx`, etc. | No regression in mobile back, browser back/forward, or session selection. |

## Risks

| Risk | Mitigation |
|------|------------|
| Plugin-rendered overlays via `ContentViewSlot` are not in the priority chain | Out of scope — plugin slots own their own back affordance per current design. Document in proposal. |
| Adding `navigate` dep to `useOpenSpecActions` / `useContentViews` causes referential-identity churn that re-renders consumers | Both hooks use `useCallback`; `navigate` from wouter is stable. Verified by reading `wouter`'s `useLocation` source — the setter is referentially stable across renders. |
| `selectDesktopBackTarget` and inline mobile switch drift over time | Parity test (T7) compares them on every overlay state combination. CI fails if they diverge. |
| Future overlays added without updating the chain | Document the chain location in `AGENTS.md` next to the existing `mobile-depth.ts` line so the contract is discoverable. |

## Out of Scope

- Mobile back button refactor (works correctly today).
- URL-based overlay state (separate larger proposal if ever needed).
- Plugin slot back behaviour.
- `flowDetailAgent` / `architectDetailOpen` (intentional sub-view back behaviour).
- Any change to swipe-back gesture, keyboard shortcuts, or browser back/forward semantics.
