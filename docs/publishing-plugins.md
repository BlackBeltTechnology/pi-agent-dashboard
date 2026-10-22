# Publishing Plugin Packages to npm

Monorepo enforces **lockstep versioning** — every workspace `package.json`
MUST share same `version` (enforced by `scripts/sync-versions.js`, which
`exit 1`s on drift). Release workflow (`.github/workflows/publish.yml`)
bumps every workspace in lockstep on every release tag.

Problem for **first-time publishing of new plugin**: plugin inherits
current monorepo version (e.g. `0.4.5`) on first npm publish despite
never existing on npm before. To seed at `0.0.1`, procedure below
preserves lockstep invariant via **one-shot manual publish, then
revert** before any commit.

## When to use this procedure

**MUST do local manual seed publish for every brand-new plugin.**
Non-optional, because of npm's chicken-and-egg constraint:

- `.github/workflows/publish.yml` publishes via **OIDC / Trusted Publisher
  only** — intentionally no `NPM_TOKEN` secret in repo.
- npmjs.com **only allows Trusted Publisher config on package that already
  exists** (Settings → Trusted Publisher grey-locked until package has
  ≥1 published version).

So brand-new package's first publish CANNOT come from workflow — must
come from developer's machine with `npm login`. After first publish
lands, configure Trusted Publisher on npmjs.com; every subsequent
release publishes via workflow's OIDC path.

Whether to seed at `0.0.1` (one-shot, then revert — steps 4–7) or at
current lockstep version (skip 4–7, publish at e.g. `0.4.5`) is
stylistic. Either way, **manual local publish in step 6 required for
every new plugin**.

## Procedure

### 1. Drop `private`, add `publishConfig` and `license`

Edit new plugin's `package.json`:

```jsonc
{
  "name": "@blackbelt-technology/pi-dashboard-<your-plugin>-plugin",
  "version": "0.4.5",                    // current lockstep version
  // REMOVE: "private": true,
  "license": "MIT",                       // ADD
  "publishConfig": {                      // ADD
    "access": "public"
  },
  "type": "module",
  // … exports / files / pi-dashboard-plugin block stay as-is …
}
```

### 2. Declare every runtime workspace dep explicitly

In monorepo, workspace packages linked by npm's `workspaces:` hoist, so
plugin can `import "@blackbelt-technology/dashboard-plugin-runtime/context"`
without declaring in `dependencies`. **Breaks once published** — npm
consumers don't hoist.

Grep plugin source for every `@blackbelt-technology/*` import, ensure
each appears in `dependencies` of plugin's `package.json` with
`^<lockstep-version>`. Example:

```bash
grep -rEh "from \"@blackbelt-technology/[^\"]+\"" packages/<your-plugin>/src \
  | sed 's|.*from "\(@blackbelt-technology/[^/"]*\).*|\1|' | sort -u
```

### 3. Add plugin to publish workflow

Edit `.github/workflows/publish.yml`, add plugin to `PACKAGES=(...)` bash
array. Position matters:

- **After** `dashboard-plugin-runtime` (plugins depend on it).
- **Before** `@blackbelt-technology/pi-agent-dashboard` (root metapackage,
  depends on every sub-package, MUST publish last).

```bash
PACKAGES=(
  "@blackbelt-technology/pi-dashboard-shared"
  "@blackbelt-technology/pi-dashboard-extension"
  "@blackbelt-technology/pi-dashboard-server"
  "@blackbelt-technology/pi-dashboard-web"
  "@blackbelt-technology/dashboard-plugin-runtime"
  "@blackbelt-technology/pi-dashboard-flows-plugin"
  "@blackbelt-technology/pi-dashboard-<your-new-plugin>"   # ADD HERE
  "@blackbelt-technology/pi-agent-dashboard"
)
```

### 4. (One-shot 0.0.1 seed only) Bump new plugin to 0.0.1

```bash
# Edit ONLY new plugin's package.json — leave other workspaces alone.
# Breaks lockstep temporarily; revert in step 7.
sed -i '' 's/"version": "0.4.5"/"version": "0.0.1"/' \
  packages/<your-plugin>/package.json
```

Do NOT run `npm install` or `node scripts/sync-versions.js` in this state
— latter refuses with "Lockstep invariant violated".

### 5. Dry-run publish

```bash
npm publish --workspace=@blackbelt-technology/pi-dashboard-<your-plugin> --dry-run
```

