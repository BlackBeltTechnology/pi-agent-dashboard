# Design — Improve Content Editor

## Context

Two viewer systems coexist and diverged:

```
  editor-pane/viewer-registry.ts        preview/*  (render-file-previews, archived)
  ─────────────────────────────         ────────────────────────────────────────
  monaco  image  pdf(<object>)          Monacoish  ImagePreview  PdfPreview(pdfjs)
  markdown  binary-warn                 MarkdownPreview  HtmlPreview(sandboxed)
                                         VideoPreview  YouTubePreview  AsciiDocPreview
                                         + MermaidBlock, dispatchPreview()
```

The editor-pane predates none of these — it was authored alongside them but wired its
own thin registry. The `file-and-url-preview` spec already defines
`dispatchPreview(target): "markdown"|"asciidoc"|"html"|"pdf"|"video"|"image"|"youtube"|"fallback"`.
This change **reconciles** the two rather than growing a third.

## Decisions

### D1 — Reuse `preview/*` renderers; keep the editor-pane registry as the adapter
The editor-pane keeps its `ViewerKind` registry (tabs, scroll-to-line, theme, refresh
plumbing depend on it) but its entries delegate to `preview/*` components where one
exists. PDF → `PdfPreview`; HTML → `HtmlPreview`; video → `VideoPreview`; image →
`ImagePreview`; mermaid → `MermaidBlock`. Audio has no `preview/*` component yet → add
`AudioPreview` (`<audio controls>` + waveform-optional) in `preview/` so both systems
share it. Rationale: one renderer per kind, no third copy; `PdfPreview` also fixes #3
for free (pdfjs canvas, no native plugin).

### D2 — #1 fix at the source: one tree-listing endpoint, not a two-call merge
The `/api/file`(names) + `/api/browse`(dirs, hidden-stripped) merge is the root cause
and also double round-trips per expansion. Add `GET /api/file/tree?cwd=&path=` →
`{ entries: { name: string; isDir: boolean }[] }` from a single `readdir(..., { withFileTypes:true })`,
hidden entries included, same security gate as `/api/file`. `EditorFileTree` consumes
this. `browse.ts::listDirectories` is left untouched (the workspace picker relies on
its hidden-stripping + `.git`/`.pi` detection).

### D3 — #7 fix: swap the hook, don't rebuild theming
`MonacoBuffer` and `MarkdownEditor` change `useTheme()` → `useThemeContext()`. Both are
already mounted under `ThemeProvider`. No new state, no new effect — the existing
recolor `useEffect` fires correctly once the values are shared. Add a regression test:
provider `setThemeName` → Monaco `defineTheme`/`setTheme` called.

### D4 — #4 markdown edit: reuse the write guard, optimistic concurrency
Preview/Edit is a per-tab local mode. Edit mounts `MarkdownEditor` (controlled).
Save → `POST /api/file/write` (existing `isWritableMdTarget` guard, mtime optimistic
check → 409 on conflict → surface the existing changed-on-disk banner). Edit affordance
shows only when `fileKind(path).editable` (`.md`/`.mdx`). `.markdown` stays read-only.

### D5 — live-server-preview: proxy + isolate, never trust a URL
Mirror `editor-view`'s reverse-proxy: the server exposes a proxied path; the client
iframes it. Constraints (all mandatory — this is the SSRF/origin boundary):

```
   user picks target ──▶ server validates ──▶ proxy path ──▶ iframe (isolated origin)
                          │
                          ├─ host ∈ {127.0.0.1, ::1, localhost}      (loopback only)
                          ├─ port ∈ user-confirmed allowlist         (no free-form scan)
                          └─ reject everything else → SSRF guard
```

- **Loopback only.** No remote hosts (that's `known-servers`, a different feature —
  other *dashboards*, not arbitrary web apps). Blocks cloud-metadata / internal-service
  SSRF.
- **Explicit allowlist.** User adds a dev-server target (`label`, `port`) once; free-form
  URL entry is confirmed, never auto-fetched from tree/agent input.
- **Origin isolation.** Proxied content served under a path the dashboard treats as a
  distinct origin (or `sandbox` without `allow-same-origin` where the app tolerates it),
  so the embedded app cannot read the dashboard's `localStorage`/JWT or call its APIs.
