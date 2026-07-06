## 1. Shared: loopback classifier

- [x] 1.1 Add `isLoopbackUrl(href: string): boolean` to `packages/shared/src/live-server.ts`, beside `LOOPBACK_HOSTS`. Parse with `new URL(href)`; return true only when protocol is `http:`/`https:` AND `LOOPBACK_HOSTS.has(hostname)`. Unparseable / non-http(s) / non-loopback → false. → verify: unit tests below pass.
- [x] 1.2 Add tests in `packages/shared/src/__tests__/live-server.test.ts` (or existing): true for `http://localhost:5173/x`, `http://127.0.0.1:80`, `https://localhost/x`, `http://[::1]:3000`; false for `http://localhost@evil.com/`, `http://evil.com/localhost`, `http://0.0.0.0:3000`, `ftp://localhost/`, `javascript:alert(1)`, `""`, `http://192.168.1.5/`. → verify: `npm test -- live-server` green.

## 2. Client: LiveServerViewer preset auto-launch

- [x] 2.1 In `LiveServerViewer.tsx`, read `ViewerProps.path`. When it matches `live:<http(s)-url>`, parse the URL, `startLiveServer({host, port})` on mount, and skip the picker. Keep `live:preview` / empty payload → picker (unchanged). → verify: test 2.3.
- [x] 2.2 Build the iframe `src` as `getApiBase() + liveServerPath(id)` with the original URL's `pathname + search` appended (strip any leading slash duplication). → verify: deep-path test asserts `/report.html` in `src`.
- [x] 2.3 Add/extend `editor-pane/__tests__/LiveServerViewer.test.tsx`: preset path auto-launches (no picker, `startLiveServer` called with parsed host/port), deep path preserved in iframe src, `live:preview` still shows picker, non-loopback preset surfaces the error state. → verify: `npm test -- LiveServerViewer` green.
- [x] 2.4 Confirm the header `Open ↗` (`target="_blank"`) opens the previewed target in the system browser; add a test assertion pinning it. → verify: test asserts anchor `href`/`target`.

## 3. Client: open-live-viewer plumbing + shared handler (DRY)

- [x] 3.1 Add `openLiveTarget(url: string)` to `SplitWorkspaceContext` (beside `openInSplit`): `dispatch({ type: "openFile", path: "live:" + url, viewer: "live-server" })` then `updateSplit({ open: true })`. Export it on the context value + type. Do NOT route through `openInSplit` (it derives the viewer from `fileKind` and cannot yield `live-server`). → verify: context/reducer test opens a `live-server` tab with the encoded path, idempotent on repeat.
- [x] 3.2 Add `useLoopbackLinkOpen()` hook (`packages/client/src/lib/use-loopback-link-open.ts`). Reads context via `useOptionalSplitWorkspace()` (returns `null` outside provider — NOT `useSplitWorkspace()`, which throws). Returns `(e, href) => void`: if `isLoopbackUrl(href)` AND `e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey` AND context present → `e.preventDefault()` + `ctx.openLiveTarget(href)`; else no-op. → verify: hook unit test.
- [x] 3.3 Add `lib/__tests__/use-loopback-link-open.test.ts`: plain loopback click calls `openLiveTarget` + prevents default; modifier/middle-click no-ops; non-loopback no-ops; `null` context no-ops (no throw). → verify: `npm test -- use-loopback-link-open` green.

## 4. Client: chat markdown loopback routing (surface 1)

- [x] 4.1 In `MarkdownContent.tsx` `a()` renderer's loopback branch, call `useLoopbackLinkOpen()`'s handler in `onClick`. Keep the anchor rendered with `target="_blank"` + `rel="noopener noreferrer"` so modifier/middle-click and the no-context fallback reach the browser. → verify: test 4.2.
- [x] 4.2 Add/extend `components/__tests__/MarkdownContent.test.tsx`: plain click on loopback link → `preventDefault` + `openLiveTarget("http://localhost:50452/…")`; meta-click and middle-click → no `openLiveTarget`; external link → unchanged `target="_blank"`; credentialed `http://localhost@evil.com/` → NOT routed. → verify: `npm test -- MarkdownContent` green.

## 4b. Client: tool-output / serve_mockup loopback routing (surface 2)

- [x] 4b.1 In `tool-renderers/UrlLink.tsx`, call the same `useLoopbackLinkOpen()` handler in `onClick`; keep `target="_blank"` + `rel="noopener noreferrer"`. No change to the existing `http(s)`-scheme recheck. → verify: test 4b.2.
- [x] 4b.2 Add/extend a `UrlLink` test: plain click on loopback → `openLiveTarget`/`preventDefault`; LAN URL (`192.168.*`) → no split, `target="_blank"`; modifier/middle-click → no split; `null` split-context → no-op + native anchor. → verify: `npm test -- UrlLink` green.

## 5. Security review (security-hardening)

- [x] 5.1 Walk the `isLoopbackUrl` truth table against spoofing vectors (credential-in-host, `0.0.0.0`, IPv4-mapped IPv6, trailing-dot host `localhost.`, uppercase, unicode/punycode) and confirm each resolves as intended; add any missing case to test 1.2. → verify: tests green + note in PR.
- [x] 5.2 Confirm the client check is non-authoritative: a forced non-loopback preset still hits server `validateLiveTarget` and is rejected (test 2.3 covers the viewer side). Document in `design.md` D2 that the server proxy is the trust boundary. → verify: manual trace + test 2.3.

## 6. Docs + gates

- [x] 6.1 Update the per-file rows for `live-server.ts`, `LiveServerViewer.tsx`, `MarkdownContent.tsx`, `UrlLink.tsx`, and the new `use-loopback-link-open.ts` in their directory `AGENTS.md` (add `See change: open-loopback-links-in-split-viewer`). → verify: `kb dox lint` clean.
- [x] 6.2 Run `npm run quality:changed` (biome + tsc + tests) and the CodeRabbit review gate on the diff; fix Critical/Warning. → verify: quality oracle exits 0.
- [x] 6.3 Manual smoke: `serve_mockup` a page → click its loopback link in BOTH the tool-result card AND an assistant message → each opens in split; the LAN link → browser tab; ⌘-click loopback → browser tab; `Open ↗` in viewer → browser tab. → verify: all behaviors observed.
