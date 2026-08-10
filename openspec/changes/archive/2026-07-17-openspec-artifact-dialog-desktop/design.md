# Design — non-mobile artifact dialog

## Context (verified against code)

- Badges (`ArtifactLetters` / `ArtifactLettersButton` in `openspec-helpers.tsx`)
  fire `onReadArtifact(changeName, artifactId)` — **2 args**. There are **5**
  wiring sites in `App.tsx`: one **bare reference** `onReadArtifact={handleReadArtifact}`
  at `SessionList` (line ~1339, which binds cwd per-session internally), plus
  four cwd-closures (~1431 board, ~1496 mobileActions, ~1515 SessionHeader, ~1710
  ComposerSessionActions) each calling `handleReadArtifact(cwd, changeName, artifactId)`.
- `useOpenSpecActions.handleReadArtifact(cwd, changeName, artifactId)` always
  `navigate(buildOpenSpecPreviewUrl(...))`. Its deps are `{ send, openspecMap,
  navigate }` (`openspecMap` is currently unused — pre-existing dead dep).
- The URL route match renders `<OpenSpecPreview>` full-page at three responsive
  sites. `OpenSpecPreview` handles cold-load (`isWaitingForReplay` when
  `openspecMap.get(cwd)` is undefined) and not-found, and hardcodes
  `onTabChange={(tabId) => navigate(buildOpenSpecPreviewUrl(...))}` (line 275).
- `ArchiveArtifactReader` (non-exported, in `ArchiveBrowserView.tsx`) is the
  proven local-state reader pattern: `useState(initialArtifact)` →
  `useOpenSpecReader(cwd, changeName, activeArtifact, artifacts, true)` →
  `onTabChange={setActiveArtifact}`.
- `Dialog` (`client-utils/Dialog.tsx`): Esc + backdrop close, `useFocusTrap`,
  `z-[60]`, `bg-black/60` overlay. `size="full"` = `max-w-[95vw] max-h-[92vh]`;
  non-`flush` adds `p-5 space-y-4 overflow-y-auto`. **No built-in ✕.**
- `useMobile()` = `matchMedia("(max-width:767px),(max-height:599px)")` — width OR
  height, comma-OR.

## Decision

### Gate in App, not in the hook

Keep `useOpenSpecActions` navigate-only. Add an App-level handler where
`isMobile` and the dialog state already live:

```ts
const [artifactDialog, setArtifactDialog] =
  useState<{ cwd: string; changeName: string; artifactId: string } | null>(null);

const openArtifact = useCallback((cwd, changeName, artifactId) => {
  if (isMobile) handleReadArtifact(cwd, changeName, artifactId); // navigate (unchanged)
  else setArtifactDialog({ cwd, changeName, artifactId });
}, [isMobile, handleReadArtifact]);
```

`openArtifact` keeps the same 3-arg `(cwd, changeName, artifactId)` signature as
`handleReadArtifact`, so the **bare-reference** `SessionList` site (1339) swaps by
reference and the four cwd-closures swap the inner call. **All 5 sites** change;
missing any leaves that surface navigating full-page on non-mobile. This keeps
the generic action hook untouched (no App-UI coupling, no extra deps recreating
the callback on `isMobile` toggle) and puts the viewport branch at the only place
that owns both `isMobile` and `setArtifactDialog`.

### OpenSpecArtifactDialog — new component mirroring ArchiveArtifactReader

`OpenSpecPreview` cannot be reused (its `onTabChange` navigates). The new
component:

```
OpenSpecArtifactDialog({ cwd, changeName, initialArtifact, openspecMap, onClose })
  change      = openspecMap.get(cwd)?.changes.find(c => c.name === changeName)
  artifacts   = change?.artifacts ?? []
  waiting     = !openspecMap.get(cwd)              // cold-load
  [activeTab, setActiveTab] = useState(initialArtifact)
  reader      = useOpenSpecReader(cwd, changeName, activeTab, artifacts /* archive=false */)
  <Dialog open size="full" flush onClose={onClose} testId="openspec-artifact-dialog">
    <div className="h-[85vh] flex flex-col">    // REQUIRED wrapper (see below)
      <MarkdownPreviewView
        title/content/isLoading/error/tabs/activeTab from reader (or waiting/not-found states)
        onTabChange={setActiveTab}    // local state, NO navigate
        onBack={onClose}              // reader's back control closes the dialog
      />
    </div>
  </Dialog>
```

