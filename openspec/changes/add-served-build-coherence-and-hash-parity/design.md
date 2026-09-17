# Design — served-client build coherence + plugin-registry hash parity

## Context

See `proposal.md — Why` for motivation, including the hash probe that overturned
the fork's stated root cause. Current-state facts that shape the approach (each
verified against source during planning):

- **The two hashes cover different sets.** `vite-plugin/index.ts:98-112`
  (`loadPluginEntries`) calls `discoverPlugins(repoRoot)` and filters
  `isProd && fixture === true` **plus** `Boolean(p.clientEntryPath)`.
  `system-routes.ts:900-904` calls `discoverPlugins()` (no root → monorepo +
  `~/.pi/dashboard/plugins` + bundled `resources/plugins`, per `loader.ts:120-131`)
  and filters only `config.dev ? true : fixture !== true`. Measured:
  runtime `30cffc01…` vs build `4e1f10fb…` (== the embedded
  `PLUGIN_REGISTRY_HASH` at `plugin-registry.tsx:567`); the delta is
  `mcp-server`, the one plugin with no `client` field.
- `deterministicSerializePlugins` / `pluginRegistryHash` (`loader.ts:251-299`)
  already sort by plugin id and by claim tuple, and serialize **manifest data
  only** — no paths, no package dirs. Order-normalisation and reproducibility are
  solved; the *set* is what is wrong.
- `server.ts:2013-2027` resolves the static root inline, **~350 lines after**
  `registerSystemRoutes(...)` is called at `server.ts:1668`. The fallback fires
  only when `require.resolve` **throws**: a resolvable package whose `dist/` has
  no `index.html` yields API-only mode, *not* a workspace fallback.
- `scripts/rebuild-restart.sh` is build → `pi-dashboard restart` →
  `./scripts/reload-all.sh`. Both of the last two touch the live system.
- `PluginStalenessBanner.tsx:38-42` reads `/api/health.bundleHash` (the spec
  `plugin-manifest-staleness` describes `/api/plugins/manifest`; both must end up
  on the same set).

## Goals / Non-Goals

**Goals:**

- One plugin-set selector feeding build-time and runtime hashes, so the staleness
  banner converges and the existing spec's parity requirement actually holds.
- One resolved static directory per server process, visible to the health surface.
- A reproducible build artifact that declares what plugin set produced it.
- A rebuild path that fails *before* restart when built ≠ served.

**Non-Goals:**

- Runtime-loaded plugin UI. A client-contributing plugin still requires a client
  build to appear; this change makes that condition *reported honestly*, not
  eliminated.
- Auto-repair at server startup. The server reports; only the rebuild script
  mutates, and only when run explicitly.
- Lazy terminal/diff bootstrap — split into `add-lazy-terminal-diff-bootstrap`.
- Reconciling the `plugin-manifest-staleness` spec's `/api/plugins/manifest`
  wording with the banner's actual `/api/health.bundleHash` call site beyond
  making both use the same set.

## Decisions

### D0 — A shared client-registry plugin-set selector (the actual fix)

New `dashboard-plugin-runtime/src/server/client-registry-set.ts`:

```
selectClientRegistryPlugins(discovered, { isProd }) →
  discovered.filter(p => Boolean(p.clientEntryPath))
            .filter(p => isProd ? p.manifest.fixture !== true : true)
```

Every hash producer selects through it: `loadPluginEntries` (build), the
vite-plugin's dev `configureServer` regeneration path, `system-routes.ts`
(`bundleHash`), and `scripts/generate-plugin-registry.mjs` (the tsc/vitest basis).
The digest stays `pluginRegistryHash(...)` on both sides — **no second
serializer**. Missing any one producer reintroduces the split this change exists
to close, so each is an explicit task.

*Why a selector and not "make the server filter too":* the filter is the contract
between two packages built at different times. Writing it once, in the package
that owns the hash, is what stops it drifting again — and the fork's history (two
follow-up commits fixing the same hash) is the evidence that an implicit contract
does not hold.

*Fixture policy:* the runtime currently keeps fixtures in dev
(`config.dev ? true : …`) while a dev build keeps them too (`isProd &&` guard) —
these already agree; the selector preserves that by taking `isProd` explicitly.

*Discovery roots:* the selector takes the **bundle-eligible** roots — the roots a
build can actually emit imports for. Plugins discovered only from a runtime-only
root (`~/.pi/dashboard/plugins`) are excluded from **both** hashes, because they
cannot enter any bundle:

- `vite.config.ts:67` hardcodes `viteDashboardPluginsPlugin(path.resolve(__dirname, "../.."))`
  for every build path — local, `publish.yml`, `_electron-build.yml`, and the
  `prepare` script. There is no local-vs-release seam to split.
- The generated registry imports either by package name or by a path relative to
  `packages/client/src/generated`; an out-of-tree `~/.pi/dashboard/plugins/<pkg>`
  resolves from neither, so such a build fails outright.
