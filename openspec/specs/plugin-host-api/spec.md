# plugin-host-api Specification

## Purpose
TBD - created by archiving change decouple-plugins-from-core. Update Purpose after archive.

## Requirements

### Requirement: Public runtime surface is the versioned host UI API

`packages/dashboard-plugin-runtime/src/public.ts` SHALL define the public host UI API, re-exported by the package root, holding only plugin-facing names. The runtime import-map shim SHALL re-export exactly `public.ts`.

#### Scenario: Plugin-used names stay public
- **WHEN** a plugin imports `useT`, `SettingsGroup`, `usePluginConfig` or `useUiPrimitive` from the runtime root
- **THEN** the import SHALL resolve, both at build time and through the import map at runtime

### Requirement: Public surface v1 members

The v1 members of `public.ts` SHALL be: i18n, settings kit, plugin config/send/message hooks, `usePluginLogger`, `usePluginRouter`, session read hooks including `useSessionEvents`, folder-menu hooks, action and route helpers, `bumpSlotClaimsVersion`, `PLUGIN_HOST_API_VERSION`, `satisfiesHostApi`, `SlotPill`, `RoleRef`, `copyText`, `oauthFlowClient`, `lazyClaim`, the UI primitive registry API, and the `SessionEventReducerSlice` / `ToolRowFinalizer` types.

#### Scenario: Plugin context API members are public
- **WHEN** a runtime-loaded plugin imports `usePluginLogger`, `usePluginRouter` and `useSessionEvents` from the runtime root
- **THEN** each import SHALL resolve through the import map, and each name SHALL be recorded in the surface snapshot

#### Scenario: Runtime plugin reads the host's version
- **WHEN** a runtime plugin built against host API `1.0.0` reads `PLUGIN_HOST_API_VERSION` from the runtime root on a host at `1.3.0`
- **THEN** it SHALL read `1.3.0`

### Requirement: Shell-only names live in `./host`

Names used only by the shell SHALL be exported from `./host`, among them every `*Slot` consumer, `createSlotRegistry`, `PluginContextProvider` and the other shell providers, `useSlotRegistry(OrNull)`, `initPluginConfigs`, `applyPluginConfigUpdate`, `IntentRenderer`, `SlotErrorBoundary`, claims-version hooks and the slice/finalizer registration functions. `./host` SHALL NOT be import-mapped or in `public.ts`. `__reset*ForTests` SHALL move to `./test-support`.

#### Scenario: Shell imports from ./host
- **WHEN** `packages/client/src/App.tsx` needs `createSlotRegistry`
- **THEN** it SHALL import it from `@blackbelt-technology/dashboard-plugin-runtime/host`

#### Scenario: Runtime plugin cannot reach shell internals
- **WHEN** a runtime-loaded plugin imports `createSlotRegistry` from `@blackbelt-technology/dashboard-plugin-runtime` through the import map
- **THEN** module linking SHALL fail with a missing-export error, and the plugin's claim boundary SHALL contain the failure

### Requirement: Root keeps deprecated shell re-exports for one release

For one package minor release the package root SHALL also re-export the `./host` names, each marked `@deprecated`, so build-time consumers keep compiling. These re-exports SHALL NOT be part of `public.ts`, the host API surface snapshot or the import-map shim. The boundary gate SHALL report every in-repo plugin file that imports a `./host` name from the root, unless an allowlist row with an `expires` version covers it; no such row SHALL outlive the deprecation release.

#### Scenario: Build-time plugin test keeps compiling during the deprecation window
- **WHEN** a plugin test imports `createSlotRegistry` from the package root during the deprecation release
- **THEN** the import SHALL resolve and the type checker SHALL report it as deprecated

#### Scenario: New root import of a shell name is reported
- **WHEN** a change adds `import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime"` to a plugin file with no allowlist row
- **THEN** the boundary gate SHALL fail naming the file and directing it to `./host` or `./test-support`

### Requirement: Allowlist `expires` is inclusive

An allowlist row's `expires` SHALL name the deprecation release itself. The boundary gate SHALL accept the row while the `dashboard-plugin-runtime` package version is ≤ `expires` and SHALL fail once the version is > `expires`, naming the row.

#### Scenario: Row is valid through its expiry release
- **WHEN** a row has `expires` equal to the current runtime version
- **THEN** the gate SHALL pass for the covered import

#### Scenario: Row past its expiry release fails
- **WHEN** the runtime version is greater than a row's `expires`
- **THEN** the gate SHALL fail naming the row and the covered file

### Requirement: `./context` folds into the public surface

The plugin-facing exports of `./context` (`src/plugin-context.tsx`: hooks such as `usePluginConfig`, `useSessionState`, `usePluginSend`) SHALL be exported from `public.ts`. Its shell-only exports (`PluginContextProvider`, `useSlotRegistry`, `useSlotRegistryOrNull`, `initPluginConfigs`, `applyPluginConfigUpdate`) SHALL move to `./host`. `./context` SHALL remain, marked deprecated, for at least one minor release, re-exporting both groups.

