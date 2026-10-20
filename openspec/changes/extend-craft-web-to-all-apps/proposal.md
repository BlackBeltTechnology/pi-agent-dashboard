## Why

Only WordCraft (`.docx`) is plugged into the editor pane, yet all 13 ArtCraft apps publish a web build (`<app>-web-<ver>.zip`). An explore spike (2026-10-19/20) ran every build under the production sandbox, CSP and shim. The isolation model and drop-open/save capture carry over to every app. What does not carry over is narrower:
- **Open/dirty detection.** It rests on one WordCraft-only title pattern; 12 of 13 apps emit a different signal or none.
- **Post-install.** It assumes a single inline Trunk bootstrap. FilmCraft, EffectCraft and LightCraft use their own loader; SoundCraft has a second inline script.
- **Saved format.** Some apps save their native format rather than the file they opened (PhotoCraft `.psd`, VectorCraft `.vectorcraft`, DeckCraft `.deckcraft`).
- **Validation.** The only validator is OOXML.

This change generalizes the plugin and rolls the apps in by type, in waves.

## What Changes

Spike evidence and the per-app matrix: `design.md` §Context.

- **Per-app adapter profile** (one declarative row per app, shared by server, client and shim). It declares:
  - ready hook: `trunk` | `load-ready-ms:<global>` | `after-start-call`;
  - title pattern and dirty marker (optional);
  - opened fallback;
  - clean-on-acknowledged-save;
  - save-name rule;
  - URL-only frame params (`nosw`); never extra frame permissions;
  - worker trampoline;
  - latest-channel allowed;
  - claims.

  Claim ids map to an app id. Status, prepare, config and mount stay keyed by app id.

  An app without a profile gets no claim.
- **Generalized post-install:**
  - externalize **every** inline script;
  - inject the ready hook for non-Trunk loaders;
  - emit the profile as a content-hashed script loaded before the shim.

  The CSP stays hash-free.
- **Shim v2** (an installed WordCraft build keeps loading; per-app minimum supported shim, re-prepare offered as an update). Title parsing is profile-driven (and handles the em-dash suffix).
  - **Opened (apps without a title signal):** after a bounded time, when the drop was delivered, the canvas is alive and no start error occurred. Such an open is *unconfirmed*: the app's first-overwrite notice asks the user to check that the document is shown (one question, not two).
  - **Start failures:** a wasm trap/panic before opened → "could not start".
  - **Clean:** per profile, after an acknowledged save to the tab's own file with no input since. WordCraft keeps its title-driven rule.
  - **Worker trampoline:** wraps `new Worker(httpUrl)` in a blob bootstrap that imports the mount URL. This adds no network reach; the blob worker inherits the frame's CSP.
- **Native-format sibling save** (core, **additive**). An edit claim may declare `siblingExtensions`. A save in such an extension is offered as a new sibling `<stem>.<ext>` ("Create and open" moves further editing onto it), using the copy path's never-overwrite rule. Without that declaration, other-type saves still go to the device.
- **SoundCraft session-named saves** ask once per instance and suggested name, keeping the "different name asks first" guarantee.
- **Per-format validators** (worker-safe, reject-only; one dispatcher module per claim, routing on extension):
  - PDF header/trailer;
  - ODF zip (`.odt`) and RTF header;
  - DXF section structure and DWG version signature;
  - zip-container checks (mimetype/manifest) for `.designcraft`, `.scraftz` and `.deckcraft`;
  - PSD signature; image signatures; SVG without DTD/entities, script, event handlers or script URLs;
  - OOXML (kept).

  A format without a validator gets no edit claim.
- **Claims by wave** (each app still ships only after its per-app e2e passes):
  - **Wave 1, edits in place:** GridCraft `.xlsx`; PdfCraft `.pdf`; CADCraft `.dxf` (+ `.dwg`); DesignCraft `.designcraft`; SoundCraft `.scraftz`; WordCraft `.odt` `.rtf`. `.dwg`, `.odt` and `.rtf` are each gated by a fixture spike.
  - **Wave 2, saves its native format:**
    - PhotoCraft: `.psd` edit; `.png .jpg .jpeg .webp .tif .tiff` edit, with `.psd` as a sibling;
    - VectorCraft: `.svg` edit, with `.vectorcraft` as a sibling;
    - DeckCraft: `.deckcraft` edit; `.pptx` edit, with `.deckcraft` as a sibling. Pinned to 0.7.0 with the version channel fixed, because 0.8.0 panics on start upstream.
  - **Wave 3, preview only:** LightCraft RAW formats (`.dng .cr2 .cr3 .nef .arw .raf .orf .rw2`), after a RAW drop spike. Saves go to the device only.
  - **Wave 4, deferred** (spike + follow-up change): FilmCraft/EffectCraft editing with host-pushed sibling media. FigCraft stays excluded until its web build accepts a dropped file.
