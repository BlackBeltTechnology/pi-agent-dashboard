## Why

Issues:
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/931 — dashboard plugins are not decoupled from the core (the core imports plugins directly).
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/930 — external plugins can't contribute UI to a stock dashboard.

Both issues sit on the same boundary. The host has no supported public API. So the core reaches into plugins, and plugins (in-repo and external) copy or deep-import host internals. #931 fixes the direction of the dependencies. #930 fixes how plugin UI is delivered. Together they make a plugin a separable unit.

Six spikes verified the evidence and corrected it. Verdicts are in [`spikes.md`](./spikes.md). Per-spike detail is on branches `spike/decouple-s{1..6}-*`. Doubt cycles 1–3 re-checked every citation (see `design.md` › Context).

**Core → plugin coupling (#931), corrected by S1/S2:**
- Production core → plugin imports exist in exactly 5 files:
  - `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx:26` and `packages/client/src/lib/chat/event-reducer.ts:410,412` → `subagents-plugin/client`.
  - `packages/client/src/lib/package/anthropic-peer.ts:11` → `flows-anthropic-bridge-plugin/peer-probe`.
  - `packages/server/src/server.ts:12-15` and `packages/server/src/auth/radius-mcp.ts:22` → `mcp-client-plugin/core` (factories, not the running plugin).
- `ModelSelector`→roles and `shared/recommended-extensions`→mcp-client are a comment and a data string, not imports.
- Plugin → plugin imports in production code:
  - mcp-server → mcp-client factories: `mcp-server-plugin/src/server/index.ts:30`, `legacy-entry-migration.ts:25`.
  - apple-tools → mcp-client: `env.ts`, `install.ts`, `server/index.ts`.
  - chat-gateway → mcp-server: `chat-gateway/src/server/team/tier.ts:13`.
- A third coupling the original proposal missed: 25 hand-written plugin `@source` lines in `packages/client/src/index.css:18-46`.
- Hidden coupling: a hard-coded `flow_` prefix in the reducer (`event-reducer.ts:3339`) and `toolName === "Agent"` in `ToolCallStep.tsx:113`.
- Run without an allowlist, the gate reports 100 coupling edges: prod 11 / test 34 / package.json 30 / css 25. 24 of the package.json edges are the client's intended build-time bundling and become manifest-derived exemptions. The 25th, `client/package.json:50` → `keycloak-resolver-plugin`, names a plugin with no `client` and is unused by client source, so it stays a row. 76 rows remain.
- The plugin set has to come from manifests. A `*-plugin` name match misses `apple-tools`, `cost-estimator` and `demo-plugin`.

**External UI gap (#930), corrected by S3/S4/S6:**
- External plugins are dropped at two points:
  - Discovery: `discoverPlugins(repoRoot)` scans only `<repo>/packages` (`dashboard-plugin-runtime/src/server/loader.ts:124-133`).
  - Selection: `selectClientRegistryPlugins` drops roots outside `bundleRootsFor()` (`dashboard-plugin-runtime/src/server/client-registry-set.ts:74,86`). npm-global hosts have no monorepo root (`server/src/lib/client-dist.ts:89-97`). Electron does resolve one, because its server bundle `package.json` declares `workspaces` (`packages/electron/scripts/bundle-server.mjs:241`, `loader.ts:64-82`), but that root holds only the `BUNDLED_WORKSPACE_PKGS` copies; most plugins sit in `resources/plugins`. Filesystem roots cannot say what a build bundled on either host.
- Build-time widening (Option A) works in dev, but it cannot reach Electron or npm installs. Those ship only `dist/` and have no toolchain (S4; `docs/electron-immutable-bundle.md`).
- Runtime ESM loading (Option B) is proven in a **stock production build** (S3). It uses a server-injected import map that points at host-built shim entries, so there is one React instance and host contexts can be read.
- The `serveApp` / app-kit path (Option C) is not an answer on its own. It provides no slots and no nav entry, and it needs trust plus a restart. As a ~6-line layer on B it works (S6).

**Host API gap (S5):**
- The folder codec is copied 5×.
- `ConfirmDialog` is re-implemented 2× in-repo.
- invoice-bot deep-imports 20 host files (including `ChatView`) by pinning and cloning the host repo.
- The runtime root exports 205 names. Only 53 are used by plugins.
- The `plugin-ui-primitive-registry` and `plugin-intent-protocol` specs forbid plugin `useUiPrimitive`, yet 11 plugins call it.

## What Changes

One change, seven phases with explicit dependencies (`design.md` › Migration Plan). Phases revert in reverse dependency order; irreversible ship points are named there.

- **Phase 0 — Boundary gate.**
  - `scripts/check-plugin-boundary.mjs`, run by a vitest wrapper and `npm run check:plugin-boundary`.
  - The plugin set comes from manifests. "Core" means every non-plugin package.
  - It catches every import form, `vi.mock` literals, package.json deps and CSS `@source`.
  - Manifest-derived exemptions: the generated registry, the generated `@source` file, and client deps on bundled plugins.
  - A ratcheting allowlist (`scripts/plugin-boundary-allowlist.json`, 76 rows) fails on any NEW edge and on any STALE row.
- **Phase 1 — Server/data inversions** (needs only Phase 0). Every PR deletes its own allowlist rows.
  - New non-plugin library `packages/mcp-core`. Server (Radius MCP), mcp-server and apple-tools import it directly; Radius MCP keeps working with mcp-client disabled.
  - The verb-tier table becomes shared generated data.
  - `PEER_AM_LEGACY` and the subagent types/helpers move to `shared`.
  - Manifest `eventTypes`: owner-unavailable events collapse to one compact row; the `flow_` prefix literal goes. The group row reuses the `rawEvent` role, so the chat-view look-aheads are unchanged.
  - Plugin `@source` lines are generated from manifests into a tracked, deterministic file.
  - The unused client dependency on `keycloak-resolver-plugin` is dropped.
- **Phase 2 — Public host API** (needs only Phase 0).
  - `public.ts` is the import-mapped, versioned surface re-exported by the root. Shell internals move to `./host` (deprecated root re-exports for one release, guarded by a gate symbol check). `./context`'s plugin hooks fold into the root and its shell names move to `./host`; `./context` stays one release as a deprecated alias. `./sdk` holds bundled pure helpers. In-repo `./context` imports (59 files: 14 core, 45 plugin) and the scaffold templates move to the root.
  - `PLUGIN_HOST_API_VERSION` plus a manifest `hostApi` caret range, checked at discovery for both plugin halves; the minimal discovery `source` it needs lands here. The host version is exported from `public.ts` (import-mapped); `./sdk` carries only the pure range helper, never a bundled copy of the version.
  - An export-and-shape surface snapshot gate.
  - The primitive-registry and intent-protocol specs are reversed: trusted plugin client code MAY call `useUiPrimitive`.
  - New `ui:chat-view` and `ui:elapsed-badge` primitives. The mirrored copies are migrated.
- **Phase 3 — Subagent extraction** (needs Phases 1 and 2).
  - `AgentToolRenderer` becomes a subagents-plugin `tool-renderer` claim built on primitives.
  - The plugin's client entry exports a session-event reducer slice and tool-row finalizers; the shell registers them, gated by the enabled set. Every core writer of `SessionState.subagents` moves: the `subagent_*` slice, the live `partialResult` hydration and the `/resume` backfill (`event-reducer.ts:2646-2676`, `:2845-2929`). Finalizers keep the session-end heal guards. Generic orphan-row heals stay in core, and so do the tool-name collapsed summaries (`tool-summary.ts`).
  - Plugin-owned events become one group row per type; owner availability is decided at render time.
- **Phase 4 — Discovery, invalidation and `plugins_changed`** (absorbed from `external-dashboard-plugins`; needs Phase 2).
  - First, `isServeAppTrusted` stops trusting by directory basename (realpath containment), with or before the new source.
  - A 4th discovery source, `~/.pi/agent/settings.json#packages[]`, through `listPiPackages` (`shared/src/pi-package-resolver.ts:144`). Its server entries and bridges are default-deny until a local operator grants server trust (grant ships in Phase 5).
  - A `source` field and one-row-per-id shadowing; shadowed copies never load.
  - Local-scope plugins are detected and reported, never loaded.
  - The discovery cache, keyed by root set plus the declared bundled ids, is refreshed from the package-operation completion listener (`server.ts:2852`), not from `package-routes.ts`. A local-scope operation reruns local detection only.
  - A `plugins_changed` broadcast (also from the toggle route) and a `restartRequired` flag.
  - `/api/health` stays path- and hash-free; paths, hashes and local rows go only to the guarded `/api/plugins`.
  - npm search for `pi-dashboard-plugin`.
- **Phase 5 — Runtime ESM client loading (Option B)** (needs Phases 2 and 4).
  - New manifest fields `clientBundle` / `clientStyles`.
  - "Bundled" is decided by the plugin ids the served build declares, not by filesystem roots. For those ids the build's own copy wins discovery on both halves; an undeclared build keeps today's selection.
  - Host shim entries and a server-injected import map.
  - Operator trust with a content-hash pin, granted only by a genuinely local operator through the trust endpoint (the generic config write cannot set it). Untrusted plugins show as `refused` in the Plugins tab. The same local-only endpoint grants `pi-package` server-entry trust.
  - Content-hashed immutable `/plugin-assets/<id>/<sha256>/…`, with a per-request hash recheck and no OAuth exemption beyond what `/assets` has, while the listing endpoint stays guarded.
  - All 12 direct registry readers subscribe to late claims.
  - Runtime parity for claim functions, route descriptors, i18n (the entry's `i18nCatalog` export) and display names.
  - A plugin can be hot-added without a reload. Removing or upgrading one needs a page reload. Not supported while the page targets a remote server.
- **Phase 6 — Option C on B, plus the SDK** (needs Phase 5).
  - Shims and import-map keys for `embedded-app`, app-kit `react` and `wouter`.
  - An SDK Vite preset that builds the embedded ESM and the standalone SPA from one source.
  - A guard against bundling singleton client-utils modules.
  - A runtime canary fixture.
  - The `dashboard-plugin-skill` `augment` mode emits `clientBundle`, `hostApi` and the preset build for external projects.
  - **Option A is deferred.** It has no tasks here (rationale in design D18).

## Capabilities

### New Capabilities
- `plugin-core-boundary` — manifest-derived plugin set, the forbidden edges, the ratcheting allowlist, the manifest-derived exemptions, and core MCP via the `mcp-core` library.
- `plugin-host-api` — public `public.ts` / `./host` / `./sdk` layering, host API versioning and the both-halves compat check, the surface snapshot, the shared-contract convention, the CSS contract, and decoded `cwd` for overlay routes.
- `plugin-runtime-client-loading` — `clientBundle` and its dedicated asset root, the declared-ids bundled rule and one winner per bundled id, the server-injected import map and shims, trust + pin + refused status, trust-endpoint-only writes, per-surface trust freshness, local-only grant, client-detected missing import map, the asset prefix, the listing endpoint, late registration, remote-server mode, the CSS contract for runtime bundles, the SDK preset, the singleton guard, and dist-only verification.

### Modified Capabilities
- `dashboard-plugin-loader` — runtime package entry points and allowed plugin subpaths, discovery cache keyed by root set and declared bundled ids, bundled-id discovery winner (by which copy exists), 4th discovery source + `source`/shadowing, `pi-package` server-entry trust (default-deny), bundle eligibility + generated `@source`, late claims, `GET /api/plugins` rows (`dependsOn`/`dependents` kept; `/api/health` path- and hash-free), toggle semantics for runtime clients (dependency graph kept, `plugins_changed` broadcast), enable-filter default-allow union and recompute triggers, refs-registry + intent coexistence, disabled-owner metadata, refresh + `plugins_changed`, extended `PluginStatus`, install/remove/failure, local-scope detection (also after local-scope operations), README, session-event reducer slices and finalizers (declarative, enabled-set gated, heal guards), tool-row behaviour, grouped plugin-owned events (as `rawEvent`-role rows) with render-time availability, dist-only lifecycle verification on npm-global.
- `dashboard-shell-slots` — the `tool-renderer` lookup re-runs on a claims-version bump ("one-shot per lookup"); the `tool-renderer` prop contract's `context` gains optional `send`.
- `plugin-ui-primitive-registry` — remove "consumed by IntentRenderer, not plugin code" and "plugin `useUiPrimitive` DEPRECATED"; modify provider distribution for self-providing primitives; add direct consumption, `ui:chat-view` and `ui:elapsed-badge`.
- `plugin-intent-protocol` — intents stay the path for bridge/server-originated UI; trusted plugin client code MAY render claims and call primitives; a plugin MAY use both paths for one slot (the per-claim exclusivity rule is removed).
- `session-end-orphan-heal` — the Agent subagent backfill and the subagent half of the live-tick reopen move to the subagents plugin's finalizer; core keeps the row heals.
- `subagents-plugin-state` — `SessionState.subagents` is written by the plugin's slice; the transitional note is resolved.
- `subagent-live-detail-reliability` — the durable `partialResult` hydration of a running subagent moves to the subagents plugin's `Agent` finalizer, dual index and non-regression kept.
- `agent-tool-rendering` — auto-expand comes from the claim's `expandWhileRunning`; the moved `AgentToolRenderer` consumes `AgentCardShell` through `ui:agent-card`; the collapsed summaries stay in core.
- `dashboard-plugin-skill` — `augment` mode targets runtime delivery (`clientBundle`, `hostApi`, keyword, SDK preset build); templates import the public root.
- `client-build-config` — plugin `@source` coverage comes from the generated, tracked `plugin-sources.css`; the hand-written-line rule is removed.
- `plugin-manifest-staleness` — the server-side hash set uses the build's declared bundled ids, so runtime plugins never enter it on any host; where no build copy exists on disk (npm-global) the server compares against the declaration instead of re-deriving.
- `served-client-build-coherence` — the build declaration gains `bundledPluginIds`.
- `message-severity-tokens` — the governed `AgentToolRenderer` path moves to the subagents plugin.
- `plugin-embedded-app` — runtime-loaded plugins embed apps (C on B).
- `package-install` — successful non-local operations refresh plugin discovery; successful local-scope operations rerun local detection only; update/remove of a loaded plugin sets `restartRequired`.
- No `chat-view` delta: plugin-owned group rows reuse the `rawEvent` role, which every chat-view look-ahead already skips (design D5).
- `package-search` — dashboard-plugin search type, type post-filter mapping, first-party keywords.
- `baseline-content-security-policy` — runtime plugin loading fits the baseline policy (import map relies on `'unsafe-inline'`; `blob:` scripts are not allowed; a future nonce policy stamps the map).

## Non-goals

- Plugin signing, a marketplace, or sandboxing / isolating plugin client code. This replaces the original non-goal "no trust model". The operator trust opt-in and hash pin in Phase 5 are in scope. The isolated path for untrusted plugins is still the descriptor protocol (`docs/untrusted-plugin-ui-gap.md`).
- Option A (build-time external roots) as a shipped path (D18).
- *Loading* local-scope (`<cwd>/.pi/settings.json#packages[]`) plugins. They are detected and reported only (D19).
- Hot removal or upgrade of an already-loaded plugin's client or server code. These need a page reload or a server restart (D14).
- Runtime plugin clients while the page targets a remote server (D20, Open Question 6).
- Moving individual features into plugins. `extract-git-as-plugin` and `extract-openspec-as-plugin` own that.
- Migrating invoice-bot-dashboard. That is external-repo work, enabled by Phase 2 (`ui:chat-view`) and Phase 5.

## Discipline Skills

- `security-hardening`: Phase 5 delivers JavaScript that runs in the dashboard origin with full page authority. It covers:
  - the operator trust list, hash pin and genuinely-local grant;
  - a public asset prefix outside guard jurisdiction;
  - import-map injection into server-rendered HTML;
  - realpath confinement;
  - the CSP `'unsafe-inline'` dependency.

  Phase 4 also discovers `settings.json#packages[]` plugins, whose server entries and bridges are default-deny until a local server-trust grant (a server entry runs next to auth, the vault and config), fixes the basename-spoofable `serveApp` trust before that source lands, and keeps paths and hashes off the public `/api/health`.
- `performance-optimization`: runtime `import()` adds requests to first paint. S3 baseline: +6.3 kB host total, ~7.3 kB / 7 requests per runtime plugin, and no measurable delta in claim-visible time. Shims also re-chunk the host bundle. Hash recompute on listing is stat-cached.
- `doubt-driven-review`: irreversible ship points — the `mcp-core` npm publish, shared contracts consumed by published plugins, the manifest fields `eventTypes`/`hostApi`/`clientBundle`, the `hostApi` 1.x surface (published with Phase 2), and the `/plugin-assets` URL scheme. Also the A/B/C delivery decision.
- `observability-instrumentation`: new endpoints and events — `GET /api/plugins/runtime-clients`, `/plugin-assets/*`, `POST|DELETE /api/plugins/:id/trust`, the `plugins_changed` broadcast, and the discovery refresh. Trust/admission decisions and refresh cycles need structured logs.
- `review-code`: before every phase commit.

## Impact

- **Code:**
  - `packages/client`, `packages/server`, `packages/shared`: remove plugin imports; add shims, import-map injection, runtime loader and asset route.
  - `packages/dashboard-plugin-runtime`: loader, client-registry-set, build declaration, vite-plugin, `packages/dashboard-plugin-runtime/src/manifest-validator.ts`, slot consumers, `public.ts` / `./host` / `./sdk` subpaths.
  - New `packages/mcp-core` and new `packages/shared/src/mcp/`.
  - Plugins: subagents, flows, flows-anthropic-bridge, mcp-client, mcp-server, apple-tools, chat-gateway, automation, kb, goal, skill-atlas, team, demo; `package.json` keywords on every first-party plugin; in-repo `./context` imports move to the root.
  - `dashboard-plugin-skill` scaffold templates and its `plugin-context-api.md` reference.
  - Non-plugin apps: `team-app` (no plugin manifest) moves to `chat-embed`'s `createHostPrimitiveRegistry()`.
  - `scripts/`, `public/sw.js` (verify only), `README.md`.
- **APIs (additive):**
  - `PluginStatus.{source, shadowed, restartRequired, hostApi, client, serveApp}`; `source` includes `local-detected`. One row per id: the absorbed design's second "shadowed" row is replaced by `shadowed[]` on the winner. `/api/health.plugins[]` gets only the path- and hash-free subset.
  - The `plugins_changed` WS message.
  - `GET /api/plugins/runtime-clients`, `GET /plugin-assets/<id>/<sha256>/<file>`, `POST|DELETE /api/plugins/:id/trust`, all in `shared/src/route-tiers.ts`.
  - Config `auth.trustedPlugins` (`{id, clientSha256?, server?}`). The legacy `auth.capabilityRoutePlugins` is still read.
  - Build declaration `bundledPluginIds`.
- **APIs (breaking, with a deprecation window):** shell-only runtime names (including `PluginContextProvider` and `useSlotRegistry` from `./context`) move to `./host`; the root and `./context` keep deprecated re-exports for one package minor. S5 found no runtime-plugin consumer of them; in-repo plugin tests are migrated in Phase 2. External build-time consumers are notified in the release notes.
- **Supersedes:** `external-dashboard-plugins` (absorbed; the orchestrator deletes it in the same commit, no retire task here):
  - Its PluginsSection UI already shipped via `add-plugin-activation-ui`.
  - Its remaining requirements — 4th source, `source`, shadowing, local-scope detection, cache invalidation, `plugins_changed`, `restartRequired`, install/remove/failure status, search keyword, README — are re-specified here with corrections (hook location, resolver reuse, one-row shadowing).
- **Overlaps and sequencing:**
  - `add-plugin-capability-routes` is partly shipped: `serveApp` (`server-context.ts:1247`, `app-mount.ts`), `isServeAppTrusted` (`serve-app-host.ts:48`) and `auth.capabilityRoutePlugins` (`shared/src/config.ts:208`) are in code. `registerCapabilityRoute`/`requestPrincipal` are not.
    - Phase 5 unifies its trust list and reuses its app-mount helpers. Land Phase 5 after that change's trust key is stable.
    - Both changes touch `baseline-content-security-policy`, but different requirements.
  - `extract-git-as-plugin` / `extract-openspec-as-plugin` are independent. After Phase 0 lands they add no allowlist rows: their client dep and `@source` line are manifest-derived exemptions.
- **Packaging:** new published package `mcp-core` (release set, `BUNDLED_WORKSPACE_PKGS` in `packages/electron/scripts/bundle-server.mjs:112-127`). The client `dist/` gains `host/*.js` shim entries.
- **Compatibility:**
  - In-repo plugins keep the build-time path. A bundled plugin with the same id wins over a runtime one.
  - `hostApi` is optional for workspace/bundled/installed plugins and required for pi-package and `clientBundle` plugins.
  - `./context` and the `./host` root re-exports are kept as deprecated for one minor.
  - Rollback in reverse dependency order; published contracts are deprecated, never withdrawn.

## Decisions to confirm

- `pi-package` server entries (and their bridges) load only after a local `server: true` grant in the same list; `installed`/`bundled`/`workspace` sources load as today (D12).
- Runtime plugin client code needs an operator opt-in through one unified list, `auth.trustedPlugins`, which also gates `serveApp` (`capabilityRoutePlugins` is still read). The entry is pinned to a content hash and granted only by a genuinely local operator; `PUT /api/config` cannot write it, and trust writes preserve `capabilityRoutePlugins`. Runtime-client trust is live; `serveApp` trust is restart-effective (D12).
- "Bundled" means "id in the served build's `bundledPluginIds`" on every host, and the build's own copy wins discovery for those ids on both halves (D11).
- Plugin JS/CSS is served from a content-hashed immutable public prefix `/plugin-assets/<id>/<sha256>/`, so bearer-less `import()` works on paired devices. The listing stays guarded. `serveApp`'s sandbox contract is not reused (D13).
- Hot add works through discovery invalidation plus `plugins_changed`; the loader imports each plugin's small entry module for claim functions and keeps components lazy. Removing or upgrading a runtime plugin requires a page reload. Server-entry code changes require a restart (D14).
- Core and plugins use the `mcp-core` library for MCP config; no new `ServerPluginContext` member (`whenProvided` dropped) and no new Radius refusal code (D3, D4).
- Absent-owner UX: manifest `eventTypes` groups an owner's unhandled events into one row per type, rendered collapsed only while the owner is unavailable (decided at render time, never by the reducer); an Agent tool call with no claim renders through `GenericToolRenderer`; generic orphan-row heals stay in core (D5).
- The boundary gate is a custom script with a ratcheting allowlist and manifest-derived exemptions. Biome and dependency-cruiser are not gates (D1, D2).
- Host API: `public.ts` is the import-mapped surface, shell-only names go to `./host`, `./context` folds in, `./sdk` holds bundled helpers. Plus `PLUGIN_HOST_API_VERSION`, manifest `hostApi` (the validator currently strips unknown keys, `packages/dashboard-plugin-runtime/src/manifest-validator.ts:759-776`), a name-and-shape surface snapshot, `ui:chat-view` and `ui:elapsed-badge` (D6-D8).
- Option A is deferred, and Option C is built as a thin layer on B (D9, D18).
- Local-scope plugins are detected and reported, never loaded (D19).
