# Proposal — add-google-docs-pane

## Why

Users keep working documents in Google Drive as Google-native files (Docs, Sheets, Slides). The editor pane cannot show them.

Google-native files have no faithful file form. Exporting to `.docx`/`.xlsx` and converting back on save:
- is lossy: comments come loose, and suggestions, smart chips and Google-only functions are lost;
- replaces the whole document under live collaborators.

`add-cloud-sync-connector` already lists "Google-native doc round-trip editing" as a non-goal. Only Google's own editor is faithful, so this change shows **the real Google editor inside the pane**.

Decided in explore and doubt review (2026-10-24):

| Drive file | Opens in | Owner |
|---|---|---|
| Google Docs / Sheets / Slides | the real Google editor in a pane tab (Electron) | **this change** |
| `.docx` / `.xlsx` in Drive | Google default for now; Craft once `add-drive-office-craft-handoff` lands | follow-up |
| `.pptx` in Drive | Google's own Office-compat editor (DeckCraft cannot write `.pptx`, `docs/craft-web-plugin.md` §1) | Google default |

Renderer is **B1 only**: a native Electron `WebContentsView`. Rejected alternatives:
- **An iframe:** `accounts.google.com` sends `X-Frame-Options: DENY` (measured), so sign-in cannot happen in one.
- **The browser relay (B2):** it streams frames through the dashboard server (`openspec/specs/browser-pane-tab/spec.md`, "One pane tab per relay tab"), exposes the tab to same-guid CDP clients, and lands downloads on the operator host (`openspec/specs/browser-relay/spec.md:116`).

The Office → Craft handoff needs core seams that do not exist (cross-plugin claim open, out-of-cwd handler files, post-write upload), so it is split off.

## What Changes

- **New plugin `google-docs`** (`packages/google-docs-plugin`, bundled, opt-in `defaultEnabled: false`). No Google OAuth, no Drive API, and no workspace writes.
- **Google view (Electron only).** A `gdoc:` editor-pane tab shows Google's editor for one document in a `WebContentsView`, managed by core Electron code:
  - partition `persist:google-docs`; no preload, sandboxed;
  - laid over the pane and hidden (opaque placeholder, no page capture) behind dashboard dialogs and menus;
  - at most 3 live per window, one per document;
  - never released while the page blocks unload or within 10 s of user input.

  Google sign-in happens inside the view, and the session never reaches the dashboard page or server. Plain-browser clients, remote server windows, and Electron with any remote-debugging switch get an **"Open in Google" fallback card**.
- **Two entry points:**
  - **Virtual tab:** "Open Google doc…" accepts a pasted Google URL and opens `gdoc:doc:<kind>:<id>`.
  - **Pointer files:** `.gdoc` / `.gsheet` / `.gslides` (JSON with `url` or `doc_id`). **Opening one redirects to the plugin tab `gdoc:file:<path>`** instead of a file viewer, through a new core ability: an `editor-pane-tab` claim may own opening files by extension. "Show pointer file" opens the raw JSON. Pointers are read through core `/api/file` (existing containment), never written by the plugin.
- **Fence:**
  - Navigation, redirects and subframes are allowed only to exact enumerated Google hosts (no suffix rules), plus optional operator-configured SSO hosts for federated Workspace sign-in.
  - User-initiated off-list links and `mailto:` go to the system browser through the existing scheme-allowlisted opener. Script-initiated navigations and off-list redirects are blocked with an "Open in browser" notice, never auto-launched. All popups go through the same rule (no secondary windows).
  - Permissions are default-deny, with request and check handlers; only clipboard write and fullscreen (Slides present) are allowed.
  - Downloads go to a device save dialog, never automatically into the workspace or an editor.
- **Strict URL model:** ids and resource keys match a strict pattern, and the loaded URL is always constructed.
- **Out of scope:**
  - Office → Craft handoff;
  - Drive API / OAuth;
  - agent or CDP access to the view;
  - a relay renderer;
  - editing Google-native docs in Craft;
  - `.pptx` write-back;
  - creating pointer files from the UI (the agent or any editor can write the JSON);
  - the `add-cloud-sync-connector` pointer amendment (follow-up).

## Capabilities

### New Capabilities
- `google-docs-pane`: Google-native documents in a `gdoc:` editor-pane tab through Google's editor in an isolated Electron view, opened from a pasted URL or a pointer file. Covers the fence, permissions, downloads, view lifecycle, overlay behaviour and the fallback card.

### Modified Capabilities
- `editor-pane-plugin-tabs`: (ADDED requirements) an `editor-pane-tab` claim may declare file extensions whose workspace files open as that plugin's tab, with a one-shot bypass and collision validation.
- `internal-monaco-editor-pane`: the `fileKind` single-source requirement states that plugin-tab redirect is tab routing that runs before `fileKind`, not a second viewer classifier.
- `dashboard-shell-slots`: the `editor-pane-tab` slot carries an optional `fileExtensions` field through manifest normalization and registry generation.
- `electron-shell`: the "external links open in the system browser" requirement's app-owned carve-out also covers the main-process Google document views, which are created from a document reference and never from a page-supplied URL.

## Impact

- **New package** `packages/google-docs-plugin`:
  - client: `gdoc:` tab claim with `fileExtensions`, URL model, pointer parsing, tab body, fallback card, settings (SSO hosts, sign-out);
  - server: telemetry route only.
- **Core client** (`packages/client/src/lib/layout/editor-pane-state.ts` open path and its callers; manifest validator and registry generation in `packages/shared`): extension redirect before viewer dispatch.
- **Electron** (`packages/electron/src/`):
  - a Google view manager in main;
  - the `googleView` IPC on the local-origin dashboard preload, with sender-scoped ownership;
  - a pure fence helper next to `link-handling.ts`, reusing `openExternalIfAllowed`;
  - the permission handler pattern from `server-windows.ts:575-576`;
  - no views while debug CDP is on (`main.ts:32`).

  This is the first `WebContentsView` in the repo.
- **Route tiers:** the telemetry route in `packages/shared/src/route-tiers.ts`.
- **Coordination:**
  - `add-drive-office-craft-handoff` (seeded) depends on this change.
  - `add-cloud-sync-connector` should write pointer files for native docs (follow-up).
  - `enforce-strict-csp-default` is unaffected: the fallback loads no Google content.
- **Rollback:**
  - Disable the plugin: pointer files open in the normal viewer again, and persisted `gdoc:` tabs show the "unavailable" placeholder with Close (`editor-pane-plugin-tabs`).
  - Live views are destroyed. Partition cookies stay until the user signs out (settings) or clears app data.
  - No server data migration.

## Discipline Skills

- `security-hardening`: third-party web content inside the dashboard window (isolation, no preload, fence, popups, default-deny permissions, CDP exclusion); untrusted pointer contents and pasted URLs into loaded URLs.
- `doubt-driven-review`: the core redirect seam and the `gdoc:` tab path format persist in pane state and are hard to reverse.
- `observability-instrumentation`: count view outcomes with a fixed reason enum, without ids, URLs or paths.
