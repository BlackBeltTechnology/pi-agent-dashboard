# plugin-runtime-client-loading Specification

## Purpose
TBD - created by archiving change decouple-plugins-from-core. Update Purpose after archive.

## Requirements

### Requirement: Manifest declares a prebuilt client bundle

`PluginManifest` SHALL accept optional `clientBundle` (package-relative path to a prebuilt ES entry module) and optional `clientStyles` (package-relative path to a prebuilt CSS file). The validator SHALL keep both fields. `client` SHALL keep meaning the build-time source entry. The directory containing `clientBundle` SHALL be the plugin's served asset root.

#### Scenario: Both delivery forms declared
- **WHEN** a manifest declares `client: "./src/client.tsx"` and `clientBundle: "./dist/client.js"`
- **THEN** a build that bundles the plugin SHALL use `client`, and runtime delivery SHALL use `clientBundle`

#### Scenario: Runtime-delivered plugin without a bundle
- **WHEN** a plugin that is not bundled by the served build declares `client` but no `clientBundle`
- **THEN** its status SHALL show `client.delivery: "refused"` with `refusedReason: "no-bundle"`

### Requirement: The client asset root is a dedicated directory

The asset root SHALL be a dedicated client output directory (for example `dist/client/`) that is not the package root and contains neither the server nor the bridge entry. A plugin violating this SHALL have its client refused with `no-bundle` and a logged layout error.

#### Scenario: Asset root shared with server code is refused
- **WHEN** a manifest declares `clientBundle: "./dist/client.js"` and `server: "./dist/server.js"`
- **THEN** its client SHALL be refused with `refusedReason: "no-bundle"`, the log SHALL name the layout error, and no file under `dist/` SHALL be served from `/plugin-assets`

### Requirement: The client bundle entry module carries the claim functions

The `clientBundle` entry module SHALL export every static claim function the manifest names (`predicate`, `shouldRender`, `resultPending`, `labelComponent`), the component of every claim that names no `module`, and the export named by `i18nCatalog` when declared (an export name, not a file). A claim that names a `module` SHALL resolve that path inside the asset root, and its component SHALL stay lazily loaded.

#### Scenario: Lazy claim stays lazy at runtime
- **WHEN** a runtime plugin's claim names `module: "./dist/Board.js"` and `shouldRender: "isBoardSession"`
- **THEN** `isBoardSession` SHALL be read from the entry module at registration, and `Board.js` SHALL be fetched only when the claim first renders

#### Scenario: Catalog comes from the entry export
- **WHEN** a runtime plugin's manifest declares `i18nCatalog: "catalog"`
- **THEN** the shell SHALL register the entry module's `catalog` export, and the listing SHALL carry no i18n URL

### Requirement: One rule decides bundled versus runtime delivery

A discovered plugin SHALL be *bundled* if and only if its id is in `bundledPluginIds` of the served build declaration, independent of filesystem roots. Every other client-contributing plugin SHALL be runtime-eligible. The delivery decision, `PluginStatus.client.delivery` and the server's staleness hash SHALL use this one predicate.

#### Scenario: npm-global host classifies by declaration
- **WHEN** the dashboard runs from an npm-global install with no monorepo root, and the served build declares `bundledPluginIds: ["flows", "goal"]`
- **THEN** `flows` and `goal` SHALL report `client.delivery: "bundled"`, and a third discovered client plugin SHALL be runtime-eligible

### Requirement: A bundled id has one winner for both halves

For a bundled id the discovery winner SHALL be the build's own copy that exists on disk (`workspace`, else `bundled`; `dashboard-plugin-loader` "Server-side plugin discovery SHALL NOT depend on `process.cwd()`"), on server and client alike. Other copies SHALL be in its `shadowed`. With no build copy (npm-global) plain priority SHALL apply and the halves MAY differ in version. Staleness SHALL follow `plugin-manifest-staleness`.

#### Scenario: Bundled id wins
- **WHEN** `subagents` is in `bundledPluginIds` and another copy with id `subagents` exists under `~/.pi/dashboard/plugins`
- **THEN** only the bundled claims SHALL register, the bundled copy's server entry SHALL be the one loaded, and the `~/.pi/dashboard/plugins` copy SHALL appear in `shadowed`