#### Scenario: Legacy context import keeps working
- **WHEN** a plugin imports `usePluginConfig` from `@blackbelt-technology/dashboard-plugin-runtime/context`
- **THEN** it SHALL receive the same function as the root export

#### Scenario: Shell name stays reachable through the alias
- **WHEN** a plugin test imports `PluginContextProvider` from `./context` during the deprecation release
- **THEN** it SHALL receive the `./host` export, and `PluginContextProvider` SHALL NOT be in `public.ts`

### Requirement: `./sdk` holds bundled pure helpers

A `./sdk` subpath SHALL export side-effect-free code, bundled into each plugin:

- `encodeFolderPath`, `decodeFolderPath`, `folderRouteHref(cwd, suffix)`;
- `UI_PRIMITIVE_KEYS`, the `UiPrimitiveMap` type, slot-props types;
- `HOST_FX_CLASSES`;
- the `HostApiRange` type and pure `satisfiesHostApiRange(version, range)`.

`./sdk` SHALL NOT import React or module-level state, nor export `PLUGIN_HOST_API_VERSION` / `satisfiesHostApi` (a bundled copy misreports the host).

#### Scenario: No host version in the bundled helpers
- **WHEN** the surface snapshot lists `./sdk` exports
- **THEN** it SHALL NOT contain `PLUGIN_HOST_API_VERSION` or `satisfiesHostApi`

#### Scenario: Folder codec has one source
- **WHEN** a plugin needs to encode a folder path for a route
- **THEN** it SHALL use `encodeFolderPath` or `folderRouteHref` from `./sdk`, and no plugin SHALL define its own copy

### Requirement: Host API version and manifest range

`packages/shared/src/dashboard-plugin/host-api.ts` SHALL export `PLUGIN_HOST_API_VERSION`, pure `satisfiesHostApiRange(version, range)` and the bound `satisfiesHostApi(range)`, accepting caret (`^MAJOR.MINOR[.PATCH]`) and exact versions with no semver dependency. `PluginManifest` SHALL accept optional `hostApi`, which `validateManifest` SHALL syntax-check and keep. `clientBundle` and `pi-package` plugins SHALL declare it; a missing range there is incompatible.

#### Scenario: hostApi survives validation
- **WHEN** a manifest declares `"hostApi": "^1.0.0"`
- **THEN** `validateManifest` SHALL return a manifest whose `hostApi` equals `"^1.0.0"`

#### Scenario: Malformed range is a validation error
- **WHEN** a manifest declares `"hostApi": "latest"`
- **THEN** validation SHALL fail for that plugin with an error naming the field

### Requirement: Host API compatibility gates both plugin halves

The loader SHALL evaluate `hostApi` against `PLUGIN_HOST_API_VERSION` during discovery and record `{ range, compatible }` on `PluginStatus.hostApi`. One range SHALL cover both the server entry and the client. An incompatible plugin from the `installed` or `pi-package` source SHALL NOT load its server entry (error naming `host-api`) and SHALL have its client refused with reason `host-api`. An incompatible `workspace` or `bundled` plugin SHALL be logged at warn and loaded.

#### Scenario: Major mismatch refuses a runtime plugin entirely
- **WHEN** host version is `1.2.0` and a pi-package plugin declares `^2.0.0`
- **THEN** `/api/plugins` SHALL show `hostApi.compatible: false`, `loaded: false`, and `client.delivery: "refused"` with `refusedReason: "host-api"`, and neither its server entry nor a bundle URL SHALL be loaded or listed

#### Scenario: Minor ahead is incompatible
- **WHEN** host version is `1.2.0` and the plugin declares `^1.9.0`
- **THEN** the plugin SHALL be incompatible

#### Scenario: pi-package plugin without hostApi
- **WHEN** a plugin discovered from `settings.json#packages[]` declares a server entry and no `hostApi`
- **THEN** its server entry SHALL NOT be loaded, and its status SHALL name the missing `hostApi`

#### Scenario: Bundled plugin mismatch only warns
- **WHEN** a workspace plugin declares a range the host does not satisfy
- **THEN** the loader SHALL log a warning naming the plugin and range, and SHALL load it

### Requirement: Host API surface snapshot gate

`packages/dashboard-plugin-runtime/host-api-surface.json` SHALL record the `public.ts` and `./sdk` names, `UI_PRIMITIVE_KEYS` with each `UiPrimitiveMap` props type, slot-props and claim field shapes, `HOST_FX_CLASSES`, the public CSS custom-property subset (see "Host CSS contract"), import-map specifiers, and the version. An `npm test` check SHALL fail when a recorded entry disappears without a major bump, or an entry is added or a shape changes without at least a minor bump.

