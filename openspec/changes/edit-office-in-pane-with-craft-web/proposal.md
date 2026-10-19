## Why

The editor pane can only *preview* Office files. Editing a `.docx` means leaving the dashboard for a desktop app on the server machine, which is impossible for remote and phone clients.

Every ArtCraft Crafting App now ships an official static WebAssembly build (`<app>-web-<ver>.zip`, MIT/Apache-2.0, iframe-embeddable). An explore-mode spike (2026-10-18, WordCraft 0.8.0) showed the dashboard can drive one in place:
- a host-injected file drop opens a workspace `.docx`;
- the app's Save goes through `showSaveFilePicker`, where a stubbed handle hands back the edited bytes (valid OOXML).

This change packages that as a **dashboard plugin** on top of the core file-handler extension point (`add-editor-pane-file-handlers`), so core stays free of ArtCraft.

## What Changes

- **New plugin `craft-web`** (`packages/craft-web-plugin`, `defaultEnabled: false`, bundled — listed as `craft-web-plugin` in the server's `bundledPlugins`, which makes it a trusted plugin for `serveApp`). It contributes `editor-pane-file-handler` edit-mode claims:
  - `.docx` → WordCraft ("Edit in WordCraft")
  - `.xlsx` → GridCraft
  - `.pptx` → DeckCraft

  Each claim declares keep-alive (live-instance cap), a size limit equal to that kind's office cap, a per-app first-overwrite fidelity notice, and a copy suffix (`wordcraft` / `gridcraft` / `deckcraft`). An app ships its claim only after its spike passes (drop-open, save stub, dirty signal, CSP, sandbox start). Otherwise its kind stays preview-only.
- **Handler component** (`CraftFrameHost`):
  - mounts the app's web build in a sandboxed opaque-origin iframe (`allow-scripts` only, `allow="clipboard-write"`);
  - hands it the core snapshot over a nonce-bound `postMessage` protocol;
  - maps app saves onto core `save()`, with a host-side **Save target** toggle (overwrite | copy);
  - reports dirty state to core from the app's title signal plus input tracking;
  - refuses in-app opening of other files (file chooser, open picker, desktop drop, pasted files);
  - asks before honouring an in-app "Save As" to a different name;
  - routes exports of another type (e.g. PDF) to a device download, never to the workspace.
- **Host shim** (`craft-shim.js`), injected into the build at provision time (versioned; an outdated shim triggers re-preparation). It stubs `showSaveFilePicker`, intercepts anchor downloads, signals readiness after app init, derives dirty state, refuses foreign opens, removes WebRTC constructors, and cancels self-navigation where the Navigation API exists.
- **Plugin server:**
  - provisions web builds through `craft-apps` `provisionWeb`: pinned version, checksum fail-closed, JS zip extraction, disjoint cache;
  - serves the prepared build (stable `current` pointer) without auth, with an enforced CSP that confines fetch/XHR/WebSocket to the build's own path and `ACAO:*` for the opaque frame;
  - exposes status and authenticated prepare routes;
  - registers an OOXML content validator for its claims: zip + main-part content type of the target kind.
- **`craft-apps`** (adds `yauzl`): extract a shared install core from CLI provisioning, add `provisionWeb` (with a `postInstall` hook the plugin uses for shim injection), and add registry `webVersion` / `webFidelityNote`.
- **Non-goals:**
  - pixel-streaming native apps;
  - non-Office kinds;
  - upstream ArtCraft changes (an `?open=<url>` + `postMessage` save API is a follow-up ask that would retire the shim);
  - persisting app preferences;
  - co-editing / AutoSave.

## Capabilities

### New Capabilities
- `craft-web-editor`: covers
  - the plugin's handler claims and their per-app gating;
  - frame isolation and network confinement;
  - the host shim protocol;
  - single-document editing;
  - export routing;
  - save-target toggle and dirty reporting;
  - build prepare/status and asset serving;
  - the OOXML write validator;
  - rendering fallback.

### Modified Capabilities
- `craft-binary-provisioning`:
  - scopes version resolution, source selection, installer rules, host asset mapping, extraction and the provisioning report to the CLI;
  - adds **web build provisioning**: pinned-only resolution, `CRAFT_SOURCE=launcher` fail-closed, the same checksum and safe-extraction rules, a disjoint `<app>-web/` cache, and cross-OS (incl. Linux) zip extraction.

## Dependencies

- `add-editor-pane-file-handlers` — the slot, handler props contract, core binary write, conflict/overwrite UX and keep-alive pool.
- `gate-changed-on-disk-by-content` (via the above) — digest baseline and own-save suppression.
- `add-plugin-capability-routes` — `ctx.serveApp` for the unauthenticated static mount. Its current scope covers neither a directory outside the plugin package (builds live in the provisioning cache) nor cross-origin headers for an opaque-origin frame. Those need an amendment there, or a plugin-local mount (see design.md D3).

## Impact

- **Server / Electron:** `packages/server/package.json` `bundledPlugins` gains `craft-web-plugin`; `packages/electron/scripts/bundle-server.mjs` `BUNDLED_WORKSPACE_PKGS` gains `craft-apps` and its first-party dependency `nano-banana` (so no `pi-dashboard-*` package is fetched from the registry), with the pinned list in `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` updated; `packages/shared/src/route-tiers.ts` gains the plugin's status (`observe`) and prepare (`control`) routes.
- **New package** `packages/craft-web-plugin` (depends on `@blackbelt-technology/pi-dashboard-craft-apps` and `yauzl`; `craft-shim.js` in `files`):
  - client: handler component, save-target toggle, shim protocol host;
  - server: serving, status/prepare routes, validator;
  - `craft-shim.js`;
  - `configSchema.json`: per-app enable.
- **`packages/craft-apps/src/provision.ts`, `registry.ts`:** install-core refactor, `provisionWeb`, new registry fields, direct zip-library dependency.
- **Payload:** ~16 MB gzip per app on first Edit (brotli is off because zrok truncates it). Each live instance costs ~100+ MB of memory and one GPU context; the core keep-alive cap bounds this.
- **Secure context:** WebGPU and the clipboard need `https://` or `localhost`. Plain-HTTP LAN clients fall back to WebGL2.
- **Upstream coupling:** the shim relies on app internals (canvas drop, `showSaveFilePicker` save path, title-dirty log line). Pinned versions plus a per-app e2e guard against drift.

## Discipline Skills

- `security-hardening` — executes large third-party bundles in the dashboard UI; sandbox, CSP network confinement, self-navigation residual, unauthenticated static route, `postMessage` validation, write validator.
- `doubt-driven-review` — overwriting user documents through a ~60%-parity editor; pinned upstream coupling.
- `performance-optimization` — 42 MB wasm per app, gzip/caching budget, phone clients.
- `observability-instrumentation` — provisioning outcomes, served bytes, CSP violations forwarded from the shim, save outcomes.
- `review-code` — before commit.