- **Settings / status** iterate the profile table. The existing per-app enable and version channel apply to every app. **Every new app starts with its channel fixed to the verified version** until a scheduled e2e covers its latest build; DeckCraft is also pinned below a broken latest.
- **Upstream asks** (tracked, not blocking):
  - a viewport `Title` signal from every app;
  - a fix for the DeckCraft 0.8.0 `process::id` panic;
  - FigCraft drop support;
  - a common `window.<app>.request` control API (already in EffectCraft and LightCraft).
- **Non-goals:**
  - automating app export dialogs (Wave 2 saves the native sibling; a same-extension file the app itself produces is an ordinary own save);
  - extra frame permissions (`autoplay`, `allow-same-origin`, `allow-downloads`);
  - FilmCraft/EffectCraft editing in this change;
  - storage persistence (OPFS/IndexedDB stay refused);
  - `.wav`/media editing in SoundCraft (its web build imports media into a demo session).

## Capabilities

### New Capabilities

None. Everything extends existing capabilities.

### Modified Capabilities

- `craft-web-editor`:
  - claims are per app type rather than per Office kind;
  - adapter profiles;
  - readiness and opened detection without titles, with the unconfirmed-open check folded into the first-overwrite notice;
  - UX from the approved board (`mockups/`): toolbar chips stating where saves go, sibling-dialog copy, a session-name hint, settings grouped by app type with fixed channels as read-only facts, and a contrast fix on the save-target toggle;
  - dirty clean-after-own-save per app;
  - a version channel fixed to the verified version (settings shows it fixed; shim compatibility keeps older builds usable);
  - native-format sibling saves;
  - per-format validators;
  - preview-only claims.
- `editor-pane-file-handlers`: a copy save may use one of the claim's declared sibling extensions instead of the tab file's extension; the binary-file notice offers matching handler modes.
- `dashboard-shell-slots`: the file-handler claim gains the optional `siblingExtensions` field (edit mode only; same extension rules).

## Impact

- **`packages/craft-web-plugin`:**
  - new shared `app-profiles` module, consumed by `server/apps.ts`, `client/craft-apps-table.ts` and post-install;
  - `post-install.ts` rewrite;
  - shim v2 (`SHIM_VERSION` bump: installed WordCraft builds keep loading via its minimum supported shim, and re-preparing is offered as an update; new apps require v2);
  - new validators under `src/server/validators/`;
  - more manifest claims, plus `configSchema.json` app keys and i18n strings.
- **`packages/craft-apps/src/registry.ts`:** `webVersion` / `webFidelityNote` for each shipped app (DeckCraft `0.7.0`).
- **Core:**
  - `packages/shared` claim type (`manifest-types.ts`, `file-handler.ts`) + `packages/dashboard-plugin-runtime/src/manifest-validator.ts` (`siblingExtensions`);
  - server `write-binary` copy-extension rule;
  - client `CraftFrameHost` save routing (`sibling` route).
- **Compatibility:**
  - additive claim field (minor `pi-dashboard-shared`);
  - existing WordCraft behaviour unchanged except the one-time re-prepare (its profile keeps the title-driven dirty rule);
  - no data migration.
- **Rollback:** remove claims per app or per extension (the manifest drives availability). The core `siblingExtensions` change can be reverted independently: an older runtime silently drops the unknown claim key, and native-format saves then fall back to device download.
- **Payload:** 6–23 MB zip per app on first use. Each live instance costs about 100+ MB of memory; the keep-alive cap of 3 is unchanged. SoundCraft bundles hit the 128 MiB handler ceiling sooner.
- **Tests:**
  - unit tests per profile, validator and post-install fixture;
  - one parametrized Playwright spec over all shipped apps, replacing per-app copies of F1–F9.

## Discipline Skills

- `security-hardening` — new third-party bundles in the sandbox, the worker trampoline, new write formats and validators, core sibling-extension write path.
- `doubt-driven-review` — the core `write-binary` contract change (public plugin API) and pinning DeckCraft below latest.
- `performance-optimization` — EffectCraft/LightCraft render on the page thread when frame workers fail; large `.scraftz` bundles near the handler ceiling.
- `observability-instrumentation` — opened-fallback vs title-signal outcome per app, validator rejects per format, start failures per app/version.
- `review-code` — before commit.
