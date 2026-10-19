## Context

See proposal.md — Why. This change is a plugin on three dependencies; their contracts are taken as given.

**`add-editor-pane-file-handlers`** provides:
- the `editor-pane-file-handler` slot;
- `FileHandlerProps` `{cwd, path, isActive, snapshot(), save(bytes,{target}), setDirty()}`;
- core `POST /api/file/write-binary`: containment, claim/extension allowlist, `maxBytes`, mtime 409, exclusive-create copies `<stem>.<copySuffix>.<ext>`;
- `ctx.registerFileValidator`;
- the conflict dialog and first-overwrite notice;
- the keep-alive pool: cap 3, dirty-aware LRU, `"unknown"` = dirty;
- a leave guard;
- content-hash conflict tokens (`expectSha1`); validators run in a worker; `copySuffix` required.

Not provided (core design D7, follow-up hardening change): on a loopback dashboard, a credential-less GET from an opaque-origin frame to `/api/*` is still genuinely local. CORS hides the response and non-GETs are refused, but side-effecting GETs run.

**`gate-changed-on-disk-by-content`** provides the digest baseline and own-save suppression (used through core).

**`add-plugin-capability-routes`** provides `ctx.serveApp({dir, csp, appId})` at `/apps/<appId>/`:
- auth-skipped, trusted plugins only;
- enforced CSP;
- extension allowlist;
- 503 on missing build;
- immutable hashed assets, `no-store` `index.html`.

Amendments this change needs are in D3.

**Repo facts (cited).**
- `packages/craft-apps/src/provision.ts`:
  - `downloadVerified` (fail-closed `SHA256SUMS.txt`, ~369-400);
  - `assertSafeListing` parses `tar -tvf` lines (`:245-263`);
  - `extractArchive` shells to `tar`/`ditto` (`:299-310`; GNU tar cannot read `.zip`);
  - `provisionManaged` is CLI-shaped (~582-640);
  - `:597-601` `rmSync`s a version dir lacking the CLI binary.
- `registry.ts:77-104` has no web fields.
- The package `exports` map: `"./*.js": "./src/*.ts"`.
- `packages/server/src/server.ts:1830-1845`: compression gzip/deflate only (brotli truncated by zrok).
- Plugin manifests declare claims in `package.json` (e.g. `packages/browser-plugin/package.json`).

**Spike facts** (WordCraft 0.8.0 web build; GridCraft/DeckCraft untested):
- Trunk/eframe static site: inline module bootstrap that dispatches `TrunkApplicationStarted` after `init()`; `modulepreload`/`preload` with `crossorigin="anonymous"` + SRI.
- ~165 KB JS, 42 MB `_bg.wasm` (15.8 MB gzip).
- No `fetch`/`postMessage` of its own.
- Opens via file input / drag-drop / clipboard; a synthetic `drop` with a `DataTransfer` opened a `.docx`.
- Save: `showSaveFilePicker` → `createWritable`, with an anchor-download fallback.
- IndexedDB font store.
- eframe `console.warn`s `Unhandled egui viewport command: Title("report • - WordCraft")`, with `•` while dirty.
- No direct ROUTE or storage dependency beyond these.

## Goals / Non-Goals

**Goals:**
- One generic `CraftFrameHost` handler parameterised by an app table. Per-app facts live in the `craft-apps` registry and the plugin manifest.
- Embedded code cannot reach dashboard credentials or the API, and has no programmatic network access. Self-navigation is cancelled where the browser allows it, and the residual is documented.
- Edit only ever edits the tab's file; saves go only through core.

**Non-Goals:**
- Anything core already owns (writes, conflicts, eviction, guards).
- Persisting app preferences.
- Opening other files inside an instance.

## Decisions

### D1 — Plugin manifest and claims
`packages/craft-web-plugin/package.json` `pi-dashboard-plugin`:
- `id: "craft-web"`, `defaultEnabled: false`;
- listed as `craft-web-plugin` (the list holds package directory names, `add-plugin-capability-routes/design.md:45`; `bundled-plugins-complete.test.ts` checks it) in `packages/server/package.json#piDashboard.bundledPlugins` — bundled membership is what makes `serveApp` effective (trusted plugin, `add-plugin-capability-routes` D2/D5) and is required of every `packages/*` plugin by the `electron-build-pipeline` check;
- server + client entries and a `configSchema.json` (`apps.wordcraft|gridcraft|deckcraft.enabled`, default `true`).

Claims, one per app, slot `editor-pane-file-handler`:

| claim `id` | `extensions` | `label` | `copySuffix` | `maxBytes` |
|---|---|---|---|---|
| `wordcraft` | `[".docx"]` | "Edit in WordCraft" | `wordcraft` | docx office cap (40 MB) |
| `gridcraft` | `[".xlsx"]` | "Edit in GridCraft" | `gridcraft` | sheet office cap (50 MB) |
| `deckcraft` | `[".pptx"]` | "Edit in DeckCraft" | `deckcraft` | pptx office cap (100 MB) |

Every claim has `mode: "edit"`, `keepAlive: {max: 3}`, `validator: true`, and `firstOverwriteNotice` = the registry `webFidelityNote`.

**Ship gate.** A claim is added to the manifest only when its app has a registry `webVersion`, i.e. its spike passed. This includes WordCraft: the explore spike ran unsandboxed, so WordCraft's gate also requires the per-app Playwright e2e (Risks) green with the production `sandbox="allow-scripts"`, IndexedDB refused (opaque origin) and the `?webgl` leg. A unit test asserts every manifest claim's app has a registry `webVersion` and that `maxBytes`, `copySuffix` and `firstOverwriteNotice` equal the registry/`OFFICE_SIZE_CAPS` values, so the manifest cannot drift, and that each `webFidelityNote` is ≤ 300 characters (the slot's notice bound). At runtime a claim whose app lacks `webVersion` renders "not verified" (fail closed) instead of loading.

**Runtime gate.** The client handler checks `GET /api/plugins/craft-web/status` and renders a disabled state with the reason (`disabled`, `restart-required` — plugin enabled live but its server entry not loaded yet, `not-verified`, `not-prepared`, `shim-outdated`, `offline`, `checksum-mismatch`, `launcher-source`, `extract-failed`). Static manifest claims cannot be toggled per app at runtime; a disabled app shows its mode with "WordCraft is disabled in plugin settings". The server enforces the per-app flag too: `prepare` refuses a disabled app, and each claim's `registerFileValidator({ claimId, module, enabled: () => appEnabled(app) })` main-thread switch refuses saves for a disabled app (core D4), since the worker-run validator cannot read plugin config.

### D2 — Provisioning (`craft-apps`)
1. **Shared install core.** Refactor `provision.ts` to extract `installVerified({asset, release, cacheDir, list, extract, validate})`: download-verified → list-guard → staging → validate → atomic rename → single-flight. The CLI path keeps its tar listing (`assertSafeListing`) and `locateBinary` validation unchanged.
2. **`provisionWeb(app, deps)`** uses it with:
   - asset `<app>-web-<ver>.zip`;
   - a **zip-native list guard**: JS lister (`yauzl`, added as a direct `craft-apps` dependency — `fflate`'s unzip exposes no external attributes, so it cannot detect symlink entries); reject absolute and `..` names, entries whose external attributes mark symlinks or non-regular files, more than 2,000 entries, and total uncompressed size above 512 MB;
   - JS extraction;
   - post-extract `assertTreeSafe` (reused);
   - validation: `index.html` exists;
   - a post-install step:
     - copy the plugin-supplied `craft-shim.js` into the tree;
     - insert `<script src="./craft-shim.js"></script>` before the Trunk module script, with an idempotence marker `<!-- craft-shim:<shimVersion> -->`;
     - move the inline Trunk bootstrap into an external `bootstrap-<hash>.js` (same content, `type="module"`), and copy the shim as `craft-shim-<hash>.js`, so the CSP needs no per-build hash and every non-`index.html` asset is content-hashed (immutable caching is correct for all of them);
     - write `.gz` siblings for `.wasm`/`.js`/`.html`/`.css` (no `.br`);
     - write `craft-build.json` `{app, version, shimVersion, sizeGzip}`. A `current` tree whose `shimVersion` differs from the plugin's makes `status` report `shim-outdated`; the host loads no frame until `prepare` installs and points `current` at a matching tree (the outdated public bytes may still be served meanwhile; they are never loaded). The shim-injection step lives in the plugin (passed to `provisionWeb` as a `postInstall` hook), so `craft-apps` stays free of dashboard-specific code.
3. **Target.** `<root>/<app>-web/<key>/` where key = `<version>-s<shimVersion>`, or `dir-<digest of the whole override tree>-s<shimVersion>`, so a new shim always gets a new tree (never an in-place rewrite, never a rename-race reuse of an outdated tree). Then `<root>/<app>-web/current` is swapped to point at it: symlink + rename on POSIX; on win32 a directory junction (no privilege needed) replaced by rename-then-remove — not atomic there: requests in that brief window get 503 (the spec states this). One `current` per app is shared by every session; a prepare that changes the build (new pin, override or shim) can pair an already-loaded frame's later lazy fetches with the new tree. Accepted: Trunk builds load all code at start (`modulepreload` + wasm), and asset names are content-hashed, so a stale frame gets 404s rather than mixed code; it then shows "could not start"/Resume. Staging dirs under `<root>/<app>-web/` older than 1 h are swept (`sweepStaleStaging` today sweeps only the CLI root). Cross-process races resolve like the CLI path: `EEXIST` on the final rename = another process won, verify and use its tree (`provision.ts` rename-race branch). The root is where `root` is a parameter defaulting to `CRAFT_HOME`. The plugin passes its `ctx.dataDir` (`~/.pi/dashboard/plugin-data/craft-web/`), because `serveApp` may only serve from the plugin's package or data dir (amended `add-plugin-capability-routes`). The tree is always disjoint from the CLI's `<CRAFT_HOME>/<app>/`.
4. **Resolution.**
   - `<APP>_WEB_DIR`: the directory is **copied** into `<root>/<app>-web/dir-<sha256 of the sorted (path, content-hash) list>[:12]>/` and post-processed there; a changed wasm with an identical `index.html` therefore gets a new key. The operator's directory is never mutated.
   - then `<APP>_WEB_VERSION`;
   - then registry `webVersion`;
   - never "latest".
   - `CRAFT_SOURCE=launcher` without `WEB_DIR` fails with no network.
5. **Import.** The plugin server imports `@blackbelt-technology/pi-dashboard-craft-apps/provision.js` (explicit `.js`, which resolves through the `"./*.js"` export).

### D3 — Serving via `serveApp`, with an amendment to `add-plugin-capability-routes`
**Mount.** The plugin calls `ctx.serveApp({ appId: "craft-<app>", dir: ctx.dataDir/<app>-web/current, csp, crossOriginFrame: true })` at activation for every app with a claim. `serveApp` resolves the realpath per request, so swapping `current` (prepare, override, shim upgrade) takes effect with no re-registration.

**Missing build.** Before preparation `current` is absent and the mount's "missing build → 503" applies. **Lifetime.** Mounts are restart-effective (`add-plugin-capability-routes` D5; REST routes stay until restart, `plugin-activation-routes.ts`). After the plugin or an app is disabled, the public build stays served until the next server restart. Accepted: the bytes are public upstream artifacts carrying no user data; prepare, status and saves are refused immediately.

**Amendments to `add-plugin-capability-routes`** (applied to that change's proposal, design, spec and tasks 3.3a–d):
- New `ctx.dataDir` (`~/.pi/dashboard/plugin-data/<pluginId>/`, `0700`). `dir` MAY realpath inside it as well as the package root. It MAY be absent at registration; a request then gets 503 until it exists.
- The extension allowlist gains `.wasm`, served as `application/wasm`.
- **Precompressed variants.** When `<file>.gz` exists and the request accepts gzip, serve it with `Content-Encoding: gzip` and `Vary: Accept-Encoding`. The global on-the-fly compressor is bypassed for the mount.
- **`crossOriginFrame: true`** adds `Access-Control-Allow-Origin: *` (never credentials) and `Cross-Origin-Resource-Policy: cross-origin` to every file response of that mount. Other routes' CORS is unchanged.
- `csp` MAY be a function of the request returning the policy string.

**CSP**, sent by the mount as enforced, on every response:
- `default-src 'none'`
- `script-src <mount base> 'wasm-unsafe-eval'` (no inline script remains after post-install)
- `style-src 'unsafe-inline'`
- `img-src blob: data:`
- `font-src blob: data:`
- `worker-src blob:`
- `connect-src <mount base> blob:`
- `form-action 'none'`
- `base-uri 'none'`
- `frame-ancestors 'self'`

**CSP is per request.** The amended `serveApp` accepts `csp` as a function `(request) => string` (amendment below), because `<mount base>` depends on the request's public origin.

**`<mount base>`.** Absolute and per request: `<public origin>/apps/craft-<app>/`, computed from the request's forwarded-aware public origin (the derivation the dashboard uses for its own links) so it matches the browser's view through zrok/tunnels. `'self'` is not used: an opaque origin matches nothing. Because the base includes the mount path, `connect-src` also excludes `/api/*`, so the frame cannot even issue fetch/XHR GETs to the dashboard API on loopback; the remaining loopback vector is navigation (see Risks).

**Status and prepare** (plugin routes under `/api/plugins/craft-web/`, so `ROUTE_TIERS` entries are added):
- `GET status` → `observe`;
- `POST prepare/:app` → `control`, single-flight, never triggered by a static GET.

### D4 — `CraftFrameHost` (handler component) and shim protocol
**Mount.**
- order: the core `snapshot()` size check runs first, so an over-limit file never downloads the app;
- capability probe in the host before creating the iframe: `navigator.gpu` present → no flag; else WebGL2 available (offscreen canvas test) → `?webgl`; neither → "this browser cannot run <App>" and no iframe (built-in view keeps working). Choosing up front avoids a reload, which the navigation rule would treat as a lost instance;
- iframe `src=/apps/craft-<app>/index.html[?webgl]#n=<nonce>`;
- no `allow-downloads`, deliberately: every save and export goes through the host, which synthesizes device downloads from its own origin. Do not add it to "fix" exports;
- `sandbox="allow-scripts"`, `allow="clipboard-write"`;
- per-mount nonce.

Paste uses native `paste` events, so no clipboard-read permission is needed.

**Shim → host messages.**

| Message | Sent when / payload |
|---|---|
| `ready{nonce}` | Only after the `TrunkApplicationStarted` event, the canvas is present, and one animation frame. The host waits at most 60 s (wasm download + compile on slow clients), then shows "could not start" with Retry; Retry after a WebGPU-path failure uses `?webgl`. |
| `opened{nonce, title}` | When the title signal first names the delivered document (timeout 15 s → host shows "could not open"). |
| `save{nonce, suggestedName, mime, bytes}` | Produced by the stubbed `showSaveFilePicker`, whose handle's `createWritable` buffers writes and posts on `close()`; or by anchor-download interception (capture-phase `click` + prototype `click`; `fetch(href)` is called synchronously inside the click handler — a blob URL resolves at call time, so a `revokeObjectURL` right after the click cannot lose it; `createObjectURL` is not wrapped). `bytes` is transferred, never cloned (also for `open`). |
| `dirty{nonce, value}` | From the title `•` signal parsed out of `console.warn`, combined with input tracking: any trusted `keydown`/`paste`/`cut`/`drop`, or `pointerdown` followed by a title change, captured on the *frame's own* `window` — the shim runs inside the iframe, so dashboard typing never reaches it (eframe may route keys to a hidden text input, not the canvas) after the last clean signal forces `true`. "Clean" is reported only when the latest title signal is clean **and** no input followed it. After a **copy** save the host keeps reporting `true` to core: the tab's own file still lacks the edits. |
| `blocked{nonce, what}` | The shim refused an open: `type=file` input `click`/`showPicker`, `showOpenFilePicker` (`AbortError`), a trusted `drop` carrying files, or a `paste` whose `clipboardData` carries file items (capture on `window`; text and image *content* paste stays allowed). The host shows a toast "Open other files from the dashboard". |
| `csp{nonce, directive}` | From `securitypolicyviolation`. The host logs it to the server (plugin log route, rate-limited) and shows nothing to the user. |
| `navigate-blocked{nonce, url}` | From the Navigation API `navigate` listener, which calls `preventDefault()` on every cancelable cross-document navigation. The host offers to open `url` in a new browser tab after confirmation. |

**Host → shim messages** (posted with `targetOrigin "*"`, the only value that reaches an opaque origin; the nonce and the `event.source` check are the real gate).
- `open{nonce, name, bytes}` — once per mount, in reply to the first `ready`.
- `save-result{nonce, ok, error?}` — `ok:false` → the stub rejects with `AbortError`.

**Host acceptance.** `event.source === iframe.contentWindow`, nonce match, known `type`, `bytes` ≤ claim `maxBytes`. The nonce binds messages to the mount; it does not authenticate the framed app (which can read it). Write safety rests on core + validator.

**Navigation.** A second `ready` or a second frame `load` means navigation or reload: the host drops that frame. Its edits are already gone (the browser replaced the document), so no confirmation can precede it. The host then shows, in place: "The editor reloaded. Unsaved edits were lost." when the last state was `true`/`"unknown"` (else "Editor reloaded"), with Resume. Cancelling navigations via the Navigation API prevents the common cause (in-document hyperlinks).

**WebRTC.** CSP `connect-src` does not govern `RTCPeerConnection` traffic. The shim deletes `RTCPeerConnection`, `webkitRTCPeerConnection`, `RTCDataChannel` and `RTCRtpSender` from `window` before the app loads, which stops non-malicious use. A malicious bundle could recover them (e.g. from a nested same-opaque-origin frame); that is the same residual class as self-navigation (Risks).

**Save mapping.**
- `suggestedName` stem ≠ the tab file's stem, both normalized like core's extension matching (lower-case, Unicode NFC) (an in-app "Save As" to another name) → a host dialog: "<App> wants to save as draft.docx" with **Save as copy next to report.docx** / **Overwrite report.docx** / **Cancel**. The spike records the exact `suggestedName` WordCraft sends for Save vs Save As.
- `suggestedName` extension = tab extension and same stem → `props.save(bytes, {target: saveTarget})`, where `saveTarget` comes from the host toolbar toggle (`overwrite` default | `copy`). The toggle is keyed by file (`cwd+path`), so tabs sharing an instance agree.
- Any other extension → the host offers a device download from its own origin; never a workspace write.
- **Over the size cap.** Bytes > claim `maxBytes` (the document grew while editing, e.g. inserted images) cannot be saved to the workspace by any target: the host replies `save-result ok:false`, explains the limit, and offers a device download of those bytes so the edits are not lost.
- The result maps to `save-result`.

**Dirty.** `setDirty("unknown")` until the first `dirty` message, then `setDirty(value)`. If no `dirty` message arrives within 10 s of `opened`, it stays `"unknown"` (core then never evicts it and always confirms).

### D5 — OOXML validator (plugin server)
`ctx.registerFileValidator` for each claim:
- **Container.** `yauzl` central directory only; ≤ 10,000 entries.
- **Content types.** `[Content_Types].xml` ≤ 1 MB. Any `<!DOCTYPE` or `<!ENTITY` → reject. The `<Override PartName="…" ContentType="…"/>` elements are then read by a bounded attribute scan (no XML parser, no entity expansion, no dependency; worker-safe). It must declare the target kind's main-part content type:
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`;
  - `….spreadsheetml.sheet.main+xml`;
  - `….presentationml.presentation.main+xml`.
- **Main part.** That `Override` `PartName` entry must exist in the zip.
- **App enabled.** The claim's app must be enabled in the plugin config (per-app server enforcement).
- **Outcome.** Reject → core 422. Saved bytes re-enter Preview as ordinary untrusted files under the existing office gates.

## Risks / Trade-offs

- **[Shim drift on app update]** → Pinned `webVersion`; idempotent shim marker with version; a per-app Playwright e2e: prepare → Edit → `opened` → type → `dirty:true` → save → bytes changed and valid → `dirty:false`. A pin bump needs it green.
- **[GridCraft/DeckCraft seam differs]** → Per-app spike acceptance:
  - `ready` after init, drop-open, `opened` title;
  - `showSaveFilePicker` save, `AbortError` handling;
  - dirty round-trip;
  - CSP token set;
  - WebGPU start inside the sandbox and `?webgl` fallback;
  - startup with IndexedDB refused (opaque origin);
  - Cmd/Ctrl+S default prevented;
  - Chrome + Firefox + Safari synthetic `DataTransfer` drop;
  - loads through the zrok tunnel URL.

  A failure → no `webVersion`, no claim.
- **[Self-navigation and WebRTC exfiltration]** → Navigation cancelled via the Navigation API where supported (Chromium; others `unverified`); WebRTC constructors removed by the shim. A deliberately malicious bundle could still leak the loaded document once via a URL, or recover WebRTC. Accepted: pinned, checksum-verified open-source bundles. The spec claims only that fetch, XHR, WebSocket and EventSource are blocked by policy.
- **[Dirty signal missed]** → Input tracking forces dirty; no signal → `"unknown"` = never evicted, always confirms.
- **[Fidelity loss]** → Core first-overwrite notice (per-app text), host Save-target toggle, OOXML validator.
- **[Payload / phone clients]** → Opt-in mode, gzip, immutable caching, size shown in the disabled/not-prepared state.
- **[Loopback `/api/*` GETs from the frame]** → fetch/XHR to `/api/*` are blocked by `connect-src` (mount-path base). A malicious bundle could still navigate the frame to a side-effecting `/api/*` GET on a loopback dashboard (response unreadable; mutations refused). Same exposure as live-server frames today; the core follow-up (file-handlers D7) closes it for both.
- **[Lost preferences]** → Accepted.

## Migration Plan

- New package, `defaultEnabled: false`.
- `craft-apps` refactor keeps CLI behaviour (existing tests stay green).
- **Rollout:** WordCraft claim first; GridCraft/DeckCraft claims added as their spikes pass.
- **Rollback:** disable the plugin. Builds under `~/.pi/dashboard/plugin-data/craft-web/` are inert and deletable.
