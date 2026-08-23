# Plugin Manifest Schema

Canonical schema. Mirrors `dashboard-plugin-loader/spec.md` Requirement 1 in the dashboard repo.

## Location

The manifest field lives **at the top level of `package.json`** (NOT nested under `pi`, NOT in a sibling `dashboard-plugin.json`).

```jsonc
{
  "name": "@scope/my-plugin",
  "version": "0.1.0",
  "pi-dashboard-plugin": { /* manifest here */ }
}
```

## TypeScript shape

```ts
interface PluginManifest {
  id: string;                    // kebab-case, globally unique
  displayName: string;
  priority?: number;             // default 1000; first-party uses 100; lower = earlier
  requiredApi: string;           // semver range, e.g. "^0.x"
  client?: string;               // path to bundled client entry (package-relative)
  server?: string;               // optional path to server entry (package-relative)
  bridge?: string;               // optional path to pi-extension entry (package-relative)
  configSchema?: string;         // optional path to JSON Schema 7 file (package-relative)
  fixture?: boolean;             // if true, excluded from production builds
  claims: PluginClaim[];
}

interface PluginClaim {
  slot: SlotId;                  // must match a known slot id
  component?: string;            // exported component name from client entry (for React slots)
  command?: string;              // for "command-route" slot
  trigger?: string;              // for "anchored-popover" slot
  toolName?: string;             // for "tool-renderer" slot
  path?: string;                 // for "shell-overlay-route"; wouter path pattern, must start with "/"
  sessionParam?: string;         // for "shell-overlay-route"; URL param holding session id; default "sid"
  depth?: 1 | 2;                 // for "shell-overlay-route"; shell nav depth; 1 = detail, 2 = overlay-on-detail
  parentPath?: string;           // for "shell-overlay-route" depth 2; back target pattern; :params interpolated
  presentation?: "dialog" | "page"; // for "shell-overlay-route"; default "dialog"
  config?: Record<string, unknown>; // slot-specific config (e.g. { tab: "general" })
  predicate?: string;            // optional name of an exported predicate function
}
```

### `shell-overlay-route` claim fields

Route-backed overlay claim. Component receives `{ params, onBack, session? }`.

`presentation` selects container. Optional. Default `"dialog"`.

- `"dialog"` — route-backed overlay. Desktop: `Dialog` over scrim over pinned background underlay. Mobile: inside `MobileShell` detail panel at declared `depth`.
- `"page"` — full-viewport on desktop AND mobile, outside `MobileShell` detail panel. Opt-out. Use for width-hungry surfaces (boards, wide tables).

Unknown `presentation` value → FATAL `ManifestValidationError`. NOT warn-and-default. Typo like `"modal"` would silently restore the behaviour the author opted out of. Validator: `packages/dashboard-plugin-runtime/src/manifest-validator.ts`.

Container selection: the HOST decides. It reads the effective `presentation` via `useShellOverlayRoutePresentation` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx`) and lifts a `dialog` claim out of the content region into its route-backed overlay; `ShellOverlayRouteSlot` itself renders only the claim body plus a height wrapper. A hook returning a string avoids the `client-utils` → `dashboard-plugin-runtime` dependency cycle a component import would close.

Bundled-plugin gate (`packages/dashboard-plugin-runtime/src/__tests__/bundled-overlay-claims.test.ts`): explicit `depth` required; `depth: 2` requires `parentPath`; `parentPath` interpolable from claim path's own `:params`; claim nested under `/folder/:x` or `/session/:x` must NOT declare `depth: 1`. Third-party manifests: runtime degrades to `/` as safety net.

See change: add-route-backed-overlay-dialogs.

## Forward-compat contract

The skill enforces these at scaffold time so augmented external extensions Just Work when the dashboard's future `node_modules` discovery scan ships:

1. The manifest field is **at the top level** of `package.json`.
2. All paths in the manifest (`client`, `server`, `bridge`, `configSchema`) are **package-relative**, do not begin with `/`, and do not contain `..` segments that escape the package root.
3. The manifest does **NOT reference workspace-only constructs** (no `workspace:*` deps, no monorepo-relative imports).
4. The package's `exports` field declares `./client`, `./server`, `./bridge` subpaths matching the manifest paths.
5. The manifest includes `requiredApi` (semver range string).

## Example — minimal

```jsonc
{
  "name": "@acme/my-plugin",
  "version": "0.1.0",
  "exports": {
    "./client": "./src/client.tsx"
  },
  "dependencies": {
    "@blackbelt-technology/dashboard-plugin-runtime": "^0.4.6",
    "@blackbelt-technology/pi-dashboard-shared": "^0.4.6"
  },
  "pi-dashboard-plugin": {
    "id": "acme",
    "displayName": "Acme",
    "priority": 100,
    "requiredApi": "^0.x",
    "client": "./src/client.tsx",
    "claims": [
      { "slot": "session-card-badge", "component": "AcmeBadge" }
    ]
  }
}
```

## Example — full

```jsonc
{
  "name": "@acme/full-plugin",
  "version": "0.1.0",
  "exports": {
    "./client": "./src/client.tsx",
    "./server": "./src/server/index.ts",
    "./bridge": "./src/bridge/index.ts"
  },
  "dependencies": {
    "@blackbelt-technology/dashboard-plugin-runtime": "^0.4.6",
    "@blackbelt-technology/pi-dashboard-shared": "^0.4.6"
  },
  "pi-dashboard-plugin": {
    "id": "acme-full",
    "displayName": "Acme (full)",
    "priority": 100,
    "requiredApi": "^0.x",
    "client": "./src/client.tsx",
    "server": "./src/server/index.ts",
    "bridge": "./src/bridge/index.ts",
    "configSchema": "./configSchema.json",
    "claims": [
      { "slot": "sidebar-folder-section", "component": "AcmeFolderSection" },
      { "slot": "session-card-badge", "component": "AcmeBadge" },
      { "slot": "session-card-action-bar", "component": "AcmeActionBar" },
      { "slot": "content-view", "component": "AcmeBrowser" },
      { "slot": "content-header-sticky", "component": "AcmeHeader" },
      { "slot": "content-inline-footer", "component": "AcmeFooter" },
      { "slot": "anchored-popover", "trigger": "acme-popover", "component": "AcmePopover" },
      { "slot": "command-route", "command": "/acme", "component": "AcmeBrowser" },
      { "slot": "settings-section", "component": "AcmeSettings", "config": { "tab": "general" } },
      { "slot": "tool-renderer", "toolName": "AcmeRunTool", "component": "AcmeToolRenderer" }
    ]
  }
}
```