#### Scenario: npm-global keeps the installed copy
- **WHEN** an npm-global host has no `resources/plugins`, the build declares `subagents`, and `subagents` exists only under `~/.pi/dashboard/plugins`
- **THEN** that copy SHALL win with `source: "installed"`, its server entry SHALL load, and the bundled client claims SHALL render

#### Scenario: Staleness banner unaffected by a runtime plugin
- **WHEN** a runtime-only plugin is installed into a stock production dashboard
- **THEN** it SHALL NOT count toward the staleness hash on either side, `/api/health.bundleHash` SHALL still equal the served build's hash, and no staleness banner SHALL appear

### Requirement: An undeclared build suspends runtime delivery

When the served build has no usable declaration, or its declaration lacks `bundledPluginIds`, every runtime-eligible plugin SHALL be refused with `refusedReason: "build-undeclared"`. Build-time plugins SHALL be unaffected. Discovery winners and the staleness hash SHALL fall back to the selection used before this change (plain source priority; `bundleRootsFor` where a monorepo root resolves).

#### Scenario: Old artifact suspends runtime delivery
- **WHEN** the served build declaration has no `bundledPluginIds`
- **THEN** every runtime-eligible plugin SHALL report `refusedReason: "build-undeclared"`, and build-time plugins SHALL render as before

#### Scenario: Undeclared build on an installed host keeps the legacy selection
- **WHEN** an npm-global host serves an older build without `bundledPluginIds`
- **THEN** discovery SHALL pick winners by plain source priority, `/api/health.bundleHash` SHALL be computed as before this change, and no plugin SHALL be reported runtime-delivered

### Requirement: Host modules are shared through a server-injected import map

The production build SHALL emit stable-named shims under `dist/host/` re-exporting the host's `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` and the runtime's `public.ts`. Every HTML response the server builds from the production `index.html` (`/`, `/index.html`, SPA fallbacks, the `--dev` fallback) SHALL pass one server function that inserts a static `<script type="importmap">`; the static handler SHALL NOT serve `index.html` or its `.gz` directly. HTML SHALL stay `no-cache`.

#### Scenario: One React instance
- **WHEN** a runtime plugin built with React externalized renders a component using `useState` and `useShellConnectionStatus()`
- **THEN** the hook SHALL return the host's live connection status, and no invalid-hook error SHALL occur

#### Scenario: Root and deep link both carry the import map
- **WHEN** the browser loads `/`, `/index.html`, or cold-loads `/settings/plugins/ext-demo` with `Accept-Encoding: gzip`
- **THEN** each served HTML SHALL contain the import map

### Requirement: Dev mode keeps Vite in front of the HTML

In `--dev`, `/` and `/index.html` SHALL first be proxied to the Vite dev server, as today; only when Vite is unreachable SHALL the server send the production `index.html` with the import map.

#### Scenario: Vite reachable in dev mode
- **WHEN** the server runs with `--dev` and Vite answers on its port
- **THEN** `GET /` SHALL return Vite's `index.html`, without a server-injected import map

### Requirement: Runtime client admission requires operator trust pinned to content

The server SHALL admit a runtime client only when the build declares its bundled ids and the plugin is not bundled, it is enabled in persisted config with its server entry (if any) loaded, every `dependsOn` id is discovered, enabled and loaded, `hostApi` is satisfied, and `auth.trustedPlugins` pins its id to the current content hash. Otherwise `PluginStatus.client` SHALL be `{ delivery: "refused", refusedReason }` ("Refused clients report one reason").

#### Scenario: Untrusted plugin is refused visibly
- **WHEN** a plugin with a valid `clientBundle` is installed and not listed in `auth.trustedPlugins`
- **THEN** `/api/plugins` SHALL report `client.delivery: "refused"` and `refusedReason: "untrusted"`
- **AND** the Plugins tab SHALL show the refusal with a Trust action that displays the package path and full hash
- **AND** no claim of that plugin SHALL render

#### Scenario: Disabled runtime plugin
- **WHEN** a trusted runtime plugin is disabled through the Plugins tab
- **THEN** the next listing SHALL omit it, and its status SHALL report `refusedReason: "disabled"`

