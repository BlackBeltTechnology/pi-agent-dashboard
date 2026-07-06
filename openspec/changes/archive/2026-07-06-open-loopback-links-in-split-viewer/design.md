## Context

The internal loopback-preview stack already exists and is load-bearing:

```
chat markdown  ──MarkdownContent.a()──┐
 serve_mockup card ──UrlLink─────────┤──►  target="_blank"  ──►  SYSTEM BROWSER   (today, for loopback)
 (GenericToolRenderer/LinkifiedText) │                                            ▲ steals a tab
tree click / file-link ──openInSplit──►  EditorPane tab ──► viewerRegistry["live-server"]
                                                                    │
                                                              LiveServerViewer
                                                                    │ startLiveServer(host,port)
                                                                    ▼
                                                  server /live/<id>/  (validateLiveTarget = loopback-only SSRF gate)
                                                                    │
                                                              sandboxed iframe (opaque origin, no token access)
```

This change adds one shared loopback branch to BOTH anchor renderers (`MarkdownContent.a()` and `UrlLink`) that opens the `live-server` viewer, and teaches `LiveServerViewer` to auto-launch a preset target instead of always showing its picker.

**Verified mechanism (doubt-review corrected).** `openInSplit(relPath, line?)` is NOT the right funnel — it takes no viewer argument and derives the viewer from `fileKind(absOf(cwd, relPath))`, which can never yield `live-server`. The live viewer is opened exactly one way today (in `EditorPane`): `dispatch({ type: "openFile", path: "live:preview", viewer: "live-server" })` followed by `updateSplit({ open: true })`. This change reuses that path. The `openFile` reducer is idempotent by `path` ("activate the existing tab, never duplicate"), so the same URL reuses its tab and distinct URLs get distinct tabs — no de-dup logic needed.

## Goals / Non-Goals

**Goals**
- Plain left-click on a loopback URL in a chat message opens it in the internal `live-server` split viewer.
- The clicked URL's path + query survive into the proxied preview (not collapsed to origin `/`).
- ⌘/ctrl/shift/alt-click and middle-click on a loopback link still open a system-browser tab.
- Non-loopback / fragment / same-origin links behave exactly as today.
- From inside the viewer, one click re-opens the target in the system browser.

**Non-Goals**
- Private-LAN / `.local` targets (SSRF gate unchanged).
- Tool-output linkification (`UrlLink`/`LinkifiedText`) and the `serve_mockup` result card.
- Any change to the SSRF allowlist, the `/live` proxy, or the iframe sandbox.

## Decisions

### D1 — `isLoopbackUrl` lives beside `LOOPBACK_HOSTS` (shared)
One definition of "loopback" for both the client router and the server proxy. The helper parses `href` with `new URL()`, requires an `http(s):` protocol, and checks `LOOPBACK_HOSTS.has(hostname)`. Anything unparseable, non-http(s), or non-loopback → `false`. This keeps the classifier honest against `security-hardening` edge cases: a credentialed host (`http://localhost@evil.com/`) parses to `hostname = "evil.com"` → correctly `false`; `0.0.0.0` and IPv4-mapped IPv6 are **not** in `LOOPBACK_HOSTS` → `false` (they'd be refused by the server anyway).

### D2 — Client check is a router, not a trust boundary
`isLoopbackUrl` only decides *which UI path* a click takes. The actual embed still flows through `startLiveServer` → server `validateLiveTarget`, which is the real SSRF gate and the sole trust boundary. A mis-classification can at worst send a non-loopback URL to a proxy call that the server rejects (viewer shows its existing error state) — it can never embed a non-loopback origin. Verified (task 5.1): credential-in-host, `0.0.0.0`, IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`), trailing-dot (`localhost.`), suffix trick (`127.0.0.1.evil.com`), and unicode/punycode spoofs all classify `false`; only literal `localhost`/`127.0.0.1`/`::1` (case-insensitive, brackets stripped) classify `true`.

### D3 — Preset target carried via a `live:<url>` path sentinel
`openInSplit` and the tab model key on a `path` string; the `live-server` viewer already receives it as `ViewerProps.path`. Encode the concrete target as `live:<full-url>` (e.g. `live:http://localhost:50452/instructions-tree-resize.html`). `LiveServerViewer` branches:
- `path === "live:preview"` (or no url payload) → today's picker (unchanged).
- `path` starts with `live:http` → parse host/port, `startLiveServer`, and preserve the **remaining path+query** so the iframe loads the deep link, not the origin root.

Deep-path preservation is the one implementation risk: `startLiveServer` returns a `/live/<id>/` root mount; the viewer must append the original `pathname + search` when building the iframe `src`. A test pins this (`/instructions-tree-resize.html?x=1` must appear in the iframe src).

### D3b — One shared click handler + a context method (DRY, doubt-review corrected)
The loopback-detect + modifier-guard + open-live-viewer logic is identical for `MarkdownContent.a()` and `UrlLink`. Two pieces:

1. **Context method `openLiveTarget(url: string)`** added to `SplitWorkspaceContext`, mirroring `openInSplit`. It runs `dispatch({ type: "openFile", path: "live:" + url, viewer: "live-server" })` + `updateSplit({ open: true })`. Keeping the pane-dispatch inside the context (where `dispatch`/`updateSplit` live) is symmetric with `openInSplit` and unit-testable without a renderer.
2. **Client hook `useLoopbackLinkOpen()`** returns an `onClick(e, href)`. It reads the context via **`useOptionalSplitWorkspace()`** (returns `null` outside the provider — NOT `useSplitWorkspace()`, which **throws**). On a plain primary-button click of a loopback href WHEN a context is present → `e.preventDefault()` + `ctx.openLiveTarget(href)`. When the context is `null` (a renderer mounted outside the split workspace) → no-op, and the native anchor's `target="_blank"` takes over (graceful browser fallback, no crash).

`serve_mockup` prints a loopback URL AND a LAN URL; only the loopback one satisfies `isLoopbackUrl`, so the LAN link is untouched.

### D4 — Modifier/middle-click fall-through
The loopback branch fires only for a plain primary-button click with no modifier keys. `e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0` → do NOT `preventDefault`; let the native anchor (`target="_blank"`) open a browser tab. This preserves the universal "modifier-click = new tab" affordance and keeps a devtools escape hatch.

## Risks / Trade-offs

- **Deep-path drop (D3):** if the viewer forgets to append `pathname+search`, users land on the app root instead of the linked page. Mitigated by an explicit test.
- **Click routing inside markdown:** the anchor may be nested (`[![]()]()`); the handler must not fight existing image/link stop-propagation. Reuse the existing `a()` structure, add only the loopback onClick guard.
- **Loopback-that-serves-https:** `https://localhost:*` is included by D1; the proxy already handles it. No special-case.