#### Scenario: Removing a public export requires a major bump
- **WHEN** a change deletes `useLanguage` from `public.ts` without bumping the major version
- **THEN** the surface check SHALL fail naming `useLanguage`

#### Scenario: Adding an export requires a minor bump
- **WHEN** a change adds a `public.ts` export and leaves the version unchanged
- **THEN** the surface check SHALL fail and ask for a minor bump and a refreshed snapshot

#### Scenario: Primitive props change requires a bump
- **WHEN** a change alters the props type of `UiPrimitiveMap["ui:confirm-dialog"]` and leaves the version unchanged
- **THEN** the surface check SHALL fail naming `ui:confirm-dialog`

#### Scenario: Renaming a theme variable requires a major bump
- **WHEN** a change renames `--bg-surface` in the host stylesheet without a major bump
- **THEN** the surface check SHALL fail naming `--bg-surface`

### Requirement: Shell overlay routes receive a decoded folder

`shell-overlay-route` claim components SHALL receive a decoded `cwd` prop whenever the matched path has an `:encodedCwd` parameter. `encodedCwd` SHALL continue to be passed, deprecated, for one minor release.

#### Scenario: Plugin reads cwd directly
- **WHEN** the user opens `/folder/<encoded>/goals`
- **THEN** the goal plugin's route component SHALL receive `cwd` equal to the decoded folder path without calling a decoder

### Requirement: Shared contracts live in non-plugin packages

A contract shared between host and plugins, or between plugins, SHALL be declared in a non-plugin package: `packages/shared/src/dashboard-plugin/` for protocol types, or a core library such as `@blackbelt-technology/pi-dashboard-mcp-core`. A service key constant SHALL sit next to its type. The provider plugin MAY re-export the contract. A consumer plugin SHALL obtain a running service only through `consume` (with `dependsOn`) and SHALL NOT import the provider package.

#### Scenario: Plugin consumes another plugin's running service
- **WHEN** apple-tools needs the live MCP client config service
- **THEN** it SHALL import `McpClientConfigService` and `MCP_CLIENT_CONFIG_SERVICE_KEY` from `mcp-core` and call `ctx.consume(MCP_CLIENT_CONFIG_SERVICE_KEY)`, declaring `dependsOn: ["mcp-client"]`

### Requirement: Host CSS contract

The public CSS custom-property subset SHALL be exactly the tokens named in the plugin-author reference `dashboard-plugin-scaffold/references/host-design.md`, each declared in `packages/client/src/index.css`, patterns expanded ("Accent text tokens are public"). `theme-gallery` keeps the palette values. The host SHALL export plugin effect classes as `HOST_FX_CLASSES` from `./sdk`. Both SHALL be in the surface snapshot; renaming or removing either SHALL be a major change.

#### Scenario: Internal theme variable is not public
- **WHEN** a change renames an `index.css` custom property that the host-design reference does not name
- **THEN** the surface check SHALL NOT fail

#### Scenario: Automation card uses FX classes by constant
- **WHEN** the automation plugin applies the stripe effect
- **THEN** it SHALL use `HOST_FX_CLASSES.stripes` rather than a literal class name

### Requirement: Accent text tokens are public

The reference's pattern `--accent-<hue>-text` SHALL stand for all six tokens `--accent-purple-text`, `--accent-blue-text`, `--accent-green-text`, `--accent-orange-text`, `--accent-red-text` and `--accent-yellow-text`, the ramp `theme-gallery` requires. The surface snapshot SHALL record all six and SHALL never record an unexpanded pattern.

#### Scenario: Every accent text token is public
- **WHEN** a change renames `--accent-orange-text`, which the reference names only through `--accent-<hue>-text`
- **THEN** the surface check SHALL fail naming `--accent-orange-text`

### Requirement: Embeds get a host primitive registry factory

The chat-embed entry of the web client SHALL export:

- `createHostPrimitiveRegistry()`, which registers every `UI_PRIMITIVE_KEYS` implementation the dashboard registers;
- `EmbedProviders`, the provider stack ChatView needs.

Standalone embeds SHALL use these instead of re-registering primitives or deep-importing client source. The factory takes no dependencies; shell-bound wrappers keep their no-context form outside `<App>` (`ui:model-selector`: no favorites or refresh).

#### Scenario: team-app drops its main.tsx copy
- **WHEN** team-app mounts an embedded chat
- **THEN** it SHALL obtain primitives from `createHostPrimitiveRegistry()` and SHALL NOT import `ThinkingBlock`, `ToolCallStep` or `MarkdownContent` by deep path

#### Scenario: Model selector in an embed
- **WHEN** an embed renders `ui:model-selector` inside `EmbedProviders`
- **THEN** it SHALL render the passed models and call `onSelect`, and SHALL offer no favorites toggle or refresh
