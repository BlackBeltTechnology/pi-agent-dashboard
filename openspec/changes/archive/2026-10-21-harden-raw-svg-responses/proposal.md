## Why

`/api/file/raw` serves `.svg` inline (`packages/server/src/routes/file-routes.ts:1233-1236`) under a report-only default dashboard CSP (`resolveCspMode`, `packages/server/src/auth/csp.ts:55-58`). Opened directly in a browser tab, a script-bearing SVG from the workspace runs with the dashboard's origin. `extend-craft-web-to-all-apps` added a script filter for SVGs that craft-web frames WRITE (D7), but any other way an SVG reaches the workspace (the agent, git, a download) is unfiltered. The same applies to agent-written SVG under an artifact root, which the route also admits (`agent-artifact-serving`). Raised as task 6.2 of that change.

The same route also serves `.html` / `.htm` inline as `text/html` (`packages/server/src/lib/mime-types.ts`), the same hole with a bigger blast radius. The HTML preview never navigates to the raw URL (it fetches the bytes into a sandboxed `srcdoc` iframe), so it does not need the response to be renderable in the dashboard origin.

## What Changes

- Serve scriptable media types (today `.svg`, `.html`, `.htm`, decided on the served `Content-Type`) from `/api/file/raw` with an enforced `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'` and `X-Content-Type-Options: nosniff`, on every admission path, on both 200 and 206 responses, and in every dashboard CSP mode.
- A directly opened SVG/HTML file then renders in an opaque origin with no script, so it cannot read dashboard cookies/storage or call the dashboard API as the user.
- `<img>` SVG previews, the `fetch`-based HTML preview, and every other content type are unchanged.
- The baseline dashboard CSP hook keeps its rule of adding a header only when it is absent, so this per-response policy is not overwritten in `enforce` mode. The baseline CSP spec is clarified so that its mode/directive clauses govern the baseline header only, not route-level per-response policies.
- `Content-Disposition: attachment` is not adopted. It is a fallback only if `sandbox` proves insufficient in a supported browser.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-and-url-preview`: the binary-safe `/api/file/raw` endpoint gains a requirement that active-content responses carry a sandbox CSP and `nosniff`.
- `baseline-content-security-policy`: "Mode-dependent header emission" and "Baseline policy directives" are scoped to the baseline header, so route-level per-response policies (this sandbox, `ctx.serveApp` mounts) do not contradict them.

## Impact

`packages/server/src/routes/file-routes.ts` (raw route headers) and server tests (`packages/server/src/__tests__/file-raw-render-endpoints.test.ts`). No client change (previews use `<img>` for SVG and `fetch` + `srcdoc` for HTML). The editor pane's `TooLargePreview` "Open raw" link opens the raw URL in a new tab, and an over-cap `.svg`/`.html` opened there now renders static and sandboxed (intended). No API shape change.

## Discipline Skills

- `security-hardening`: response headers on untrusted workspace content.
