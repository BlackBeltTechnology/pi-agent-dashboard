## Why

Loopback dev-server URLs surface on two chat surfaces: (1) assistant/user prose via `MarkdownContent`, and (2) the `serve_mockup` MCP result card, which renders through `GenericToolRenderer` → `LinkifiedText` → `UrlLink` (e.g. `http://localhost:50452/instructions-tree-resize.html`). Both anchor renderers classify every loopback URL as *external* (its origin differs from the dashboard origin), so a click takes the `target="_blank"` branch and steals a system-browser tab. The dashboard already ships a loopback-safe internal preview — `LiveServerViewer` + the SSRF-checked `/live/<id>/` server proxy + a sandboxed iframe — opened today via a `live-server` viewer tab (`dispatch openFile` + `updateSplit`), but neither anchor renderer routes into it. The user has to leave the dashboard to view their own dev server.

The goal: *a loopback URL clicked in a chat message OR a `serve_mockup`/tool-output result opens in the internal split viewer by default, with a modifier-click escape hatch back to the system browser.*

## What Changes

- **Loopback detection helper.** Add a pure `isLoopbackUrl(href)` beside `LOOPBACK_HOSTS` in `packages/shared/src/live-server.ts` — true only for `http(s)://{localhost,127.0.0.1,::1}[:port]/…`. Reuses the existing SSRF allowlist so the client and the `/live` proxy share one definition of "loopback".
- **Open-live-viewer plumbing (DRY).** Add a context method `openLiveTarget(url)` to `SplitWorkspaceContext` (mirrors the existing `openInSplit`) that runs `dispatch({type:"openFile", path:"live:"+url, viewer:"live-server"})` + `updateSplit({open:true})` — the SAME path `EditorPane` already uses to open the live viewer. NOTE: `openInSplit` is deliberately NOT reused — it derives the viewer from `fileKind` and cannot produce `live-server`. Then add one client hook `useLoopbackLinkOpen()` returning an `onClick(e, href)` that both anchor renderers call: on a plain primary-button click of a loopback href it `preventDefault`s and calls `openLiveTarget(href)` (full URL, path + query preserved). Modifier/middle-click and non-loopback hrefs are no-ops. The hook reads context via `useOptionalSplitWorkspace()` (returns `null` outside the provider, never throws), so a renderer mounted outside the split workspace degrades to the native `target="_blank"`.
- **Surface 1 — chat prose (`MarkdownContent.a()`).** Wire the shared handler into the loopback branch.
- **Surface 2 — tool output (`UrlLink`, used by `LinkifiedText`/`GenericToolRenderer`, i.e. the `serve_mockup` result card).** Wire the same shared handler. The LAN URL `serve_mockup` also prints is non-loopback and keeps `target="_blank"`. All other links — external, fragment, same-origin, and **modifier/middle-click on a loopback link** — keep today's behavior exactly.
- **`LiveServerViewer` auto-launch.** The viewer already receives `ViewerProps.path` but ignores it, booting to its target picker. When `path` encodes a concrete loopback target (a `live:<url>` sentinel), parse it and `startLiveServer` immediately instead of showing the picker. The picker entry point (`live:preview`) is unchanged.
- **System-browser escape from inside the viewer.** Already present — the viewer header's `Open ↗` anchor (`target="_blank"`) hands the proxied URL to the system browser. No new work; the spec pins it as a requirement so it can't regress.

**Out of scope:** private-LAN / `.local` targets (the `/live` proxy deliberately refuses non-loopback hosts to avoid becoming an SSRF proxy — unchanged; the LAN URL from `serve_mockup` stays a browser link); any change to the SSRF allowlist, the proxy, or the iframe sandbox.

## Capabilities

### Modified Capabilities
- `chat-markdown-rendering`: loopback URLs in assistant/user markdown route to the internal `live-server` split viewer on plain left-click; modifier/middle-click and all non-loopback links keep existing anchor behavior.
- `tool-output-linkification`: loopback URLs rendered by `UrlLink` (tool-result / `serve_mockup` output) route to the `live-server` split viewer on plain left-click via the same shared handler; the LAN URL and all non-loopback links keep `target="_blank"`.
- `live-server-preview`: `LiveServerViewer` accepts a preset target via `ViewerProps.path` and auto-launches it; the in-viewer system-browser escape is a pinned requirement.

## Impact

- Code (shared): `live-server.ts` — add `isLoopbackUrl(href)` helper + tests.
- Code (client): new shared `useLoopbackLinkOpen()` hook; `components/MarkdownContent.tsx` (loopback branch in `a()`), `components/tool-renderers/UrlLink.tsx` (loopback branch), `components/editor-pane/LiveServerViewer.tsx` (parse `live:<url>` path → auto-launch), plus their `__tests__`.
- Behavior: loopback chat links preview inline in the split; ⌘/ctrl/middle-click still opens a browser tab; non-loopback links unchanged.
- Security: no change to the SSRF allowlist, `/live` proxy, or iframe sandbox — loopback-only targets still gate through the existing server-side `validateLiveTarget`. The client `isLoopbackUrl` check is a UX router, not a trust boundary; the server proxy remains the enforcement point.
- No protocol changes, no new config keys, no migration.

## Discipline Skills

- `security-hardening` — the change routes user/agent-supplied URLs into an embeddable viewer; verify the loopback classifier can't be tricked (credential-in-host, `0.0.0.0`, IPv4-mapped IPv6, DNS-rebinding-style hosts) into treating a non-loopback URL as loopback, and confirm the server `validateLiveTarget` remains the real gate.