#### Scenario: Unloaded dependency blocks admission
- **WHEN** a trusted runtime plugin declares `dependsOn: ["quota"]` and `quota` is disabled
- **THEN** its status SHALL report `refusedReason: "missing-dep"`, and the listing SHALL omit it

### Requirement: Refused clients report one reason

`refusedReason` SHALL be one of `untrusted`, `pin-mismatch`, `host-api`, `no-bundle`, `build-undeclared`, `disabled` or `missing-dep`, and the Plugins tab SHALL render it. When several conditions fail, the server SHALL report the first in the order `build-undeclared`, `no-bundle`, `host-api`, `disabled`, `missing-dep`, `untrusted`, `pin-mismatch`. A trust entry without `clientSha256` SHALL count as `untrusted`.

#### Scenario: Reason is rendered
- **WHEN** a runtime plugin is refused with `missing-dep`
- **THEN** the Plugins tab SHALL show the refusal and its reason on the plugin's row

#### Scenario: Structural reason wins over consent
- **WHEN** a runtime-eligible plugin is untrusted, disabled and has a disabled `dependsOn` id
- **THEN** its status SHALL report exactly one reason, `refusedReason: "disabled"`, and the Plugins tab SHALL NOT offer the Trust action for it

#### Scenario: Sha-less trust entry reports untrusted
- **WHEN** `auth.trustedPlugins` holds `{ id: "ext", server: true }` with no `clientSha256` and every other admission condition holds
- **THEN** `ext`'s status SHALL report `refusedReason: "untrusted"` and the listing SHALL omit it

### Requirement: The content hash pin is recomputed and never wildcarded

The content hash SHALL cover the `clientBundle` directory's allowlisted, realpath-confined files. The server SHALL recompute it on every listing and status read, reusing a per-file digest only while `(relpath, size, mtimeMs, ino, ctimeMs)` is unchanged, and SHALL discard every cached digest on each discovery refresh and package-operation completion. A trust entry without `clientSha256` SHALL NOT admit a client, and no wildcard pin SHALL exist.

#### Scenario: Rebuilt bundle is noticed without a refresh
- **WHEN** an author rebuilds a trusted plugin's bundle with `vite build --watch`
- **THEN** the next `/api/plugins` read SHALL report `refusedReason: "pin-mismatch"` with the new hash, and the Plugins tab SHALL offer "Trust this version"

#### Scenario: Same-size package update with normalised mtimes
- **WHEN** a trusted pi-package plugin is updated by npm to a version whose `dist/client.js` has the same size and the same normalised mtime
- **THEN** the next status read after the package-operation completion SHALL report `refusedReason: "pin-mismatch"` with the new hash

#### Scenario: Old asset hash is gone
- **WHEN** a client requests `/plugin-assets/<id>/<old-sha>/chunk.js` after the bundle changed
- **THEN** the server SHALL answer 404, the failing claim SHALL be contained by its error boundary, and the shell SHALL show the reload notice

### Requirement: One trust list for client code and app mounts, with per-surface freshness

`auth.trustedPlugins` SHALL be the single operator trust list for plugin capabilities that need consent, and config parsing SHALL keep an `auth` object holding only it. The `serveApp` gate SHALL admit a plugin that is bundled, listed in `auth.trustedPlugins`, or listed in the legacy `auth.capabilityRoutePlugins`. The dashboard SHALL NOT write `auth.capabilityRoutePlugins` again. A refused `serveApp` call SHALL set `PluginStatus.serveApp: "refused"` in addition to logging.

#### Scenario: Legacy list keeps app mounts working
- **WHEN** config contains only `auth.capabilityRoutePlugins: ["wall"]`
- **THEN** the wall plugin's `serveApp` mount SHALL still be admitted

#### Scenario: Refused mount is visible
- **WHEN** an untrusted plugin calls `ctx.serveApp`
- **THEN** its status SHALL include `serveApp: "refused"`

#### Scenario: Config holding only trustedPlugins survives parsing
- **WHEN** `config.json` contains `auth: { trustedPlugins: [{ id: "ext", clientSha256: "<sha>" }] }` and no other auth key
- **THEN** the parsed config SHALL keep `auth.trustedPlugins`

### Requirement: Only the trust endpoints write the trust list

