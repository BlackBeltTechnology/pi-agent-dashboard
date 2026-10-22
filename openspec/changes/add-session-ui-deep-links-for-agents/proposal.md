## Why

An external agent (Claude Code in the Claude desktop app) drives the dashboard through the `pi-dashboard-control` skill (`packages/claude-plugin/skills/pi-dashboard-control/`). It has a built-in browser pane and wants to show the user one session's view. Opening `BASE/session/<full-id>` already renders that session's chat. Nothing tells the agent this, so it cannot find it.

Three problems block the agent today:

- **Not discoverable.** The skill and its API reference document REST only. No UI route is listed, and `GET /api/sessions` returns no link, so the agent must build URLs itself. Behind a tunnel it gets the base wrong.
- **Silent failure on a bad id.** A truncated or prefix id (`/session/01a16086`) is redirected to `/` ("Pick a session on the left") with no error (`App.tsx:1464-1473`). A full id of an older ended session that `GET /api/sessions` lists but the client's windowed snapshot does not hold is redirected the same way. The agent cannot tell its link was wrong, and the user sees an unrelated screen.
- **Too wide for a pane.** At browser-pane widths of 768 px and up, the desktop shell shows the resizable session sidebar, which takes about half the pane.

## What Changes

1. **Skill docs (main deliverable).**
   - Add a "View a session in the browser" section to `pi-dashboard-control/SKILL.md`. Use the full `id` (or `uiUrl`) from `GET /api/sessions`. Open `BASE/session/<id>` (or `/diff`) in the agent's browser, with `?embed=1` for a compact pane.
   - Document how `encodedCwd` is encoded (base64url of the UTF-8 path, no padding) for folder and OpenSpec routes.
   - When auth is on, the user signs in inside the browser pane. Tokens never go into a URL.
   - Add a "UI routes" section to the source reference `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md`, then regenerate the derived plugin copy with `node scripts/sync-claude-plugin.mjs`.
2. **API.** Each session row in `GET /api/sessions` gains `uiUrl` and `diffUrl`: absolute URLs on the origin the caller actually used.
   - The base is the configured public, tunnel or redirect origin whose host matches the request.
   - Otherwise it is the admitted `Host`.
   - Otherwise it is the redirect base.
   - Forwarded headers only select among configured origins.
   - A new `SessionListItem` type carries the fields, so `DashboardSession` (the WebSocket shape) is unchanged.
   - A shared pure helper `sessionUiPath(id, view?)` builds the path, with the id passed through `encodeURIComponent`.
   - An optional `?id=<id-or-prefix>` filter (case-insensitive; prefix needs at least 8 characters) lets the client look up ids outside its snapshot window.
3. **Client: session not found.** Resolution runs after the connection's first `sessions_snapshot` (today it uses `sessions.size > 0`).
   - On a miss, the client asks the server (`GET /api/sessions?id=`) and merges the hits.
   - An id the server does not know renders an inline "Session not found" state, replacing the silent redirect.
   - A session that was held and is then archived, or that is missing after a server switch, still redirects home, as today.
   - A resolved id stays selected across reconnects.
   - The archived read-only exception is kept.
   - A unique prefix of at least 8 characters (case-insensitive), or a mis-cased full id, resolves to one canonical id. Subscription and selection only ever use that id. The URL is replaced with the full id, and any `/diff` / `/editor` suffix and the query string are kept.
   - An ambiguous prefix lists the matching sessions as links.
4. **Client: embed mode.** `?embed=1` on any client route turns embed mode on for the tab. The viewport's own shell (desktop or mobile) stays; only the session list goes.
   - Desktop: the sidebar, hamburger and overlay list are removed.
   - Mobile: the list panel shows a short embed message.
   - Session views, settings, route-backed overlays, plugin overlay routes, banners and toasts are unchanged.
   - The setting persists in `sessionStorage`. `?embed=0` clears it.
   - An "Open full dashboard" control leaves embed mode and keeps the other query parameters.
   - Embed mode reuses the in-app session detail (`ChatView` and its siblings) through the existing `renderSessionDetail` path. It does not consume the `chat-embed` barrel, which is a workspace-import contract for sibling packages (docs/embedding-chat-view.md).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `url-routing`: unknown session id shows a not-found state instead of redirecting (after a server lookup); canonical, case-insensitive, unique-prefix resolution; embed-mode toggle and layout requirements.
