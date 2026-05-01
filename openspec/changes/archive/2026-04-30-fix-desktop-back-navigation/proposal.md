# fix-desktop-back-navigation

## Why

On desktop, the dashboard's back arrows behave inconsistently because two parallel "navigation" systems do not compose:

1. **URL-routed views** (`/`, `/session/:id`, `/settings`, `/tunnel-setup`, `/folder/:cwd/...`) — managed by wouter, traversed via `window.history`.
2. **Content-area overlays** (`previewState`, `readmePreview`, `piResourceFilePreview`, `piResourcesState`, `archiveBrowserCwd`, `specsBrowserCwd`, `flowYamlPreview`, `diffViewSessionId`) — kept in local React state in `App.tsx`, each with its own `onBack={() => setXxx(null)}` handler.

The mobile branch (lines 1370–1390 of `packages/client/src/App.tsx`) already has a unified `onBack` priority switch that pops overlays in order. The desktop branch never received that fix, so the user sees three concrete bugs:

### Bug 1 — Settings hides quietly-set overlays

Desktop content area is hard-gated by `!settingsMatch && !tunnelSetupMatch` (App.tsx:1523). The sidebar (`FolderOpenSpecSection`, `MissingRequiredBanner`, etc.) is **always mounted**, including while Settings is open. Clicking a sidebar artifact letter while in Settings calls `useOpenSpecActions.handleReadArtifact()` → `setPreviewState({...})` — but the JSX gate blocks the preview block, so nothing visibly changes. The first click of the Settings back arrow appears to do nothing useful: `navigate("/")` closes Settings, the gate reopens, and `OpenSpecPreview` springs into view *as if* the back button opened it. Two clicks are needed to reach the landing page from a state the user did not consciously enter.

Repro:
1. Click the gear icon → land on `/settings`
2. Click any P/D/T/S letter in a sidebar folder
3. Click the Settings back arrow → expect landing page, get OpenSpec preview

### Bug 2 — Session-header back arrow is a no-op on cold loads

`packages/client/src/App.tsx:785`:

```tsx
onBack={isMobile ? () => navigate("/") : () => window.history.back()}
```

On cold load / hard refresh / deep link / post-server-switch (where `setWsUrl` clears state) at `/session/:id`, browser history has only one entry. `window.history.back()` is a silent browser-level no-op. The back arrow exists, the user clicks it, nothing happens. There is no fallback to `navigate("/")`.

Repro:
1. Hard-refresh on `/session/<id>`
2. Click the back arrow in `SessionHeader` → expect landing page, nothing happens

### Bug 3 — No coordinated back priority

Each overlay's back handler clears only its own state. When two overlays could be set simultaneously (e.g. `previewState` set, then user clicks an OpenSpec command from `MobileActionMenu` on desktop which sets `flowYamlPreview`), the JSX priority chain in App.tsx:884–895 picks the higher-priority one to render but the back handler of that one only clears its own state — the lower-priority one stays set in the background, ready to reappear on the next teardown, exactly like Bug 1's intermediate flash.

## What Changes

- **Add** a new pure helper `packages/client/src/lib/desktop-back.ts` exporting `selectDesktopBackTarget(state) → BackTarget` that mirrors the mobile `onBack` priority chain (overlays first, then routes, then `navigate("/")`).
- **Add** a new hook `packages/client/src/hooks/useDesktopBack.ts` that wires the helper to the live overlay setters + `navigate` and returns a single `goBack()` callback.
- **Replace** `App.tsx:785`'s `() => window.history.back()` with the hook's `goBack()`.
- **Modify** `useOpenSpecActions.handleReadArtifact` and `useContentViews.handleViewPiResourceFile` / `handleViewReadme` so that opening an overlay while `settingsMatch || tunnelSetupMatch` is true ALSO calls `navigate("/")`. The existing `clearAllContentViews?.()` choke point already exists in `handleReadArtifact`; we add `navigate` as a dep.
- **No mobile changes.** Mobile already has the priority switch at App.tsx:1370–1390 and continues to work.
- **No URL refactor.** Overlays stay in React state. We do not push them as URL params.

## Capabilities

### Modified Capabilities

- `url-routing`: the existing `Requirement: Back navigation button` is replaced with a stronger contract that the desktop session-header back button MUST reach a sensible destination on every click — never a silent no-op — and overlays MUST be popped before the URL is. A new requirement is added for sidebar-triggered overlays auto-closing the active URL-route view.

## Impact

- `packages/client/src/lib/desktop-back.ts` — new pure helper (~30 lines, fully unit-testable without React).
- `packages/client/src/hooks/useDesktopBack.ts` — new hook (~25 lines).
- `packages/client/src/App.tsx` — replace one inline arrow function (line 785) with the hook output; pass `navigate` to `useOpenSpecActions` / `useContentViews`.
- `packages/client/src/hooks/useOpenSpecActions.ts` — accept optional `navigate` + `settingsMatch`/`tunnelSetupMatch` in deps; close URL view before opening overlay.
- `packages/client/src/hooks/useContentViews.ts` — same shape change for `handleViewPiResourceFile` / `handleViewReadme`.
- 3 new unit tests (`desktop-back.test.ts`) covering the priority chain.
- 1 new integration test (`App.test.tsx` / a new `desktop-back.test.tsx`) covering the cold-load `/session/:id` → back → `/` scenario.
- 1 new integration test covering "settings open + click sidebar artifact → preview opens, settings closes."
- Spec delta in `openspec/specs/url-routing/spec.md` MODIFYING the back-button requirement and ADDING the sidebar-overlay-auto-closes-URL-view requirement.
- **No breaking change.** Mobile path untouched. URL surface unchanged. Existing keyboard / browser-back / forward behaviour unchanged. Settings, Tunnel, and the eight overlays continue to render in the same DOM positions.
