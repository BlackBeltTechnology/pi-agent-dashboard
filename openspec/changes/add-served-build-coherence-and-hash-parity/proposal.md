# Served-client build coherence + plugin-registry hash parity

> **Provenance.** Ported from the `JessieKaa/pi-agent-dashboard` fork, commit
> `3e2c56f8c` (+ follow-ups `e78d4dc61`, `285153e7d`, `3410a6c47`) — fork change
> `optimize-client-bootstrap-and-bundle-coherence`. The fork branched at
> `67111dfae` and is ~124 commits behind. The fork diff is reference material,
> **not** a patch to cherry-pick.
>
> **Scope changed during planning.** Doubt-review disproved the fork's stated root
> cause (see *Why* #1) and showed the lazy-bootstrap half needs four more call
> sites and a Vite chunk split than the fork's diff touches. The lazy half is
> therefore split into its own change (`add-lazy-terminal-diff-bootstrap`); this
> change keeps the build-coherence half and adds the hash-parity fix that the
> measurement actually pointed at.

## Why

**1. The staleness banner can never converge — because the two hashes are computed
over two different plugin sets, not because the bundle is stale.**

`PluginStalenessBanner` compares `/api/health.bundleHash` against the
`PLUGIN_REGISTRY_HASH` embedded in the loaded bundle. Those two numbers are
produced from **structurally different plugin sets** on `develop` today:

| | build-time (`vite-plugin/index.ts:104`) | runtime (`system-routes.ts:900`) |
|---|---|---|
| fixture filter | `isProd && fixture === true` → drop | `config.dev ? keep all : drop fixture` |
| client-entry filter | `Boolean(p.clientEntryPath)` → **drop client-less** | **none** |
| discovery roots | `discoverPlugins(repoRoot)` → `<repo>/packages` only | `discoverPlugins()` → monorepo **+ `~/.pi/dashboard/plugins` + bundled `resources/plugins`** |

Measured on a clean checkout:

```
discovered: 17   runtime-prod: 16   build-prod: 15   no-client: ['mcp-server']
runtime  bundleHash      : 30cffc0118551a07…
build-time registry hash : 4e1f10fbdbfd764d…   == embedded PLUGIN_REGISTRY_HASH
```

`packages/mcp-server-plugin` declares no `client` entry, so it is in the runtime
hash and never in the build hash. **The banner is therefore permanently "stale" on
every checkout, and no amount of refreshing converges** — which is exactly the
fork's reported symptom (`879d335…` vs `59d19bd…`, refresh loop). A user-installed
plugin under `~/.pi/dashboard/plugins` reproduces the same permanent mismatch on a
non-monorepo host.

`openspec/specs/plugin-manifest-staleness/spec.md` already *requires* parity
("Endpoint hash matches build-time hash when bundle is up to date"). The
implementation violates its own spec.

**2. The built client and the served client can still silently drift.**
`POST /api/restart` restarts a server that resolves the **installed**
`@blackbelt-technology/pi-dashboard-web/dist` first (`server.ts:2015-2024`,
module-resolver identity), while `npm run build` writes the **workspace**
`packages/client/dist`. Nothing in the health surface or in
`scripts/rebuild-restart.sh` reports which static directory is being served or
whether it agrees with the running plugin set. This is a real second-order
failure mode — it just is not what produced the fork's measurement.

*Upstream delta:* `develop` has **no** `clientBuild` health field, **no**
`scripts/sync-served-client.mjs`, and **no** `build-metadata.ts` in
`dashboard-plugin-runtime`. Nothing here is superseded.

## What Changes

- **One plugin set feeds every hash.** A shared "client-registry plugin set"
  selector in `dashboard-plugin-runtime` applies the same filters (client entry
  present, fixture policy, bundle-eligible roots only), and **every** producer
  selects through it: the vite-plugin build path, its dev `configureServer`
  regeneration, `scripts/generate-plugin-registry.mjs`, and the server's
  `bundleHash`. Plugins discovered only from a runtime-only root
  (`~/.pi/dashboard/plugins`) are excluded from both sides — no build can emit an
  import for them, so counting them only fabricates staleness. This makes
  `PluginStalenessBanner` converge and brings the implementation back in line with
  the existing `plugin-manifest-staleness` spec.
  *Known gap recorded, not fixed here:* user-installed plugins therefore
  contribute no client UI; runtime-loadable plugin UI is a separate change.
- **Production builds emit a served-artifact declaration.**
  `packages/client/dist/pi-dashboard-build.json` records a schema version, the
  plugin-registry hash already embedded as `PLUGIN_REGISTRY_HASH`, and the fixture
  policy the build applied (so a dev-mode server can reconstruct the artifact's
  set instead of reading `mismatched` forever because of `demo-plugin`). No
  timestamps, no machine-specific paths (reproducible-build safe). Written by the dashboard
  Vite plugin's production output lifecycle, from the same selected set. Dev/HMR
  registry generation stays source-only and writes no declaration.
- **The hash is computed over a declared set, not over discovery output.**
  New `dashboard-plugin-runtime/src/server/build-declaration-sdk.ts` +
  `build-metadata.ts` take the plugin set as an explicit input and delegate the
  digest to the existing `pluginRegistryHash` / `deterministicSerializePlugins`
  (already order-normalised and path-free) rather than re-implementing it.
- **The server reports whether its served artifact matches its plugin set.**
  Static-root resolution extracts into one helper (`server/src/lib/client-dist.ts`)
  preserving the existing package-first identity **and its exact fallback
  condition** (workspace sibling only when the package is *unresolvable*).
  Resolution moves ahead of `registerSystemRoutes` in bootstrap so one snapshot
  serves both fastify-static and the health route. `/api/health` gains an
  **additive** `clientBuild`:
  `{ pluginRegistryHash: string | null, status: "matched" | "mismatched" | "metadata-missing" | "not-served" }`.
  `.bundleHash`'s shape and the `PluginStalenessBanner` contract are unchanged.
  A startup diagnostic names the condition **without printing a filesystem path**.
- **The developer rebuild path deploys one verified artifact set.**
  `scripts/sync-served-client.mjs` resolves the served destination the same way
  the server does, mirrors the freshly built workspace output into it when the two
  differ (stale hashed assets removed, not accumulated), and verifies both sides
  carry identical declarations. A destination that predates this change (no
  declaration yet) is an explicit **adoptable** case, not a refusal deadlock.
  **Both** `scripts/rebuild-restart.sh` and its twin
  `scripts/rebuild-and-restart.sh` run it between build and restart, so an
  incoherent set fails **before** any restart or bridge reload and the gate cannot
  be bypassed by picking the other script. API-only hosts and workspace-only
  layouts are explicit supported outcomes.

Explicitly **excluded**: the lazy terminal/diff bootstrap (its own change —
`add-lazy-terminal-diff-bootstrap`), Markdown global-primitive registration and
MDI reduction, mobile banner layout-shift work, startup metadata request fan-out,
sidebar session-state fan-out, DnD measurement scaling.

## Capabilities

### Added Capabilities

- `served-client-build-coherence` — the production client artifact carries a
  deterministic build declaration; the server reports whether the static artifact
  it actually serves agrees with its runtime plugin set; the local rebuild path
  verifies that agreement before restarting.

### Modified Capabilities

- `plugin-manifest-staleness` — the build-time hash and the server-side hash are
  computed over the **same** plugin set (same filters, same discovery roots), so
  the parity the spec already requires actually holds on a real host.

## Impact

**Code**

- NEW `packages/dashboard-plugin-runtime/src/server/client-registry-set.ts` —
  the single selector every hash producer uses.
- `packages/dashboard-plugin-runtime/src/server/loader.ts` — expose the selector;
  no change to `deterministicSerializePlugins` / `pluginRegistryHash`.
- NEW `packages/dashboard-plugin-runtime/src/server/build-metadata.ts`,
  `build-declaration-sdk.ts` (+ `server/index.ts` re-exports).
- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — select through
  the shared helper on both the build and dev-regeneration paths; emit the
  declaration on production output.
- `scripts/generate-plugin-registry.mjs` — select through the shared helper so the
  tsc/vitest registry basis cannot diverge from the build basis.
- `packages/server/src/routes/system-routes.ts` — `bundleHash` selects through the
  shared helper; additive `clientBuild`.
- NEW `packages/server/src/lib/client-dist.ts` — single static-root resolver.
- `packages/server/src/server.ts` — resolve before `registerSystemRoutes`, serve
  that directory, read the declaration, path-free startup diagnostic.
- NEW `scripts/sync-served-client.mjs`; `scripts/rebuild-restart.sh` **and**
  `scripts/rebuild-and-restart.sh` gain the verify step.

**Tests**

- Parity tests: a client-less plugin present ⇒ build hash == runtime hash; a
  plugin under a runtime-only discovery root ⇒ excluded from both sides; a
  client-contributing fixture plugin ⇒ one policy applied to both sides.
- Declaration emit / validate / read, incl. malformed and missing metadata.
- Server health tests for all four `clientBuild` states + unchanged `bundleHash`.
- Sync-helper tests over temp directories: mirrors a complete build, adopts a
  declaration-less legacy destination, refuses a structurally invalid destination,
  never reports a post-copy mismatch as success.
- `PluginStalenessBanner.test.tsx` stays green, plus a new case proving it hides
  when a client-less plugin is present (the regression this change fixes).

**Docs**

- Nearest-directory `AGENTS.md` rows for the new helpers and changed
  vite/server files (DocScribe for any `docs/` prose).
- `README.md` — distinguish a workspace-only build from the verified local
  deployment path.
- `docs/architecture.md` — plugin-set selection → build → served static artifact →
  health compatibility flow (the *Plugin Staleness Detection* section is now
  inaccurate about which set each hash covers).

**Risk / compatibility**

- Changing `bundleHash`'s input set changes its **value** on every host. That is
  the point (it currently never matches), and it is one-way: every browser tab
  loaded before the change sees a differing hash once and shows the banner once,
  then converges after the refresh it asks for — on a host whose served artifact
  is already drifted, convergence arrives with the sync step, not before.
- `/api/plugins/manifest` (named in the existing `plugin-manifest-staleness` spec)
  is **not implemented** on `develop`; the banner reads `/api/health.bundleHash`.
  This change targets the surface that exists and does not implement the endpoint.
- `/api/health.clientBuild` is purely additive.
- `sync-served-client.mjs` performs **filesystem mutation on a deployment path** —
  it must refuse rather than guess when the two sides disagree structurally.
- No deployment or restart is performed by this change's implementation or
  verification; running `rebuild-restart.sh` against the live dashboard remains a
  separately authorized action.

## Discipline Skills

- **`observability-instrumentation`** — `/api/health.clientBuild` + the startup
  diagnostic are a new health surface for an existing blind spot (which static
  artifact is served). Status enum, no new job or external call.
- **`review-code`** — a filesystem-mutating deployment helper plus a change to a
  hash every browser tab compares against.
- **`systematic-debugging`** — applied during planning and load-bearing: the
  root cause in *Why* #1 was established by measurement (hash probe over the real
  plugin set), overturning the fork's stated cause. Any further "banner still
  shows" report must be re-rooted the same way, not patched at the banner.

`security-hardening` does not apply (no untrusted input or secret surface; the
health field deliberately carries no filesystem path). `performance-optimization`
moved out with the lazy half. `doubt-driven-review` — ran during planning; it
produced the scope change recorded above.