- `session-listing`: sessions merged by the deep-link lookup are lookup-only and do not shift the ended-session paging offset.
- `app-decomposition`: "Layout component extraction" gains embed-mode scenarios (desktop sidebar omitted; mobile list panel shows the embed message).
- `dashboard-server`: `GET /api/sessions` rows carry `uiUrl` / `diffUrl` from the origin the caller used; new optional `id` filter.
- `claude-code-plugin`: the control skill documents viewing a session in the browser (full id, embed, encodedCwd, no tokens in URLs).
- `pi-dashboard-skill`: the API reference documents the client UI routes (source of the derived plugin reference).

## Impact

- **Docs.** `packages/claude-plugin/skills/pi-dashboard-control/SKILL.md`; `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md` (source); derived `packages/claude-plugin/.../references/api-reference.md`; both `api-reference.agent.md` sidecars; `packages/claude-plugin/AGENTS.md` row.
- **Server.** `packages/server/src/routes/session-routes.ts` (`GET /api/sessions` mapping); new pure `packages/server/src/routes/ui-link-base.ts` (uses `isHostAdmitted`, live tunnel origins, `resolvePublicBaseUrls`, `resolveRedirectBase`).
- **Shared.** `sessionUiPath` helper in `packages/shared/src/`. `SessionListItem` plus a retyped `ListSessionsResponse` in `packages/shared/src/rest-api.ts`.
- **Client.** `packages/client/src/App.tsx`: the redirect effect becomes the D3 resolution hook with a sticky canonical id used by every raw-id reader, and the embed flag in both shell branches. Plus `ShellContent.tsx` (`sessionRoute` prop, not-found and pending arms), a new `SessionNotFound` component, the `useEmbedMode` hook, and i18n keys (en / hu / zh-CN).
- No new dependencies. No WebSocket protocol change. The SPA fallback already serves `index.html` for `/session/*`, so no server routing change is needed.

### Related changes (checked for overlap)

- `add-ntfy-push-transport` (open): defines push `absoluteUrl = <base>/session/<encodeURIComponent(id)>`.
  - Same path shape, so it can reuse `sessionUiPath`; whichever lands second adopts it.
  - Its base precedence is deliberately different: first public base, else tunnel, else no URL, and not request-derived. So the D1 base resolver is not shared.
  - No spec conflict (different capability).
- `add-persistent-onboarding-card` (open): relies on navigation to `/session/:id` unmounting the checklist through the `ShellContent` session branch. Unaffected, because the not-found state renders only for ids absent from a loaded snapshot.
- `add-plugin-capability-routes` (open): its "deep link serves the shell" covers `/apps/*`. No overlap with `/session/*`.
- Archived `2026-07-09-add-embeddable-chat-view`: a workspace-import barrel, not a URL. This change does not touch it.
- Archived `2026-07-22-add-embed-session-lifecycle`: "embed" there means ephemeral spawn policy. Unrelated despite the name.
- Archived `2026-03-25-url-routing`: origin of the "unknown id → `/`" redirect, which this change modifies.

## Discipline Skills

- `security-hardening`: `uiUrl` reflects request-derived host data back to the caller. The base comes only from configured or known origins (public base URLs, the live tunnel), or from the Host header the host-admission guard already admitted. Forwarded headers are never trusted blindly. Docs forbid tokens in URLs, and a test confirms the login redirect carries `?embed=1` without credentials.
- `doubt-driven-review`: `uiUrl` / `diffUrl` become a public REST field consumed by external agents (hard to retract), and embed mode is sticky per tab. Review both decisions (design D1, D5) before implementation.
