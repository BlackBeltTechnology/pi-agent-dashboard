## Context

All paths are under `packages/` unless noted. Citations re-verified at HEAD `109f2e197`. Stacking:
this change `blocked_by` `close-security-map-high-findings` (planned, unshipped), which MODIFIES the
same `file-read-containment` requirement and adds the structural post-open recheck this change
extends. Task/line numbers of that change may shift when it lands; this change's tasks name the
function, not only the line.

### DEP-02 today

- Layer ①: `within(p, base)` is `path.relative` (`server/src/lib/path-containment.ts:55-58`).
  `isAllowed` (`:152`) runs `dashboardStateRefuses` then `within(resolved, anchor)` per anchor
  (`:161-163`); only on a miss does it compute `safeRealpath(resolved)` (`:165`) and compare it to
  the real checkout roots (layer ②, `:165-172`). The comment names layer ① "logical, no spawn".
- `resolved` is `path.resolve(admitted.cwd, relPath)` with no realpath (`routes/file-routes.ts:440`),
  then `evaluateContainment(resolved, [...cwdAnchors, homePiAnchor()])` (`:443`; `homePiAnchor` =
  `~/.pi`, `:164-166`; `cwdAnchors` `lib/file-cwd-admission.ts:105`).
- `isAllowed` has three funnels: `evaluateContainment` (`access/containment-gate.ts:252`),
  `decidePassive` (`:348`, used by grep `routes/grep-routes.ts:92` and the mention resolver
  `lib/resolve-file-mention.ts:83`) and the re-evaluation (`:370`). One edit in `isAllowed`
  therefore covers all three.
- The grant layer already compares real paths (`isGrantAdmitted`, `path-containment.ts:131-146`,
  strict `fs.realpath`) and artifact roots are real-path'd (`lib/artifact-roots.ts:38-75`): the
  real-vs-real compare is established precedent.
- The remedy subject is already `realpathNearestAncestor(...)` (`containment-gate.ts:281`), so a
  refused symlink target is offered for grant as its real directory.
- The open follows the lexical string: `openStateChecked(resolved,"r")` (`file-routes.ts:757`) →
  `fs.open` (`lib/dashboard-state-guard.ts:206-217`), the post-open check only refuses always-refused
  dashboard state. Other content opens: raw `:1384`, render `:1529`, sheet `:1633`, digest
  `:838`, eml `:1696,:1750`, grant opener `access/verified-read.ts:104`.
- Gate return types discard the decision: `gateFilePath` (`file-routes.ts:377-407`), `gateReadPath` (`:423-454`)
  and `gateOfficeFile` (`:531-`) return only the lexical `resolved` (+ `viaGrant`); `rendered-pdf`
  (`:1559-1594`) hands `gate.resolved` to `docxPdfEngine.toPdf` (`:1582`, `lib/office-preview.ts:144`), an
  out-of-process opener that follows a link swapped in after the decision, and `handleSystemOpen`
  (`:913-926`) launches `gate.resolved`.
- `/api/session-file` in-cwd shortcut: `rel = relative(session.cwd, absPath)`
  (`routes/session-routes.ts:539`); when it does not start with `..` the route skips
  `evaluateContainment` (`:541-557`) and reads `readFile(absPath)` (`:563`). Same symlink hole.

### ELEC-01 today

- `mainWindow = new BrowserWindow({webPreferences:{nodeIntegration:false, contextIsolation:true,
  preload, additionalArguments}})`, no `partition` ⇒ default session (`electron/src/main.ts:605-618`).
- `await app.whenReady()` at `main.ts:762`, then `showSplash()`; no `defaultSession` reference in
  `packages/electron/src` (rg-verified). Other default-session windows: splash (`main.ts:361`),
  remote-connect (`lib/remote-connect-window.ts:134`), connecting (`lib/connecting-window.ts:34`),
  doctor (`lib/doctor-window.ts:178`); all load bundled local pages.