- `packages/client/src/generated/plugin-registry.tsx` is **git-tracked**
  (`.gitignore` whitelists it), so a host-rooted build permanently dirties the
  tree and would break every other host's CI.

Counting a plugin that can never be bundled only fabricates staleness — the same
class of bug as the `mcp-server` case. **Known gap (recorded, not fixed here):**
user-installed plugins therefore contribute no client UI at all; making them
runtime-loadable is a separate change.

What this change removes is the *fabricated* mismatch. A genuine one (in-repo
plugin set changed since the artifact was built) still reports, as it should.

*Blast radius:* `bundleHash`'s **value** changes on every host. Every tab loaded
before the upgrade shows the banner once, then converges — the first time the
banner has ever been able to converge.

### D1 — Declaration file, not a header or an inline marker

`packages/client/dist/pi-dashboard-build.json` with
`{ schemaVersion, pluginRegistryHash, fixturePolicy }`.

*Why `fixturePolicy`:* `packages/demo-plugin` is `fixture: true` **and** ships a
client entry. A production build drops it; a dev-mode server keeps it. Without
recording which policy produced the artifact, the server cannot reconstruct the
artifact's set and a dev host would read `mismatched` forever. The field is a
closed enum (`"excluded" | "included"`) — no host data, still reproducible.

*Why:* the server must learn the artifact's identity without parsing or executing
JS. A sidecar JSON is one `readFileSync` at startup, survives `preCompressed`
serving, and is trivially comparable directory-to-directory by the sync script.
`packages/client/package.json` ships `files: ["dist/"]`, so it publishes.

