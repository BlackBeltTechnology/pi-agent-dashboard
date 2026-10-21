# Proposal: improve-canvas-html-and-url-ux

## Why

Agents produce HTML mockups, reports and dev servers and point the canvas at them, but the result is often broken or unusable:

- A `canvas` tool call shows `{"ok":true}` in chat, with nothing to click.
- A non-loopback canvas URL (for example the LAN URL `serve_mockup` prints) renders as an "Open in new tab" link card instead of the page.
- Once a page is framed, the user cannot move to a sibling HTML file. The viewer header shows a read-only `/live/<id>/` path.
- The live-viewer target list fills up with dead ephemeral ports.
- Declaring the same URL again does not reload the open tab.
- Local `.html` files (chat link, tree, canvas `kind:file`) render through `srcdoc` with no base URL and no scripts. Relative CSS, JS, images and CDN styles all break, so a typical mockup renders unstyled.

## What Changes

- **Canvas tool card.**
  - A built-in `CanvasToolRenderer` for the `canvas` tool shows the title, a kind icon and the target (file path, URL or `:port`).
  - Only the card from the call that produced the current canvas target or chip is a link. Clicking it is an operator open in the foreground.
  - Earlier cards, including ones that re-declared the same target, render plain.
  - `{ok:false,error}` renders as an error line.
- **One open path.** Canvas auto-open, the chips and the canvas card share one target-opening hook, which moves out of `CanvasDriver`. HTML files keep auto-opening, as static targets.
- **HTML files are served, not `srcdoc`'d.** A local `.html` file opens as a **static target** in the live-server viewer:
  - It is a new target kind of the existing live-server manager, kept in memory and never persisted, under the existing `/live/<id>/~c/<token>/` capability path.
  - It needs no extra process or port.
  - Its root is the nearest ancestor containing `index.html` or `package.json`, capped at the session cwd. Without such a marker, or for a granted file outside the cwd, the root is the file's own directory.
  - Only web asset types inside the root are served. Dotfiles, `node_modules` and secret-like names return 404.
  - Every static request must carry the target's capability, even from local callers, and is re-checked against file access (a revoked grant stops serving at once). Responses are `no-store`.
  - Relative assets resolve. Scripts run in the opaque-origin sandbox, and a CSP `sandbox` response header keeps isolation even when the page is opened directly.
- **"Static (no scripts)" toggle** in the viewer header re-renders the document with an empty sandbox.
- **No dashboard-spawned dev server.** A localhost origin is trusted by the dashboard's CORS and mutation gate, so agent HTML opened there could act as the operator. Pages with root-absolute paths get a hint to run `serve_mockup` or a dev server and open its localhost URL.
- **Viewer header becomes an address bar.**
  - Editing the path within the same target re-points the frame after segment validation, with no new target.
  - A new loopback `host:port` goes through the existing confirm and `startLiveServer` gate.
  - A ↻ reload control is added.
  - When the canvas `version` bumps for the same target, a background tab reloads. The active tab shows an "Updated by the agent · Reload" notice instead, so the reader is not disturbed.
- **Target picker shows what is live.**
  - The active canvas target comes first, then targets the user added.
  - Automatic and pre-existing entries collapse under "Older targets (N)" with "Clear all" (confirmed).
  - Each entry gets a remove ✕.
  - Entries the user adds from now on stay manual across restarts.
- **Egress and scripts for live previews are provenance-based and fail-closed.** This covers static HTML and agent-declared localhost servers.
  - An operator open (tree click, overlay click, canvas chip tap, canvas card click) keeps open egress with scripts.
  - Every other open is restricted. That includes canvas auto-open, agent preview cards and undeclared surfaces. A capability minted without a policy is also restricted.
  - Restricted pages may load and fetch only their own capability prefix (including the live-reload socket) plus granted origins. They cannot load dashboard resources, submit forms, rebase, nest frames or open popups.
  - **Scripts on restricted opens depend on exposure.** Scripts run when the dashboard is reachable only from this machine. That means a loopback bind, no tunnel, no public base URL, no TLS listener, and no forwarded requests seen. Otherwise the server refuses scripts unless the operator clicks "Run scripts". Exposure changes revoke scripted restricted previews.
  - Capabilities minted by a local operator work only from local requests. Static capabilities live 10 min idle / 2 h absolute.
- **Live-server hardening.**
  - Browser-originated `/live/` requests (`Origin: null` or any `Sec-Fetch-*`) need a capability. Today an opaque frame on the operator's machine can reach any port target without one.
  - Agent-declared localhost URLs no longer auto-open. Like `kind:"server"` declares, they show the confirm chip (no fetch before the tap). The tap opens an in-memory, restricted preset target that is never persisted. Ports the dashboard itself listens on are refused.
  - Preset and static targets are capped per session (16 / 32, least recently used evicted). A mounted viewer keeps its capability alive.
  - Every capability response, including port targets, carries a CSP `sandbox` header.
  - For a local operator, "Open ↗" on a port target the user added opens the real localhost URL. Agent-declared and static targets always open the sandboxed capability URL.