- Server windows: `ALLOWED_PERMISSIONS = clipboard-sanitized-write, notifications, fullscreen`
  (`lib/server-windows.ts:85-90`), wired `:575-576` on `session.fromPartition` (`server-windows-main.ts:131`);
  tested `lib/__tests__/server-windows.test.ts:277-278` (`media`, `geolocation`, `midi`, `clipboard-read`
  denied).
- `mainWindowServerUrl` is written only in `createMainWindow` (`main.ts:150,598`) and read at `:482`; it is
  NOT updated when `dashboard:navigate-to-server` → `navigateToServer` loads another allowed origin (a loopback
  variant or a known server, `lib/local-proof-bootstrap.ts:162-178,216,232`), so it can lag the real page.
  `mainWindow.webContents.getURL()` is the live source. `localDashboardOrigin` (`:560`) is set only in local
  mode. `will-navigate` keeps the window on the server origin (`:628-637`).
- Electron 44.9.0 (`electron/package.json:34`; typings `node_modules/electron/electron.d.ts`, hoisted):
  request handler `setPermissionRequestHandler((webContents, permission, callback, details) => void)`
  (`:13939`) with `PermissionRequest.isMainFrame` and `.requestingUrl` (`:11267-11280`); check handler
  `setPermissionCheckHandler((webContents | null, permission, requestingOrigin, details) => boolean)`
  (`:13930`) with `PermissionCheckHandlerHandlerDetails.requestingUrl?` (absent "when the check is not made on
  behalf of a document (for example for a service worker)") and `.isMainFrame` (`:23839-23870`). The check
  handler's `webContents` may be `null` and its `requestingOrigin` is always set; `openExternal` is a
  member of the permission union. Links reach the OS only through `safeOpenExternal`'s http/https/mailto
  allowlist (`main.ts:437-446`), wired at `setWindowOpenHandler`/`will-navigate` (`:624-637`).

### NET-02 today

- `startStaticServer(root, port)` (`mockup-loop/src/extension.ts:75-113`): traversal check is
  `target.startsWith(root)` (`:83`, string prefix), `fs.existsSync` + `createReadStream(target)`
  (`:96,105`, follows symlinks, serves dotfiles), `server.listen(port, "0.0.0.0")` (`:112`).
- Tool: `dir` only checked as an existing directory (`:227-233`); URLs `local`/`lan` (`:236-246`);
  description tells the agent to hand the URL to the human (`:200`). `execute(_id, params)` declares
  no `ctx` (`:212`), although pi passes one: `ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx: ExtensionToolContext)`
  (pi `dist/core/extensions/types.d.ts:514`), whose `ExtensionContext.cwd` is the session working directory
  (`types.d.ts:213-222`; `docs/extensions.md` "Context and session changes").
- The path gate gates only `read`/`write`/`edit` (`extension/src/path-gate/handler.ts:40`), and its
  spec says "No other tool SHALL be gated by this capability" (`openspec/specs/agent-path-confinement/spec.md:10`).
- Spec text mandating `0.0.0.0`: `openspec/specs/mockup-loop-preview-and-capture/spec.md:11-27`.

### NET-03 today

- `_create_container`: `docker run -d --name <fixed> -p <port>:<cport> <image>`
  (`document_converter/pdf_server.py:172-179`, `plantuml_server.py:162-168`); images
  `gotenberg/gotenberg:8`, `plantuml/plantuml-server:latest` (`pdf_server.py:63-64`,
  `plantuml_server.py:58-59`).
- `ensure_running`: running + `get_container_port()` → reuse; exists → `docker start`; else create
  (`pdf_server.py:194-230`, `plantuml_server.py:184-220`). `get_container_port` parses
  `docker port` output such as `0.0.0.0:54321` (`pdf_server.py:100-120`), but `docker port` prints
  nothing for a stopped container, so it cannot reveal a stopped legacy wildcard container that
  `ensure_running` then reuses via `docker start` (`_start_container` `pdf_server.py:158-168`,
  `plantuml_server.py:148-158`). The configured binding is observable while stopped through
  `docker inspect -f '{{json .HostConfig.PortBindings}}'`. `atexit` → `stop_if_started_by_us` → `docker stop` (`:190-192,245-254`).
- Probe socket already loopback-only (`get_available_port`, `pdf_server.py:29`); URLs are
  `http://localhost:<port>` (`:217,238,266`).

### NET-04 today

- Route `POST /api/providers/test`: `preHandler: networkGuard`, tier `operate`
  (`server/src/routes/provider-routes.ts:573-575`; `shared/src/route-tiers.ts:450`).
- `resolveProbeApiKey` (`server/src/package/provider-probe.ts:131-153`): `***` → `providers.json[name].apiKey`
  via `readProvidersRaw`; `$X` → `process.env[X]`; neither tied to `baseUrl`. `probeProvider({baseUrl, apiKey, api})`
  (`provider-routes.ts:608`) → `fetch(req.url, {redirect:"error"})` (`provider-probe.ts:303-308`); the
  body excerpt (≤500 chars) is returned on non-2xx.
- The MCP tool is `providers_test`, tier `operate` (`mcp-server-plugin/src/server/generated/tools.ts:191`);
  session tokens are `control` and refused there (`dispatch.ts:520`, `tokens.ts:46`).
- Save-then-probe road: `PUT /api/providers` and `PATCH /api/providers/:name` are tier `operate`
  (`shared/src/route-tiers.ts:309,532`); after the write they call `probeAndCacheProvider`
  (`provider-routes.ts:408,501`; also `:566` refresh), which resolves `$ANY_ENV` and sends the key to
  the saved `baseUrl` with no vet (`provider-routes.ts:39-53`). Registry discovery does the same:
  `discoverProviderModels` (`model-proxy/custom-provider-discovery.ts:52-57`) and
  `readCustomProviderCreds` (`model-proxy/registry-singleton.ts:72`). `server.ts:1862` holds the
  dashboard's own-port getter (the push service's `selfPort`).