The trust endpoints SHALL be the only writers of `auth.trustedPlugins`. The generic `PUT /api/config` write SHALL ignore `auth.trustedPlugins` in its body and keep the stored value. A trust write SHALL change only `auth.trustedPlugins` and SHALL preserve every other `auth` key, including `capabilityRoutePlugins`. `PUT /api/config` handling of `auth.capabilityRoutePlugins` SHALL stay as it is today and SHALL NOT be widened.

#### Scenario: Remote config write cannot grant trust
- **WHEN** a paired remote device with an `operate` bearer sends `PUT /api/config` with `auth.trustedPlugins: [{ id: "ext", clientSha256: "<sha>" }]`
- **THEN** the stored `auth.trustedPlugins` SHALL be unchanged and `ext` SHALL NOT be admitted

#### Scenario: Trust write preserves the legacy list
- **WHEN** config holds `auth.capabilityRoutePlugins: ["wall"]` and a local operator trusts `ext`
- **THEN** the stored config SHALL hold both `capabilityRoutePlugins: ["wall"]` and the new `trustedPlugins` entry

### Requirement: Bundled app-mount trust is path-contained, not name-matched

For the `serveApp` gate a plugin SHALL count as bundled only when its discovery source is `workspace`, `bundled` or `installed`, the realpath of its package directory lies inside the realpath of the monorepo `packages/`, of the dashboard's `resources/plugins`, or of `~/.pi/dashboard/plugins`, and its directory name is in the server's bundled-plugin list. A directory-name match alone SHALL NOT make a plugin bundled; `pi-package` and `local-detected` copies never count as bundled.

#### Scenario: Look-alike directory name is not bundled
- **WHEN** a pi-package plugin lives at `~/.pi/agent/npm/node_modules/@evil/goal-plugin` and `goal-plugin` is in the bundled-plugin list
- **THEN** `serveApp` SHALL refuse it unless its id is in a trust list

#### Scenario: First-party plugin installed under the dashboard plugins dir keeps its mount
- **WHEN** `craft-web-plugin` is installed at `~/.pi/dashboard/plugins/craft-web-plugin` (`source: "installed"`) and wins discovery
- **THEN** its `serveApp` mount SHALL be admitted as bundled, as it is today

### Requirement: Trust freshness differs per surface

For a runtime client, a grant or revoke SHALL take effect on the next listing; a revoke SHALL make `/plugin-assets` answer 404 for that plugin at once, while already-loaded modules stay until page reload and the shell shows the reload notice. For `serveApp`, a grant or revoke SHALL take effect on the next server start; until then the plugin's status SHALL carry `restartRequired: true`.

#### Scenario: serveApp grant needs a restart
- **WHEN** the operator trusts a plugin whose app mount was refused
- **THEN** its status SHALL carry `restartRequired: true` and the mount SHALL appear after the next server start

#### Scenario: Runtime client revoke is immediate for new loads
- **WHEN** the operator revokes a loaded runtime plugin
- **THEN** the next listing SHALL omit it, `/plugin-assets` requests for it SHALL answer 404, and an open page SHALL keep the loaded module and show the reload notice

### Requirement: Trust endpoints are local-operator-only and auditable

`POST /api/plugins/:id/trust {sha256}` SHALL record `{ id, clientSha256 }` in `auth.trustedPlugins` only when `sha256` is the current content hash; `{server: true}` SHALL record `server: true` for a `pi-package` plugin. `DELETE` SHALL remove the entry. Both SHALL be `operate` tier in the route-tier map; `POST` SHALL also require a genuinely local caller. Both SHALL log id, action and the 12-hex hash prefix, and broadcast `plugins_changed`.

#### Scenario: Stale hash is rejected
- **WHEN** a local operator posts a hash that no longer matches the bundle on disk
- **THEN** the server SHALL answer 409 and SHALL NOT change config

#### Scenario: Remote operate device cannot grant
- **WHEN** a paired remote device holding an `operate`-tier bearer posts to `/api/plugins/ext/trust`
- **THEN** the server SHALL refuse the request and SHALL NOT change config

#### Scenario: Observe-tier caller cannot revoke
- **WHEN** an `observe`-tier device sends `DELETE /api/plugins/ext/trust`
- **THEN** the server SHALL refuse the request and SHALL NOT change config