Verify file list matches `files: ["src/"]`, package size sane (< 1 MB
usually), version `0.0.1`.

### 6. Publish for real

Must be logged in to npm with publish rights on `@blackbelt-technology`
scope:

```bash
npm whoami                   # confirm logged in
npm publish --workspace=@blackbelt-technology/pi-dashboard-<your-plugin> \
  --access public
```

> ⚠️ **Why this step is local, not in CI** — npm's Trusted Publisher
> (OIDC) grey-locked until package has ≥1 version on npm. Workflow has
> no `NPM_TOKEN`, so can never publish brand-new package. First
> `npm publish` of any new package MUST come from developer machine with
> `npm login`. Once landed, configure Trusted Publisher on npmjs.com:
>
> - Package → Settings → Trusted Publisher → Add
> - Publisher: GitHub Actions
> - Owner: `BlackBeltTechnology`
> - Repository: `pi-agent-dashboard`
> - Workflow filename: `publish.yml`
> - Environment: (leave blank)
>
> Until Trusted Publisher configured, every subsequent workflow run will
> fail to publish that package (per-package `FAIL=1` loop in
> `publish.yml` isolates failure so other packages still publish, but
> new plugin won't update until fixed). One-time per package.

### 7. Revert version to lockstep value

```bash
sed -i '' 's/"version": "0.0.1"/"version": "0.4.5"/' \
  packages/<your-plugin>/package.json
node scripts/sync-versions.js   # MUST report "Lockstep invariant OK"
```

### 8. Commit

```bash
git add packages/<your-plugin>/package.json .github/workflows/publish.yml
git commit -m "chore(release): make <your-plugin> publishable"
```

git history shows package at lockstep version (`0.4.5`); only npm sees
`0.0.1` seed. Next release tag publishes plugin at new lockstep version
(e.g. `0.4.6`) via regular workflow.

## Public host surface (what a plugin may import)

Package `@blackbelt-technology/dashboard-plugin-runtime`. Layers:

| Import | Surface | Notes |
|---|---|---|
| root `.` (= `src/public.ts`) | Versioned public API. Hooks (`useT`, `usePlugin*`, `useSession*`, `useUiPrimitive(OrNull)`), `lazyClaim`, `registerPromptComponent`, `PLUGIN_HOST_API_VERSION`, `satisfiesHostApi`, types `SessionEventReducerSlice` + `ToolRowFinalizer`. | Only surface behind the import map. Surface snapshot gate. |
| `./sdk` | Side-effect-free helpers bundled into the plugin: `encodeFolderPath`, `decodeFolderPath`, `folderRouteHref`, `UI_PRIMITIVE_KEYS` + slot-props types, `HOST_FX_CLASSES`, `HostApiRange`, pure `satisfiesHostApiRange(version, range)`. | NOT `PLUGIN_HOST_API_VERSION` / `satisfiesHostApi`: bundled copy would carry plugin's build-time version, not host's. |
| `./host` | Shell internals (66 names): slot consumers, `createSlotRegistry`, providers, `PluginContextProvider`, `useSlotRegistry`, `IntentRenderer`, `registerSessionEventReducer`. Consumed by `packages/client`. | Not import-mapped. Plugin code must not use it (plugin tests may). |
| `./context` | Deprecated alias for one minor. Re-exports plugin hooks + shell names. | Migrate imports to root. |
| `./server`, `./bridge`, `./embedded-app`, `./manifest-validator`, `./vite-plugin`, `./test-support` | Allowed subpaths. | `./embedded-app` import-mapped. |

- Removing a public name needs `PLUGIN_HOST_API_VERSION` major bump. Adding or changing a recorded shape needs at least minor. Gate: `node scripts/host-api-surface.mjs`. Snapshot: `packages/dashboard-plugin-runtime/host-api-surface.json`.
- Snapshot records: `public.ts` + `./sdk` export names, `UI_PRIMITIVE_KEYS` + prop shapes, slot-props + claim field shapes, `HOST_FX_CLASSES`, public CSS custom-property names, import-map specifiers.
- Shell-only names moved from root to `./host`. Root + `./context` keep `@deprecated` re-exports for one package minor. Release notes announce removal.
- Boundary gate (in-repo): `npm run check:plugin-boundary` (`scripts/check-plugin-boundary.mjs`). Plugin set from manifests (`pi-dashboard-plugin` field). Fails on any NEW core → plugin / plugin → plugin edge, STALE allowlist row, or in-repo plugin file importing a `./host` name from root without an `expires` row in `scripts/plugin-boundary-allowlist.json` (`hostRootImports`). Ratchet: rows only shrink.

## `hostApi` range

- Manifest `pi-dashboard-plugin.hostApi`: `^MAJOR.MINOR[.PATCH]` or exact `MAJOR.MINOR.PATCH`. Current `PLUGIN_HOST_API_VERSION = "1.1.0"` (1.1.0 added slot `composer-dock-process-group`, `ComposerDockRow`, `ProcessGroupSummary`; claim of it needs `^1.1`) (`packages/shared/src/dashboard-plugin/host-api.ts`).
- ONE range covers both halves (server entry + client). Checked at discovery. Result in `PluginStatus.hostApi`.
- `workspace` / `bundled` source: mismatch = warning only.
- `installed` / `pi-package` source: mismatch refuses both halves. Server entry not loaded (error `host-api`). Client `delivery: "refused"`, reason `host-api`.
- Required for `pi-package` plugins and any `clientBundle` plugin. Missing = incompatible. Optional elsewhere.
- Keywords: add `pi-dashboard-plugin` to package `keywords` so npm search + Packages tab find it.

## CSS contract

- Utilities-only Tailwind v4. No preflight. No `:root` theme redeclare.
- Theme via host CSS custom properties (`index.css` `:root` / `[data-theme]`) and `HOST_FX_CLASSES`. Both in surface snapshot.
- Public token names: those named in `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/host-design.md`.
- Build-time plugins: client `@source` coverage = generated tracked `packages/client/src/generated/plugin-sources.css`.
- Runtime plugins: `clientStyles` file from SDK preset.

## Runtime-delivered plugin client (SDK preset)

Plugin outside monorepo (or any non-bundled plugin) ships prebuilt ESM. Stock dashboard loads it with no rebuild. Full mechanism: [`runtime-plugin-clients.md`](runtime-plugin-clients.md).

### Manifest

```json
"pi-dashboard-plugin": {
  "id": "my-plugin",
  "hostApi": "^1.0.0",
  "clientBundle": "./dist/client/index.js",
  "clientStyles": "./dist/client/client.css",
  "i18nCatalog": "catalog",
  "claims": [ { "slot": "settings-section", "component": "MyPanel" } ]
}
```

- `clientBundle` + `clientStyles` separate from `client` (build-time source entry). May declare both.
- `dist/client/` = DEDICATED dir. It becomes served asset root. Server, bridge, `configSchema` entries stay under `src/`. Root dir or server/bridge inside it → client refused `no-bundle`.
- `files` allow-list needs `dist/client/` (+ `src/` of server entry). Neither `.gitignore` nor `.npmignore` may exclude `dist/client/` from tarball.

### Entry-module contract

`dist/client/index.js` = small ESM entry. Eagerly imported once plugin is listed. Exports:
- static fns of every claim: `predicate`, `shouldRender`, `resultPending`, `labelComponent`.
- components of claims WITHOUT `module`.
- optional `sessionEventReducer`, `toolRowFinalizers`.
- export named by `i18nCatalog` when declared (export name, not a file).

Claim with `module` (e.g. `./dist/client/lazy-panel.js`) → separate lazy chunk in same dir. Component stays lazy. Name chunks in manifest `module`.

### Preset usage

`dashboardClientViteConfig` / `buildDashboardClient` from `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin` (`src/vite-plugin/client-preset.ts`).

`vite.dashboard.config.ts`:

```ts
import { dashboardClientViteConfig } from "@blackbelt-technology/dashboard-plugin-runtime/vite-plugin";
export default dashboardClientViteConfig({
  entry: "src/dashboard/client.tsx",
  lazyModules: { "lazy-panel": "src/dashboard/LazyPanel.tsx" },
});
```

Options: `root`, `entry` (→ `<outDir>/index.js`), `lazyModules` (name → source, each → `<outDir>/<name>.js`), `outDir` (default `dist/client`), `styles` (`false` = none; `{sources}` = Tailwind scan dirs), `vite` (deep-merged extra config).

Preset output:
- ES entry module + one stable-named chunk per lazy module. Shared code in `chunks/`.
- EVERY import-map specifier external (`CLIENT_PRESET_EXTERNALS` = `HOST_IMPORT_MAP_SPECIFIERS`): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, the runtime root, `…/embedded-app`, app-kit `/react`, `wouter`. Host serves one instance of each.
- `client.css` utilities-only (`clientStylesTemplate`), host theme variables by reference.
- Automatic JSX, `jsxDev: false` (`react/jsx-dev-runtime` not in import map).

`package.json` script:

```json
"build:dashboard": "vite build --config vite.dashboard.config.ts --configLoader runner"
```

- `--configLoader runner` REQUIRED. Published runtime ships TypeScript sources. Node will not type-strip inside `node_modules`. Default config loader cannot import the preset.
- Dev deps: `vite`, `react`, `@types/react`; plus `tailwindcss` + `@tailwindcss/vite` when `styles` on.
- Scaffold: skill `dashboard-plugin-scaffold` mode `augment` emits manifest fields, `vite.dashboard.config.ts`, script, `files` entries. Mode `new` stays build-time (in-repo).
- Standalone half of same app: `dashboardStandaloneViteConfig` / `buildDashboardStandalone` (own React, own CSS, `dist/standalone`). See [`plugin-apps.md`](plugin-apps.md).

### Singleton guard

Build FAILS (`pi-dashboard-singleton-guard`, rollup `generateBundle`) when a chunk contains:
- React (`react`, `react-dom`, `scheduler`) → import via bare specifiers. Host has ONE React. Two Reacts = broken hooks + contexts.
- client-utils singleton modules (`useMobile`, `LayerPortal`, `escape-stack`, `ActionListMenuContext`) → use `useUiPrimitive` instead.
- Never import deep paths (`react/jsx-dev-runtime`, `react-dom/server`).
- `unsafeBundleSpecifiers` = TEST ONLY (failure-variant fixtures).
- Also never import a name that is not on the public surface. Runtime: link-time `SyntaxError: does not provide an export named` (contained per claim by `SlotErrorBoundary`).

### Trust (operator instructions)

Runtime client does NOT load until operator trusts it. Plugin author must tell operators:

1. `pi install <package>` (or Packages tab). Packages-tab install shows live. Terminal `pi install` shows after dashboard restart.
2. Settings ▸ Plugins: plugin shows `refused` / `untrusted`. Review source path + full hash.
3. Click **Trust**. Local operator only (paired remote device cannot grant). Writes `auth.trustedPlugins` `{id, clientSha256}`.
4. New build of the bundle → `pin-mismatch` → click **Trust this version** (one click). Browser reload to pick up changed/removed code.
5. Plugin has a server entry (`pi-package` source): also click **Trust server code** (`{server: true}`) or entry stays `server-untrusted`.

Authoring loop: `vite build --watch` + **Trust this version** + browser reload.

## Plugin app: one source, two builds

Embedded app + standalone SPA from one source. See [`plugin-apps.md`](plugin-apps.md) § "Runtime-loaded embedded apps (one app, two builds)".

## Plugin server TypeScript must be erasable

Breaking for plugin authors (change `strip-only-native-ts-loader`). Dashboard server loads plugin server TS with the Node-native strip-only loader. No transform mode, no transpile fallback.

- Erasable syntax only: no `enum`, no runtime `namespace`, no constructor parameter properties (declare explicit fields).
- Type-only imports use `import type` (Biome `style/useImportType`).
- Recommended: `"erasableSyntaxOnly": true` in plugin `tsconfig.json` (TypeScript `^5.8.0`).
- Non-erasable plugin fails to load in isolation; error names the file.
- CI gate `scripts/verify-plugin-install-load.mjs` loads plugins under the native loader.

## Verification checklist

- [ ] `node scripts/sync-versions.js` exits 0 with "Lockstep invariant OK"
- [ ] `npm view @blackbelt-technology/pi-dashboard-<your-plugin> version`
      returns `0.0.1`
- [ ] Trusted Publisher configured on npmjs.com for new package
- [ ] Plugin appears in `publish.yml`'s `PACKAGES=(...)` array
- [ ] All `@blackbelt-technology/*` imports declared in `dependencies`

## See also

- [`runtime-plugin-clients.md`](runtime-plugin-clients.md) — runtime client delivery, trust, import map
- `scripts/check-plugin-boundary.mjs` — core/plugin boundary gate
- `scripts/host-api-surface.mjs` — host API surface snapshot + bump gate
- `.github/workflows/publish.yml` — per-package skip-if-exists loop,
  Trusted Publisher / OIDC config notes
- `scripts/sync-versions.js` — lockstep invariant enforcer
- `packages/dashboard-plugin-runtime/package.json` — reference layout for
  publishable plugin-adjacent workspace package