- The client's Add dialog tests an unsaved config, possibly with `$ENV`
  (`client/src/components/settings/ProviderAddDialog.tsx:440`, `lib/api/providers-api.ts:62-80`).
- SSRF policy precedent: `resolveAndVet(hostname, port, selfPort, lookupAll)`
  (`server/src/push/push-transports/webhook-url.ts:115`) allows loopback + private LAN, refuses
  link-local/metadata and the dashboard's own port; `selfPort` comes from the server
  (`push/push-service.ts:41`).

## Goals / Non-Goals

**Goals**

- A symlink under an admitted anchor never serves a file whose real path escapes the anchors,
  checkout roots and grants, on every file route, the grep filter, the mention resolver and
  `/api/session-file`.
- The Electron app's default session grants nothing outside a fixed, origin-bound allowlist.
- `serve_mockup` and the converter containers are not reachable from another host by default.
- `/api/providers/test` cannot send a stored or environment secret to a URL the operator did not save,
  nor reach link-local/metadata addresses.

**Non-Goals**

- HTTP-02 (a hostile localhost-port page reaching the dashboard). Change A closes it; NET-02 only
  removes the LAN reach of the planting server.
- Changing which paths are credentials/dashboard state (DEP-01's change owns it) or the `~/.pi` anchor.
- Gating `serve_mockup` by the agent path gate (D5-C rejected).
- Pinning the PlantUML image digest; adding `--rm`; a Windows-specific symlink test row.
- DNS-rebinding-proof provider probes (operate tier, named residual).

## Decisions

### D1 — Layer ① decided on real paths (confirmed by operator 2026-10-26)

Decision D1 (confirmed by operator 2026-10-26): `isAllowed` becomes: refuse dashboard state (unchanged);
`realResolved = safeRealpath(resolved)` once; for each anchor, admit iff `within(resolved, anchor)`
(lexical, unchanged, cheap prefilter) **and** `within(realResolved, await safeRealpath(anchor))`.
Layer ② is unchanged and now receives paths ① rejected for escaping; the existing
`samePath(root, anchor)` skip stays valid because the anchor subtree is exactly layer ①. The check is
narrowing-only: it never admits a path ① refused before. An internal `isAllowedReal(resolved,
{anchors})` returns `{allowed, real}` (the `real` is `realResolved` and is the value D2 binds to);
`isAllowed` stays as the boolean wrapper for callers that need no real path.
`~/.pi` being itself a symlink (dotfile managers) works because the anchor is real-pathed too, as
does macOS `/tmp` → `/private/tmp`. `safeRealpath` keeps swallowing every `realpath` failure
(nearest ancestor + tail), so a link loop or a dangling link is admitted by ① on its own location and
the open then fails: the site keeps today's not-found mapping (404 `"not found"`; `serve_mockup` 404).
A hardlink inside the anchor to a file outside it has an in-anchor real path and is served (named
residual: it needs write access to both directories, which the agent already has; refusing
`st_nlink > 1` would break the pnpm store layout).

Alternatives: (B) lstat component walk — breaks pnpm/worktree `node_modules` symlinks; (C) O_NOFOLLOW
only — covers the last component only. Both rejected.

Cost: one `realpath` for the path plus one per anchor (≤3) on the hot path, no git spawn; the old
code paid `safeRealpath(resolved)` only on a layer-① miss, so a layer-① hit now costs ~2-4 extra
`lstat`-chain syscalls. Structural budget in tests: no `git` spawn on a hit.

`/api/session-file`: delete the `rel` shortcut condition (`session-routes.ts:539-541`); always call
`evaluateContainment(absPath, [session.cwd], …)`. The refusal string `"path outside session directory"`
and the grant path are unchanged. (When `close-security-map-high-findings` task 1.7 lands it adds a
`dashboardStateRefuses` call before the shortcut; with the shortcut gone that call becomes the
`evaluateContainment` one — the task here says so explicitly.)

### D2 — Bind the open to the decision (confirmed by operator 2026-10-26)

Decision D2 (confirmed by operator 2026-10-26): `PathDecision` (the brand lives in
`shared/src/containment-guard.ts:20-27`; `ContainmentDecision` at `containment-gate.ts:75` is an alias and
`decision()` at `:78` the only constructor) gains `real: string | undefined` (set on allow, from
`isAllowedReal`). `isGrantAdmitted` (`path-containment.ts:131-146`) and `reEvaluate`
(`containment-gate.ts:365-375`) return booleans today; both change to return the decided real path (or
`null`) so grant, post-hold allow-always and allow-once decisions carry `real` too, and a link into a
granted directory is bound-open like any other (`openVerifiedRegularFile`'s own checks do not bind to the
decided path). `openStateChecked(p, flags, opts?)`,
`readFileStateChecked(p, enc, opts?)` and `openVerifiedRegularFile(p, opts?)` take
`opts.decidedReal`. After `fs.open` (before any read) they require
`await fs.realpath(p) === decidedReal` **and** `fh.stat()` `(dev,ino)` equal `fs.stat(decidedReal)`;
otherwise (including a failing post-open `realpath`/`stat`, e.g. `EACCES`/`EIO`) they close the handle and throw `ContainmentBindingRefused` (mapped like
`DashboardStateRefused` at each site: the site's existing 403 shape, never 2xx/500). The three gates
(`gateFilePath`, `gateReadPath`, `gateOfficeFile`) gain `real: string` from `decision.real` (task 1.5) so callers
have it. Callers pass `gate.real` at every content open that follows a containment decision: `file-routes.ts:757`
(read), `:1384` (raw), `:1529` (render), `:1633` (sheet), digest `:838`, md-read, the two EML routes
(`:1696,:1750`: both branches pass the bytes read through the bound opener as `prefetched`, so
`lib/eml.ts:101`'s own `fs.readFile` is not reached; `lib/eml.ts` is not edited) and
`session-routes.ts:562-563`. Programs handed a path instead of a handle get the decided real path: rendered-pdf
and the docx/pptx render gates pass `gate.real` to `toPdf` (and key the PDF cache on it), re-check the real
path's `(dev,ino)` after conversion and discard the output on mismatch; `handleSystemOpen` launches
`gate.real`; `renderDocx`/`renderPptx` (`lib/office-preview.ts:193-198,256-261`) also delete the output on a
`(dev,ino)` mismatch so no poisoned cache entry remains, the docx HTML fallback (`:208`) reads through the bound
opener, and `ContainmentBindingRefused` is rethrown past their catch-alls to the route's 403. Not a bind site: `live-server/live-static.ts` decides on a realpath rooted at
its own root (`locateFile` `:138-153`) and opens that real path (`openRegular`, `:156-158,199`), with no
containment decision in scope. Other sites that cannot supply a decision keep today's behaviour; the
task audit lists them.
Why both checks: `realpath` equality catches a swapped intermediate directory or final link; the
`(dev,ino)` equality proves the handle is the file at that real path, not a file swapped in after.
Named residual: swap-in **and** restore within the open call (needs the file's identity to
match at both checks).

Alternatives: (B) no binding, document; (C) bind only read + raw. Rejected: the helper list already
exists (structural recheck of the stacked change), the marginal cost is one `realpath` + two `stat`.

### D3 — One default-session policy (confirmed by operator 2026-10-26)

Decision D3 (confirmed by operator 2026-10-26): new `electron/src/lib/permissions.ts` exports
`ALLOWED_PERMISSIONS`/`isPermissionAllowed(permission)` (moved from `server-windows.ts:85-90`, which
re-exports `isServerWindowPermissionAllowed` for its tests) and
`installDefaultSessionPermissions(session, getAllowedOrigin)`. It sets
`setPermissionRequestHandler((wc, perm, cb, details) => cb(allow))` with
`allow = isPermissionAllowed(perm) && details.isMainFrame && originOf(details.requestingUrl) === getAllowedOrigin()`
and `setPermissionCheckHandler((wc, perm, requestingOrigin, details) => allow)` with the same rule using
`originOf(details.requestingUrl ?? requestingOrigin)`, except that a check with **no** `requestingUrl`
(a service worker, no document, `wc` may be `null`) is judged by `requestingOrigin === getAllowedOrigin()`
alone and only for `notifications`. `openExternal` is not in the allowlist: allowing it would let a page
launch any OS protocol handler and bypass the http/https/mailto allowlist of `safeOpenExternal`
(`main.ts:437-446`), which already serves links.
`getAllowedOrigin` returns the origin of `mainWindow.webContents.getURL()`, accepted only when it is in
`allowedOrigins({config: loadMinimalConfig(), windowServerUrl: mainWindowServerUrl})` (the set
`navigateToServer` already trusts: configured loopback variants, the window's server, known servers;
`local-proof-bootstrap.ts:162-178`, exported for this use). A navigation to a loopback variant or known server
therefore moves the grant to the new origin and the old origin loses it; a `file://` or unlisted page, no
window or a destroyed one yields `undefined`, which denies. Installed in `main.ts` right after `await app.whenReady()`
(`:762`), before `showSplash()`, on `session.defaultSession`; that covers the main window and every
other default-session window (bundled `file://` pages never match the origin, so they get nothing).
Each denial logs a `warn` once per (permission, origin) pair. Server windows keep their partition
handlers (same constant, no origin check change).

Alternatives: (B) + audio-only `media` for local mode (not shipped feature; add when the voice plugin
needs it); (C) deny all (breaks notifications/fullscreen).

### D4 — serve_mockup listener (confirmed by operator 2026-10-26)

Decision D4 (confirmed by operator 2026-10-26): add optional `lan?: boolean` to `serve_mockup`. Default
`listen(port, "127.0.0.1")`; `lan:true` → `"0.0.0.0"`. A 128-bit random token (`crypto.randomBytes(16)`
hex) is generated per server; every URL returned is `http://<host>:<port>/<token>/`; any request whose
path does not start with `/<token>/` answers `404` with no body detail. Loopback mode additionally
requires `Host` ∈ {`localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>`} (DNS-rebinding), else `421`;
LAN mode skips the Host check (the phone types an IP/hostname; the token is the barrier; DNS rebinding of
a LAN-mode server is a named residual). Check order: token (404, before anything else), then
`Host` (421; loopback mode only), then the path. The accepted `Host` set is exactly the three literal
forms, host part compared case-insensitively, port equal to the bound port; a missing `Host`, no port, a
trailing dot or `127.0.0.2` is 421. The result text
and description drop "on 0.0.0.0", state that LAN needs `lan:true`, and keep steering the agent to pass
the **localhost** URL to `canvas`. Static handler: percent-decode once (a NUL byte or an invalid escape is 400 with a generic body, replacing today's
500 with a reflected `URIError`), a `..` segment that escapes the root is 403, any other segment
starting with `.` (including a `..` that stays inside) is 404, then `fs.realpath(target)` must be `root` or under `root + path.sep` (real
root), replacing `startsWith(root)` (`extension.ts:83`, a string prefix that also matches sibling
`<root>-x`); directories serve `index.html` as today. Dotfile rule means `.well-known` is refused (named residual). A `realpath` that fails with ELOOP/ENOENT is 404; any other failure (`EACCES`, `EIO`) is 403, never 2xx/500. The realpath-then-open race (a link swapped between the check and `createReadStream`) is a named residual: the agent already writes the served directory, and unlike D2 there is no decision to bind to. **BREAKING:** root-relative asset links
(`/style.css`) in a mockup no longer resolve because they drop the token prefix; mockups must use
relative links (`style.css`). Not mitigated by a token cookie (kept simple); the tool text, README and
CHANGELOG say so. One `info` line at start (bind address, lan flag, real root; never the token).

Alternatives: (B) keep `0.0.0.0`, token only; (C) drop LAN support.

### D5 — `dir` confinement (confirmed by operator 2026-10-26)

Decision D5 (confirmed by operator 2026-10-26): `realpath(dir)` must be `realpath(ctx.cwd)` or under
it, else the tool answers an error naming the cwd and how to proceed (move the mockup into the
project). The root is `ctx.cwd` of the `ExtensionToolContext` pi passes as `execute`'s fifth argument (pi
`types.d.ts:514`; `ExtensionContext.cwd` `:213-222`), falling back to `process.cwd()` only when `ctx` is
absent (plain-Agent wrapped tools); the server's cwd is never used. Test: `ctx.cwd` ≠ `process.cwd()`. Alternatives: (B) cwd + `os.tmpdir()`; (C) agent path gate (touches
`agent-path-confinement`, overlaps change D).

### D6 — Loopback publish and legacy containers (confirmed by operator 2026-10-26)

Decision D6 (confirmed by operator 2026-10-26): both `docker run` argument lists use
`-p 127.0.0.1:<port>:<cport>`. A new helper per server, `_published_on_loopback()`, runs
`docker inspect -f '{{json .HostConfig.PortBindings}}' <name>` (works for a stopped container, unlike
`docker port`) and reads the bindings for `<cport>/tcp`: true only when every `HostIp` is the literal `127.0.0.1` or
`::1` (`127.0.0.2`, `localhost` and a set mixing a loopback and a wildcard entry are non-loopback); an empty `HostIp` (all interfaces), `0.0.0.0`, `::`, no binding, an inspect failure or unparsable
output is non-loopback. `ensure_running` checks it for a running **or** existing container, before the
reuse branch and before `docker start`: non-loopback → `docker rm -f <name>` and fall through to
`_create_container` (log a `warn` line, `_started_by_us = True`). A failing `rm -f` raises
`PDFServerError`/`PlantUMLServerError` (fail closed: no `docker start`, no reuse, no create), except
stderr "No such container" (the container vanished), which continues to create. A failing `docker run`
after the removal raises as `_create_container` does today. `get_container_port` is unchanged
(running containers only). Base URLs stay `http://localhost:<port>` (Docker's `127.0.0.1` publish is
reachable via `localhost`; the health probe resolves `localhost` to IPv4 or falls back). No `--rm`, no
digest pin (named residuals). Tests: a stopped wildcard container is recreated, never `docker start`ed.

### D7 — Provider-test binding and egress (confirmed by operator 2026-10-26)

Decision D7 (confirmed by operator 2026-10-26; amended by doubt cycle 1): two parts.

*Refusal order.* A `baseUrl` that is not an absolute http(s) URL is refused first (`"Base URL is not a valid URL"` /
`"Base URL must use http or https"`, the `webhook-url.ts:25-30` precedent minus its userinfo refusal), then the secret-binding
errors, then `"Environment variable X is not set"`, then the target vet (a binding error never reveals whether an env var is set).

*Secret binding (Test route only).* In `provider-routes.ts`, before `resolveProbeApiKey`, compute
`saved = readProvidersRaw()`. `resolveProbeApiKey` gains an OPTIONAL `requestBaseUrl` (only the Test
route passes it; saved-provider probes and discovery pass none, so their key resolution is unchanged) and
rules: `***` → allowed only if `normalize(requestBaseUrl) === normalize(saved[name].baseUrl)` (else
`"Re-enter the API key to test a changed Base URL"`); `$NAME` → allowed only if a saved provider P has
`P.apiKey === "$NAME"` and `normalize(P.baseUrl) === normalize(requestBaseUrl)` (else
`"Environment-variable keys can only be tested with the Base URL saved with them"` — the text no longer
tells the caller to save first, which would be the bypass below). `normalize` = `new URL(x)` origin
(lower-case scheme/host, default port elided) + path with trailing `/` stripped, query/fragment dropped;
exactly one trailing `/` is stripped; userinfo and a trailing-dot host are kept, so they compare unequal; it is stated in the requirement body so a trailing-slash or case variant still probes. Literal keys are
untouched (the caller typed them).

*Egress vet at one choke point.* `package/provider-probe.ts` gets `vetProbeTarget(baseUrl)` =
`resolveAndVet(host, effectivePort(url), selfPort(), lookupAll)` (webhook module; refusal strings become
noun-parameterised: optional `noun`, default `"webhook"`), called inside `probeProvider` and
`fetchProviderModelBody` (so `listProviderModels`/`listProviderModelIds`) before any `fetch`, with the lookup raced against the
same 8 000 ms abort (`DEFAULT_TIMEOUT_MS`), so a stalled resolver ends as `{ok:false,error}` (no `status`), never a hang. The
blocked set is exactly the webhook set (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, IPv4-mapped forms); Alibaba
`100.100.100.200`, Oracle `192.0.0.192` and AWS-DNS `fd00:ec2::23` are a named residual (widening it would change webhook behaviour).
`selfPort` is a module getter set once by `server.ts` (same `fastify.server.address()` source as
`server.ts:1862`; unset → own-port rule skipped, metadata/link-local rule always on). Hence the Test
route, `probeAndCacheProvider` (`provider-routes.ts:39-53`, called from PUT/PATCH/refresh `:408,:501,:566`)
and registry discovery (`custom-provider-discovery.ts:52-57`) all refuse a link-local/metadata/own-port
target with **no** request: Test returns `{ok:false, error:"provider target is a link-local or metadata
address"}` / `"provider target is this dashboard"`; a saved probe caches that as health; discovery returns
`[]`. One `warn` per refusal (host only, never key/query). Loopback and LAN targets stay allowed (local
Ollama, LAN gateways). The resolved-address pinning for `fetch` is not done (undici dispatcher not
importable; named residual).

Save-then-probe (doubt C1): without the choke-point vet, `PUT /api/providers` / `PATCH /api/providers/:name`
(operate, `route-tiers.ts:309,532`) saving an attacker `baseUrl` + `$ANY_ENV` would send the key
through the unvetted `probeAndCacheProvider`. The vet closes the link-local/metadata/own-port half.
**Named residual:** an operate caller can still bind an env key to a **public** attacker URL by saving the
config (the saved-config binding cannot refuse what the operator "saved"); operate already equals full
control of the dashboard host config, owner none. The model-proxy's inference-time use of a saved key
(`registry-singleton.ts:72`) is likewise unchanged.

Alternatives: (B) `***` only; (C) egress block only; (D) block private ranges (breaks local providers).

## Risks / Trade-offs

- **Workspaces with symlinks out of the tree** (D1). Refused with the grant remedy; one click grants
  the target directory. Mitigation: BREAKING note; test row for `pnpm link` style layout.
- **Latency on hot read path** (D1). Bounded extra `realpath`s; no unbounded probes (same async
  family as layer ②). Structural test: no `git` spawn on a layer-① hit.
- **No latency threshold** (D1). Only structural budgets are asserted (no `git` spawn on a layer-① hit; ≤ 4 `realpath` per decision: one path + ≤ 3 anchors); no p95/p99 target.
- **Hardlinks and the serve_mockup race** (D1, D4). A hardlink in an anchor to an outside file is served; a link swapped between serve_mockup's `realpath` and its open serves the outside file. Both need write access the agent already has; named residuals, owner none.
- **Other cloud-metadata addresses** (D7). `100.100.100.200`, `192.0.0.192`, `fd00:ec2::23` are not blocked (webhook parity); named residual.
- **Stacking drift** (D1/D2). The MODIFIED block copies the stacked change's text; if that change
  is edited before ship this delta must be re-copied (recorded in dependencies).
- **Voice mic in Electron** (D3). Denied until the plugin adds an explicit, audio-only, local-origin
  rule; the failure is a `NotAllowedError`, surfaced by the plugin's own error path.
- **Token URL breakage** (D4). Anything that cached the old `http://localhost:<port>` URL (a canvas tab)
  needs the new URL; servers die with the process anyway.
- **Docker semantics** (D6). `docker port` output format differs by Docker version; the parser only
  looks at the host part before the last `:` and treats unparsable output as non-loopback (recreate).
  Recreating a running legacy container interrupts any other consumer.
- **LAN-mode serve_mockup and dotfiles** (D4). LAN mode skips the Host check, so a LAN-mode server relies on
  the token alone against DNS rebinding; the dotfile rule refuses `.well-known`. Both named residuals, owner none.
- **Root-relative mockup links** (D4). `/style.css` 404s under the token prefix; documented BREAKING.
- **False refusals in the provider test** (D7). A saved provider tested under a changed Base URL gets an
  actionable error; documented in the README provider section via the CHANGELOG.

## Migration / Rollback / Compatibility

- No data migration, no config key, no wire format or route/tier change. Server restart
  (`restart-server.ts`) for server changes; `npm run reload` not needed (extension untouched);
  Electron needs an app rebuild; `mockup-loop` and `document-converter` ship as package releases.
- Rollback: each finding is an independent commit group (DEP-02, ELEC-01, NET-02, NET-03, NET-04);
  revert the group. Rolling back D2 alone leaves D1 effective. Containers created under D6 stay
  loopback-published after a code rollback (safe).
- Compatibility: older `mockup-loop` against a newer host is unaffected (package-local); a newer
  `mockup-loop` needs no host change. Older containers are recreated lazily (D6). Clients see only
  403 + the existing remedy body for newly refused symlinks.
- Ship order: after `close-security-map-high-findings` (blocking); independent of changes A, B, D
  except the `harden-http-auth-boundaries` ordering note in `dependencies.yaml`.