*Alternatives:* parse the hash out of the emitted bundle (brittle under
minification/chunk renames); an HTTP header on `index.html` (invisible to the
sync script's directory comparison); a meta tag (couples to HTML shape).

*Reproducibility:* two fields only — no timestamp, path, or host name.

### D2 — Declaration SDK wraps the existing digest, never re-implements it

`build-metadata.ts` owns the file shape + read/validate/write.
`build-declaration-sdk.ts` computes a declaration from an **explicitly supplied**
plugin list by calling `selectClientRegistryPlugins` (D0) and then
`pluginRegistryHash` (`loader.ts:295`).

*Why explicit input:* the fork shipped this twice because discovery order/location
leaked into its own hash implementation. Here the only digest is the existing,
already order-normalised one, so the declaration hash and the embedded
`PLUGIN_REGISTRY_HASH` are equal **by construction**, not by a test's goodwill —
task 1.4's test is a regression guard, not the mechanism.

### D3 — Extract static-root resolution, and move it before `registerSystemRoutes`

`server/src/lib/client-dist.ts` exports the resolver returning `string | null`
(no `source` discriminator — nothing consumes it; the health shape is path-free
and the sync script resolves for itself) plus a declaration reader producing the
four-state snapshot.

Resolution **moves earlier in bootstrap**, above `server.ts:1668`, so one snapshot
feeds both `registerSystemRoutes` and (further down) `registerManifestRoute` /
`fastifyStatic` / all three `setNotFoundHandler` branches. This relocation is
explicit because a literal in-place edit is impossible: the route registration
precedes the current resolution site by ~350 lines.

*Precedence is preserved exactly*, including the subtle part: the workspace
fallback fires **only when `require.resolve` throws**. A resolvable package with
no `dist/index.html` stays API-only. A resolver that "helpfully" falls back there
would change deployment behaviour — a spec scenario pins this.

*Alternative:* export a mutable module-level `clientDir` — rejected; it makes the
health route order-dependent on bootstrap and untestable in isolation.
*Alternative:* re-resolve inside the health route — rejected; two resolutions can
disagree, which is the bug class this change exists to close.

### D4 — Four-state `clientBuild`, startup snapshot, no filesystem path

`{ pluginRegistryHash: string | null, status: "matched" | "mismatched" |
"metadata-missing" | "not-served" }`.

*Four states:* "no static client" (API-only — a supported deployment) ≠ "present
but undescribed" (pre-change artifact) ≠ a real hash disagreement. Collapsing them
destroys the diagnosis the field exists for.

*Comparison basis:* the served declaration's hash vs `pluginRegistryHash(
selectClientRegistryPlugins(discoverPlugins(), { isProd: <the artifact's declared
fixturePolicy> }))` — the same selector `bundleHash` uses after D0, evaluated
under the policy the artifact declares (D1). In production both fields are the
same expression; in dev `clientBuild` reconstructs the artifact's policy while
`bundleHash` keeps its dev-conditional one, which is why the policy is declared
rather than assumed.

*Snapshot, not live probe:* read once at startup. `clearDiscoveryCache` is only
called from the vite-plugin (build process), so the runtime side is stable within
a process; making the served side live would introduce a per-request `readFileSync`
and a field that flickers mid-session. The spec states the snapshot semantics
explicitly so "I synced but health still says mismatched" is documented, not a
surprise. Restart is the refresh.

*No path:* `/api/health` is reachable from any authenticated tab and over the zrok
tunnel; filesystem layout is host information with no diagnostic value to a
browser. The same restriction covers the startup log — including the error path:
a failed read is caught and reported by **status**, never by echoing an `fs` error
message (which embeds the absolute path).

*Dev mode:* with Vite up, browsers get Vite's module graph, not `clientDir`. The
field describes the production fallback directory; the spec says so rather than
pretending otherwise.

### D5 — Sync mirrors, adopts a legacy destination, refuses only real ambiguity

`scripts/sync-served-client.mjs` resolves the destination via the *same* resolver
(jiti precedent: `scripts/generate-plugin-registry.mjs` already imports server TS
from `.mjs`). Outcomes:

| Situation | Outcome |
|---|---|
| destination == source | no-op success |
| destination is a valid build (with or without a declaration) and differs | **mirror** the source in (superseded hashed assets removed), then verify both declarations equal |
| no destination resolves | explicit "API-only host" success |
| source has no/invalid declaration, or post-copy declarations differ | **refuse**, non-zero exit |
| destination exists but is not structurally a client build | **refuse**, non-zero exit — never write |

*Legacy adoption:* a pre-change destination has no declaration by definition (it
is the `metadata-missing` state the migration plan produces). Refusing there would
be a deadlock with no exit — the destination can only gain a declaration through
the copy being refused. The gate is therefore "is this a client build?" (has
`index.html`), not "does it already declare itself?".

*Mirror, not copy:* a plain copy leaves orphaned `assets/*.js` from earlier builds
in the served directory, which contradicts "one coherent artifact set" and slowly
grows a deployment path.

*Ordering in `rebuild-restart.sh`:* build → sync+verify → restart → reload. A
failed verify aborts before either live-system step (`set -euo pipefail` already
gives this, given a non-zero exit). **Both** rebuild scripts are wired —
`scripts/rebuild-and-restart.sh` is a twin with the same build → restart → reload
body; wiring only one leaves the verification trivially bypassable.

*Permissions:* a destination under a root-owned global `node_modules` will throw
`EACCES`. That is reported as a refusal with a remediation hint, not a stack trace
mid-deploy.

## Risks / Trade-offs

- **`bundleHash` value changes for everyone** → one-time banner on stale tabs,
  which then converges; this is strictly better than today's never-converging
  banner. Pinned by a new `PluginStalenessBanner` test asserting *hidden* when a
  client-less plugin is present.
- **A published artifact + locally installed client plugin reports `mismatched`**
  → accepted and documented (D0): it is true, and the remediation is a local
  rebuild. The alternative (hiding it) reintroduces a silent-drift blind spot.
- **Moving resolution earlier in bootstrap touches server startup order** →
  the moved block has no dependency on anything between `:1668` and `:2013`
  (it only uses `createRequire`/`existsSync`); verified by the existing server
  and packaging tests plus a boot smoke check.
- **`sync-served-client.mjs` writes to a deployment path** → refuse-rather-than-
  guess, structural gate before any write, temp-directory tests for every outcome.
- **Verification accidentally deploying** → no task may run `rebuild-restart.sh`
  end-to-end; the sync step is verified directly over temp directories, and the
  script wiring is verified by asserting the script aborts (exit code + absence of
  the restart call), never by letting the success path run.
- **Trade-off — `clientBuild` is a startup snapshot**, so it lags a live sync until
  restart. Accepted: the alternative is per-request filesystem reads on a hot
  health endpoint for a value that only changes at deploy time.
- **Convergence claim is weaker on an already-drifting host** → after step 1 a
  stale tab reloads and may re-fetch the *old* served dist, still mismatched. That
  window closes at step 4 (the sync), not step 1; `clientBuild` is what makes the
  window visible instead of mysterious.
- **`/api/plugins/manifest` does not exist** in `packages/server/src` — the
  existing `plugin-manifest-staleness` spec describes it aspirationally and the
  banner reads `/api/health.bundleHash` instead. This change does **not**
  implement the endpoint; its delta scenarios target the surface that exists, and
  the endpoint requirement keeps its current (unimplemented) status.

## Migration Plan

No data migration, no API break.

1. Land the shared selector + both call sites (build & runtime) — this alone fixes
   the banner. Hash values change here.
2. Land declaration emit + read (inert without a consumer).
3. Land the resolver extraction + relocation + `clientBuild` health field.
4. Land `sync-served-client.mjs` and wire it into `rebuild-restart.sh`.

An artifact built before step 2 reports `metadata-missing` — correct and
non-failing — and is adoptable by step 4's sync.

**Rollback:** each step is independently revertable. Reverting step 1 restores the
(broken) previous hash basis; reverting step 3 leaves `bundleHash` untouched.