- **Flex wrapper is load-bearing:** `MarkdownPreviewView`'s root is
  `flex-1 flex flex-col min-h-0` — `flex-1` needs a flex parent to grow. The
  flush `Dialog` container is **not** `flex`, so the reader must be wrapped in a
  height-constrained `flex flex-col` box (e.g. `h-[85vh] flex flex-col`). Without
  it the header/tabs collapse to intrinsic height and the content area is
  invisible — the dialog looks broken. (Same pattern the other flush dialog uses.)
- **Cold-load / not-found:** re-derive `change`/`artifacts` from `openspecMap`
  every render (same source `OpenSpecPreview` uses). `waiting` → loading state.
  When `change === undefined` **after** the map has an entry, render an explicit
  not-found state (dedicated message, like `OpenSpecPreview` does) **instead of**
  letting `useOpenSpecReader` fetch a missing file and surface a generic
  "Failed to fetch" error. Because `openspecMap` is live, a change removed
  mid-dialog flips to not-found rather than crashing.
- **`flush` + `onBack→onClose`:** `flush` removes the `p-5`/double-scroll so the
  reader body sits flush inside the modal; the dialog **still** keeps the
  standard modal frame (`mx-4` margin, `border`, `rounded-lg`, `max-w-[95vw]
  max-h-[92vh]`) — it is a large centered modal, not literally edge-to-edge. The
  reader's existing back affordance becomes the close control (no ✕ primitive
  exists).

### Resize-while-open

Deterministic rule — an App effect closes the dialog when the viewport crosses
into mobile, so we never have a local-state dialog stranded over a route that
subsequent clicks would navigate behind it:

```ts
useEffect(() => { if (isMobile) setArtifactDialog(null); }, [isMobile]);
```

## Alternatives considered

- **Gate inside `useOpenSpecActions`** (design's first draft) — rejected: couples
  a generic hook to App UI state it doesn't own; `cwd` isn't even available there
  (badges pass 2 args). The gate belongs in App.
- **Reuse `OpenSpecPreview` inside the Dialog** — rejected: its `onTabChange`
  hardcodes `navigate`, so tab clicks would push URLs. Parameterizing it would
  touch the three out-of-scope route-match sites.
- **Extract a shared reader-body** used by archive + dialog + preview — deferred:
  cleaner (kills the 3rd copy) but touches out-of-scope archive/route code. Noted
  as DRY debt for a future change.
- **Dialog rendered from the route match (keep URL/back/deep-link)** — rejected
  by product choice for the simpler pure-local-state model.
- **Dialog on all viewports** — rejected: a full-screen modal on mobile is worse
  than the existing route.

## Risks & known limitations (documented, not fixed)

- **Dual display path on non-mobile:** click → dialog; held URL → full-page
  overlay. Intentional; means deep-linking is not click-generated but a held URL
  still works.
- **Nested-dialog focus-trap collision:** if a badge is ever clicked from inside
  another open `Dialog` (all `z-[60]`, each its own `useFocusTrap` + window Esc),
  two traps compete and Esc dispatch is non-deterministic. Current badge surfaces
  render in the main view, not inside dialogs, so this is latent; verify no badge
  surface is reachable from within an open Dialog before relying on it.
- **Archive coupling:** archived badges must not route through `openArtifact`
  (would open the non-archive path → not found). Archive stays on its own reader.
- **Pre-existing, unchanged:** `useOpenSpecReader` never passes the
  `AbortController` signal to `fetch` — rapid P→D→S→T clicks fire concurrent
  requests; stale writes are suppressed by the `!signal.aborted` guard, not
  cancelled. Local-state tabs remove the implicit route-change debounce, so this
  latent inefficiency is mildly amplified. Correctness holds; left out of scope.

## Verification

- Non-mobile: click P/D/S/T → dialog over current view, URL unchanged; tab switch
  changes content with no history push; Esc/backdrop/back close it, view intact.
- Cold-load: click before WS replay settles → loading state, then content.
- Resize: open dialog, shrink to mobile → dialog auto-closes.
- Mobile: click → full-page route, Back closes (unchanged).
- Archive browser artifact reading unaffected.
