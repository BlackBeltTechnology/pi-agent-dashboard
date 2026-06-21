## Why

The per-folder "View README.md" button in the sidebar (and its whole supporting chain — overlay route, fetch hook, server endpoint) is being retired. It adds a per-cwd `/api/readme?check=1` probe fired for every unique directory on every session-list render, an extra shell overlay route, and a dedicated fetch hook — all to surface a project's README, which users can already open via the editor / file browser. Removing it shrinks the sidebar surface, drops the probe traffic, and deletes dead routing.

This is scoped to **Candidate A — the project README button**. The npm **package** README dialog (`PackageReadmeDialog`, `fetchReadme`) is unrelated and stays.

## What Changes

- Remove the `View README.md` button (`data-testid="view-readme-btn"`) from the pinned-folder header in `SessionList.tsx`, along with the `onViewReadme` prop and the `readmeDirs` probe `useEffect`.
- Remove the `/folder/:encodedCwd/readme` overlay route, the `ReadmePreviewRoute` component, and all `readmeMatch` / `readmeCwd` plumbing from `App.tsx`.
- Remove `handleViewReadme` + `buildReadmeUrl` from `useContentViews.ts`; delete `buildReadmeUrl` from `route-builders.ts`; drop the `readme` branch from `back-target.ts`.
- Delete the `useReadmeFetch.ts` hook entirely.
- Remove the `GET /api/readme` endpoint from `file-routes.ts` (server).
- Update/remove affected tests (`useContentViews.test.ts`, `route-builders.test.ts`, `back-target.test.ts`).
- No replacement UI — README access remains available through the editor and filesystem browser.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `url-routing`: REMOVE the "README preview route" requirement; drop `/folder/:cwd/readme` from the depth-2 back-target overlay list and from the "Sidebar interactions push onto browser history" action list.
- `sidebar-folder-header`: drop the "readme button" from the content-column layout and the stop-propagation control list.

## Impact

- `packages/client/src/components/SessionList.tsx` — remove `onViewReadme` prop, `readmeDirs` state + probe effect, the readme `<button>`.
- `packages/client/src/App.tsx` — remove `useReadmeFetch` import, `ReadmePreviewRoute`, `readmeMatch`/`readmeParams`/`readmeCwd`, `hasShellOverlayRoute` member, `handleViewReadme` wiring, `onViewReadme` prop, 3 render branches.
- `packages/client/src/hooks/useContentViews.ts` — remove `handleViewReadme` + `buildReadmeUrl` import.
- `packages/client/src/hooks/useReadmeFetch.ts` — DELETE file.
- `packages/client/src/lib/route-builders.ts` — remove `buildReadmeUrl`.
- `packages/client/src/lib/back-target.ts` — drop `readme` from depth-2 overlay branch.
- `packages/server/src/routes/file-routes.ts` — remove `GET /api/readme` route.
- Tests: `hooks/__tests__/useContentViews.test.ts`, `lib/__tests__/route-builders.test.ts`, `lib/__tests__/back-target.test.ts`.
- No protocol or dependency changes. Package README dialog untouched.