- **CDN enablement.**
  - The server scans served HTML and linked CSS for external origins. A CSP report endpoint under the capability path catches origins loaded at runtime.
  - The viewer shows a non-modal banner listing blocked origins, labelled by source, with "Allow once" (this viewer) and "Allow for this project".
  - The project option, on the operator's click only and when access prompts are enabled, records a pending request and raises the standard access-grant dialog on a new **preview-egress** plane. Grants persist in their own locked file and are reviewed and revoked on the Access page.
  - Egress state and allow-once are restricted to the minting principal, and allow-once applies per viewer.
  - Only canonical public `https` origins can be granted. Loopback, private, LAN and wildcard-loopback names and the dashboard's own origins are never grantable. Shared-hosting origins carry a warning.
- **Tool guidance.** The `canvas` tool guidelines and the `serve_mockup` result text tell the model to pass the localhost URL to `canvas`, never the LAN URL. The SSRF boundary is unchanged.
- **Behaviour change.** Local HTML previews now execute scripts, inside the opaque-origin sandbox. The `file-and-url-preview` requirement "HTML preview is sandboxed without script execution" is modified. The "Static (no scripts)" toggle restores script-free rendering.
- **Mockup:** `mockups/index.html` (in this change). It is an as-built vs. proposed board, S1–S7: tool card, viewer address bar, egress banner, rendered page, target picker, Access row, and the full composition.

## Capabilities

### New Capabilities

- `preview-egress-grants`: the provenance-based, fail-closed egress and script policy for served previews, exposure-dependent scripts on auto-open, origin detection (static scan + CSP reports), the blocked-origins banner, allow-once versus project grants, the `preview-egress` access plane and its ungrantable subjects.

### Modified Capabilities

- `live-server-preview`:
  - adds the static target kind (root resolution, capability on every request, web-asset allowlist, CSP `sandbox` header, no-scripts toggle);
  - the per-preview capability gains a fail-closed policy and shorter static lifetimes;
  - adds the editable address bar, reload on version bump, the active-first target picker with removal, and the root-absolute hint;
  - keeps "never auto-fetched from agent input" for port targets, routing agent-declared localhost URLs through the confirm chip ("Declared servers…" MODIFIED), and frames presets via validated capability paths ("auto-launches a preset target" MODIFIED);
  - adds the browser-capability rule, per-session target caps and capability keepalive.
- `file-and-url-preview`:
  - local `.html` previews open as provenance-aware live-server static targets, replacing the `srcdoc` + `allow-same-origin` no-script rule;
  - the `EmlPreview` comparison text is updated.
- `auto-canvas`:
  - an auto-opened HTML document gets the restricted egress policy instead of the blanket restrictive CSP;
  - a version bump never disturbs the active tab;
  - a loopback `kind:"url"` declare routes to the confirm chip instead of auto-opening;
  - the `canvas` declare guidance requires loopback URLs for local servers.
- `tool-renderers`: the registry maps `canvas` to `CanvasToolRenderer`, and only the card that produced the current target links to it, as an operator open.
- `mockup-loop-preview-and-capture`: the `serve_mockup` result tells the agent to pass the localhost URL to `canvas`.
- `access-settings-tab`: lists and revokes `preview-egress` grants per project.

## Impact

- **Client:**
  - `components/tool-renderers/` (new `CanvasToolRenderer`, `registry.ts`, `types.ts` ToolContext `canvas` field);
  - `components/canvas/CanvasDriver.tsx` (opener extracted);
  - `components/editor-pane/LiveServerViewer.tsx` (policy per tab, address bar, reload, picker, toggle, egress banner, hints);
  - `components/preview/HtmlPreview.tsx` (frames a static target);
  - `components/split/SplitWorkspaceContext.tsx`;
  - Access settings list.
- **Server:**
  - `live-server/live-server-manager.ts` (separate in-memory static map; port entries gain `addedBy`);
  - `live-server/live-server-proxy.ts` (static serving branch, CSP headers, report endpoint);
  - `live-server/live-capability.ts` (policy, static lifetimes, exposure revocation);
  - `routes/live-server-routes.ts` (static start, egress, allow-once, policy);
  - `access/planes.ts` (preview-egress plane);
  - `access/forbidden-subjects.ts`.
- **Shared:** `live-server.ts` target types, canonical origin helper, browser-protocol grant plane id.
- **Extension:** `canvas-tool.ts` guidelines. `packages/mockup-loop/src/extension.ts` result text.
- **Persistence:** existing persisted port targets seed as `addedBy:"legacy"`. Static and preset targets are never persisted. Preview-egress grants persist in `~/.pi/dashboard/preview-egress.json`. Rollback is a revert.
- **Compatibility:** tokenless browser access to `/live/` stops working. The active change `add-voice-assistant-dashboard-plugin` must use a capability path for its `audio-ingest` endpoint.

## Discipline Skills

- `security-hardening`: a new file-serving path for untrusted HTML with scripts, capability enforcement, dot-segment and encoding handling (`harden-path-matcher-vs-router`), the CSP design, and a new grantable egress plane.
- `doubt-driven-review`: the static target, relaxing the "never auto-fetched" rule to port targets only, exposure-gated scripts, and grantability rules.
- `observability-instrumentation`: the CSP report endpoint, and logging for static registration, exposure revocations and egress verdicts, all with capability redaction.
- `review-code`: before commit.