#### Scenario: Every route is classified
- **WHEN** the route-tier totality test runs
- **THEN** `POST` and `DELETE /api/plugins/:id/trust` SHALL be `operate` and `GET /api/plugins/runtime-clients` SHALL be `observe`

### Requirement: Admitted assets are served from an immutable content-addressed prefix

The server SHALL serve admitted runtime client files at `GET /plugin-assets/<id>/<sha256>/<relpath>`, answering 404 unless `(id, sha256)` is admitted and `sha256` is the current hash, rechecked per request via the stat cache. The credential rule SHALL equal the host `/assets/*` rule, never weaker. Paths SHALL be realpath-confined and extension-allowlisted; responses `Cache-Control: public, max-age=31536000, immutable`. The service worker SHALL pass them through.

#### Scenario: Paired device loads plugin code without a bearer
- **WHEN** a paired remote device that loads the host `/assets/*` bundle renders a runtime claim
- **THEN** `import("/plugin-assets/ext-demo/<sha>/client.js")` SHALL succeed without an Authorization header, by the same credential that admits `/assets/*`

#### Scenario: Changed bytes are never served under the old hash
- **WHEN** a file in an admitted plugin's asset root is rewritten after the last listing, and a request for `/plugin-assets/<id>/<old-sha>/client.js` arrives before any listing or status read
- **THEN** the server SHALL answer 404 and SHALL NOT send the new bytes with an immutable cache header

#### Scenario: Unauthenticated request matches the host bundle
- **WHEN** an unauthenticated, non-local request asks for an admitted `/plugin-assets` file
- **THEN** the server SHALL answer exactly as it answers the same request for a host `/assets/*` file

#### Scenario: Traversal and unadmitted hashes are refused
- **WHEN** a request targets `/plugin-assets/ext-demo/<sha>/../../package.json` or a hash that is not admitted
- **THEN** the server SHALL answer 404

#### Scenario: Only allowlisted extensions are served
- **WHEN** an admitted plugin's asset root contains `client.js.map` and `package.json`
- **THEN** requests for them under `/plugin-assets` SHALL answer 404, while `.js`, `.mjs`, `.css`, font and image files SHALL be served

#### Scenario: Precompressed variant
- **WHEN** `client.js.gz` exists next to `client.js` and the request accepts gzip
- **THEN** the server SHALL send the `.gz` bytes with `Content-Encoding: gzip`

#### Scenario: Host policy, not an app policy
- **WHEN** a `/plugin-assets` response is sent
- **THEN** it SHALL carry the host's baseline CSP header for the current mode and no per-app `Content-Security-Policy`

### Requirement: Plugin asset and shim prefixes sit outside the guard

`/plugin-assets/` and `/host/` SHALL be outside the network guard's jurisdiction, and the guard's namespace-coverage test SHALL list them as public code-only prefixes. The OAuth hook has no `/assets/*` skip today; it SHALL skip `/plugin-assets/` only if the pre-route verification finds that `/assets/*` relies on an exemption, and then only that exemption, by exact admitted-asset match.

#### Scenario: No exemption beyond the host bundle
- **WHEN** host `/assets/*` reaches the OAuth hook with no skip
- **THEN** `/plugin-assets/*` SHALL get no OAuth skip either

#### Scenario: Coverage test knows the new prefixes
- **WHEN** the network-guard namespace-coverage test runs
- **THEN** it SHALL pass with `/plugin-assets/` and `/host/` registered as public code-only prefixes, and SHALL fail if any `/api/` route is served under them

### Requirement: Runtime client listing endpoint

`GET /api/plugins/runtime-clients` SHALL stay inside the network guard. For each admitted runtime plugin it SHALL return:

- `id`, `displayName`;
- the entry-module URL and, per claim, every manifest field plus its `module` URL when declared;
- `eventTypes`;
- route descriptors;
- the stylesheet URL, when declared.

All URLs SHALL be under `/plugin-assets/<id>/<sha256>/`. Refused plugins SHALL be omitted; their reasons appear in `/api/plugins`.

#### Scenario: Claim fields are forwarded intact
- **WHEN** a runtime plugin declares a `shell-overlay-route` claim with `path`, `depth`, `presentation`, `parentPath` and `sessionParam`
- **THEN** the listing SHALL include all five fields