- **Framing reality.** Only self-proxied loopback content is embeddable; external sites
  (`X-Frame-Options`/`frame-ancestors`) are out of scope and shown via
  `FallbackPreview` "open in new tab".
- **Mixed content.** When the dashboard is HTTPS (zrok), the proxy terminates so the
  iframe loads same-scheme; no `http://localhost` embedded directly.

### D7 — live-server isolation: same-origin path proxy + sandbox WITHOUT `allow-same-origin`
Resolves open question 1. The embedded app is untrusted (unlike code-server), and remote
access (zrok) tunnels **exactly one port**, so origin-by-port (A) and origin-by-subdomain
(B) both break remote use. Chosen mechanism:

- **Proxy on the main origin** at a path (`/live/<id>/`), mirroring `editor-manager`'s
  `/editor/<id>/`. Single origin → works locally AND over zrok.
- **Embed with `sandbox="allow-scripts"` and NO `allow-same-origin`.** The browser gives
  the framed document a **unique opaque origin**: its scripts run (real app), but it
  cannot read the dashboard's `localStorage`/cookies and cannot make same-origin
  credentialed calls to `/api/*`. This is the security-critical distinction from
  `editor-view` (which is same-origin, no sandbox, because code-server is trusted).
  Never combine `allow-scripts` + `allow-same-origin` (that lets content drop its own
  sandbox).
- **CORS MUST reject `Origin: null`.** An opaque-origin document sends `Origin: null`;
  the dashboard CORS (today allows localhost + `*.share.zrok.io`) MUST NOT echo `null`,
  so the sandboxed app cannot call dashboard APIs even cross-origin.

Accepted limitation: because the app runs in an opaque origin, it cannot persist its OWN
cookies/localStorage/IndexedDB. Acceptable for the stated use case (previewing mockups /
stateless HMR dev servers). A future opt-in "trusted local" full-fidelity mode (separate
loopback port, no sandbox, unavailable over zrok) can be added later if a stateful local
app needs it — out of scope here.

```
   dev server 127.0.0.1:5173 ──proxy──▶ /live/<id>/ (main origin, tunnelable)
                                          │
                                          ▼
              <iframe sandbox="allow-scripts">  ← opaque origin
              app runs · CANNOT read dashboard token / call its APIs
```

### D6 — baseline CSP (defense in depth)
There is **no CSP anywhere** in the server today (verified). Add a baseline response
header so that even if HTML were ever loaded in-origin, script execution and
`frame-ancestors` are constrained. Scope carefully: the Vite dev proxy, code-server
iframe, and model-proxy must still function — CSP is added in report-then-enforce steps
with an allowlist for the existing proxied paths.

## Risks / tradeoffs

- Adopting `preview/*` risks subtle behaviour drift (scroll-to-line only matters for
  Monaco; media viewers ignore `line`). Keep the registry adapter thin; pass `line`
  only to Monaco.
- CSP is the highest-blast-radius item — it can break the Vite proxy / code-server /
  OAuth callback windows. Gated behind its own phase, report-only first, e2e verified.
- `AudioPreview` is genuinely new (no prior component). Small, but needs its own tests.

## Open questions

1. ~~Origin isolation mechanism for D5~~ **RESOLVED (D7):** same-origin path proxy +
   `sandbox` without `allow-same-origin` (opaque origin). Separate-port/subdomain rejected
   because zrok tunnels a single port. CORS must reject `Origin: null`.
2. ~~**CSP rollout**~~ **RESOLVED:** shipped in this change (`csp.ts`). Report-only is the
   DEFAULT (`PI_DASHBOARD_CSP=report`); `enforce` + `off` are env-selectable. The hook
   skips proxied prefixes (`/editor/`, `/live/`). `tests/e2e/csp.spec.ts` verifies the
   header is present and the shell renders with zero CSP violations in the Docker
   harness. Flipping the production DEFAULT to enforce is deferred until code-server /
   OAuth-window e2e coverage lands (user decision) — enforce stays opt-in for now.
3. ~~**`file-and-url-preview` convergence**~~ **RESOLVED:** kept the editor-pane
   `ViewerKind` registry as a thin adapter that delegates to `preview/*` renderers (no
   third copy); the `dispatchPreview` enum was NOT retired. Both systems now share
   `AudioPreview` (wired into `dispatchPreview`+`PreviewCard` AND the editor-pane
   registry). Revisit full delegation later if the enums fully align.