### Requirement: The shell registers runtime claims with parity

At boot, unless the page targets a remote server, the shell SHALL fetch the listing. For each admitted plugin without a same-id build-time plugin it SHALL import the entry module, add every claim with the entry's functions and component (or a lazy `module` component), register its i18n, re-register route descriptors as the build-time ∪ runtime union, add its display name to name lookups, and bump the claims version. `clientStyles` SHALL attach as a `<link>` on first claim render.

#### Scenario: Late listing still renders
- **WHEN** the listing response arrives after the settings page has mounted
- **THEN** the plugin's settings section SHALL appear without any user action

#### Scenario: Runtime predicate is honoured
- **WHEN** a runtime `session-card-badge` claim names `shouldRender: "isQuotaSession"` exported by the entry module
- **THEN** the badge SHALL render only for sessions where `isQuotaSession` returns true

#### Scenario: Runtime routes keep build-time routes
- **WHEN** a runtime plugin registers a `shell-overlay-route` descriptor
- **THEN** back navigation SHALL still resolve every build-time plugin route, and SHALL resolve the runtime route at its declared depth

#### Scenario: Runtime settings section stays on the owner's page
- **WHEN** a runtime plugin `ext` registers a `settings-section` claim
- **THEN** it SHALL render only at `/settings/plugins/ext` beneath the host chrome, per `dashboard-plugin-loader` "Plugin-contributed `settings-section` claims SHALL render ONLY under the owning plugin's row", and on no other settings page

#### Scenario: Runtime plugin strings are translated
- **WHEN** a runtime plugin calls `useT()` for a key in its own catalog
- **THEN** the translated string SHALL render

### Requirement: Runtime plugins are unavailable in remote-server mode

When the client targets a remote dashboard server (a non-empty API base), the shell SHALL NOT fetch the runtime listing, inject styles or import runtime plugin modules. The Plugins tab SHALL show "Runtime plugins are unavailable while connected to a remote server". Build-time plugins SHALL be unaffected.

#### Scenario: Switching to a remote server
- **WHEN** the user switches the client to a remote server that has an admitted runtime plugin
- **THEN** no request to `/plugin-assets` SHALL be made, the notice SHALL be shown, and build-time claims SHALL keep rendering

### Requirement: Plugins can be added without a reload, but not removed or upgraded

On a `plugins_changed` broadcast the shell SHALL re-fetch the listing and register claims for newly admitted plugins without a page reload.

When a plugin is removed, refused, or its bundle hash changes, the shell SHALL keep the already-loaded module until the page is reloaded. It SHALL show a non-blocking "Plugin changes need a reload" notice.

#### Scenario: Install appears live
- **WHEN** an operator installs and trusts a runtime plugin while the dashboard is open
- **THEN** its claims SHALL appear after the `plugins_changed` broadcast, without a reload

#### Scenario: Upgrade asks for reload
- **WHEN** a loaded runtime plugin's bundle changes
- **THEN** the shell SHALL show the reload notice and SHALL NOT swap the module in place

### Requirement: Runtime plugin failures are contained

A runtime plugin that fails to link or render SHALL be contained by the per-claim error boundary, and the shell SHALL keep rendering. Example failures: a missing host export, a duplicate React, a thrown render. A failing entry-module import SHALL skip that plugin's claims and log the plugin id.

#### Scenario: Missing export is contained
- **WHEN** a runtime plugin imports a name the host public surface does not export
- **THEN** only that plugin's claims SHALL render nothing, the error SHALL be logged with the plugin id, and sibling claims SHALL render

### Requirement: A page without an import map loads no runtime plugin

When the page has no import map (served by the Vite dev server in `--dev`), the client loader SHALL import no runtime plugin and SHALL show "Runtime plugins need the production page" in the Plugins tab. The server SHALL NOT guess this state.

#### Scenario: Vite-served page skips runtime plugins
- **WHEN** the dashboard runs with `--dev`, Vite serves `index.html`, and a trusted runtime plugin is admitted
- **THEN** the client SHALL make no `/plugin-assets` request and SHALL show the notice, and build-time claims SHALL render

### Requirement: Runtime bundles use the utilities-only CSS contract

Runtime plugin stylesheets SHALL contain Tailwind utilities only, without preflight or a theme redeclaration. They SHALL theme through the host's documented CSS custom properties. The SDK preset SHALL produce stylesheets in this form.

#### Scenario: Plugin styles follow the host theme
- **WHEN** the user switches the dashboard theme
- **THEN** a runtime plugin element styled with `bg-[var(--bg-surface)]` SHALL change with it

### Requirement: SDK preset builds runtime bundles safely

`dashboard-plugin-runtime` SHALL ship a Vite preset that builds a plugin's `clientBundle` as an ES entry module plus lazy claim chunks, marks every import-map specifier external, emits utilities-only CSS, and optionally emits a standalone SPA from the same source. It SHALL fail the build when the bundle would include React or a context- or singleton-bearing client-utils module (`useMobile`, `LayerPortal`, `escape-stack`, `ActionListMenuContext`).

#### Scenario: Bundling React fails the build
- **WHEN** a plugin's preset build would bundle `react`
- **THEN** the build SHALL fail with a message naming the module and the import-map specifier to use instead

### Requirement: Runtime delivery decisions are observable

On every discovery cycle and on every trust change the server SHALL log one structured line per runtime-eligible plugin. Each line SHALL carry the id, `source`, `client.delivery`, `refusedReason` when present, and the hash prefix: the first 12 hex characters of the content hash, never the full 64. Request bodies and tokens SHALL NOT be logged.

#### Scenario: Refusal reason in the log
- **WHEN** a plugin is refused for `pin-mismatch`
- **THEN** the server log SHALL contain a line with the plugin id, `refused` and `pin-mismatch`

#### Scenario: Log carries a 12-hex hash prefix
- **WHEN** a discovery cycle or a trust change logs a runtime-eligible plugin
- **THEN** its hash field SHALL match `^[0-9a-f]{12}$`, and no log line SHALL contain the full 64-hex content hash

### Requirement: Runtime client loading stays within a regression budget

Measured on the docker harness over 5 cold loads against the pre-change build, a page with zero runtime plugins SHALL add at most 10 kB gzip of host JavaScript and at most 2 requests. With one trusted runtime plugin, the claim-visible p95 SHALL be at most the first-party plugin page-body p95 plus 300 ms.

#### Scenario: Zero runtime plugins add bounded overhead
- **WHEN** the stock build with no runtime plugin is cold-loaded 5 times and compared with the pre-change build
- **THEN** the extra gzip host JavaScript SHALL be ≤ 10 kB and the extra request count SHALL be ≤ 2

#### Scenario: Runtime claim appears within budget
- **WHEN** a page with one trusted runtime canary is cold-loaded 5 times
- **THEN** the p95 time until its claim is visible SHALL be ≤ the first-party plugin page-body p95 + 300 ms

### Requirement: Hash recheck stays within a server latency budget

With 10 runtime-eligible plugins of 50 asset files each and a warm stat cache, over 200 requests on localhost, `GET /api/plugins` and `GET /api/plugins/runtime-clients` SHALL each answer at p95 ≤ 50 ms, and a `/plugin-assets` request SHALL answer at p95 ≤ 10 ms.

#### Scenario: Per-read recompute stays cheap
- **WHEN** 200 timed requests run against each endpoint with 10 plugins × 50 files and a warm stat cache
- **THEN** `/api/plugins` and the listing p95 SHALL be ≤ 50 ms, and `/plugin-assets` p95 SHALL be ≤ 10 ms

### Requirement: Runtime delivery is verified on a dist-only install

Runtime client delivery SHALL be verified on an npm-global install, which has no monorepo root and no toolchain, because the docker harness runs from a full workspace (`/app`) and Electron's server bundle resolves a monorepo root, so neither proves the #930 target. The verification SHALL install a prebuilt fixture plugin, trust it locally, and observe its claim render with no client rebuild.

#### Scenario: Stock install renders a trusted runtime plugin
- **WHEN** a clean dist-only install receives a fixture plugin with `clientBundle` and `hostApi` under `~/.pi/dashboard/plugins`, and a local operator trusts its hash
- **THEN** its claim SHALL render after the `plugins_changed` broadcast, with no client rebuild and no page reload
