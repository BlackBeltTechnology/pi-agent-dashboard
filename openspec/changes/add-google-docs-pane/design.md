# Design — add-google-docs-pane

## Context

See proposal.md (Why). Current state relevant to the approach:

- **Plugin tabs (shipped).**
  - `editor-pane-tab` claims own a prefix `<prefix>:<rest>`. The pane never reads a file for such a path.
  - Tabs persist and degrade to an "unavailable" placeholder.
  - Prefix collisions fail registry generation unconditionally (`openspec/specs/editor-pane-plugin-tabs/spec.md`, "Built-in pseudo-tab prefixes win and collisions are rejected").
- **File handlers (shipped).** The built-in view is selected when a file tab opens, and claimed modes are opt-in (`openspec/specs/editor-pane-file-handlers/spec.md:15`). This is why a file-handler claim cannot open pointers straight into the Google view.
- **Pane open path.** All file tabs enter pane state through the reducer action `openFile` (`packages/client/src/lib/layout/editor-pane-state.ts:300-301`, `reduceOpenFile` at :182). Callers include the file tree, the `?file=` deep link, canvas targets, tool-renderer open buttons and links, and split open (`packages/client/src/components/split/SplitWorkspaceContext.tsx`).
- **File-kind classifier.** `packages/shared/src/file-kind.ts` is the single source of viewer discrimination (`openspec/specs/internal-monaco-editor-pane/spec.md:292-294`).
- **Electron.**
  - No `WebContentsView` in source.
  - Windows: `sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false` (`packages/electron/src/lib/server-windows.ts:498`).
  - Server windows set both permission handlers with an allowlist (`server-windows.ts:88`, `:575-576`).
  - `openExternalIfAllowed` enforces the external scheme allowlist (`packages/electron/src/lib/link-handling.ts:138`).
  - `decideWillNavigate` allows any off-origin target and `decideServerWindowNavigation` allows same-origin only (`link-handling.ts:80-165`). Neither fits.
  - Debug CDP (`--debug-cdp` / `PI_DEBUG_CDP`) adds `remote-debugging-port` (`packages/electron/src/main.ts:32`, `lib/resolve-cdp-activation.ts`). That would expose every `webContents`.
  - Trusted preload surfaces are exposed on the local origin only, through trusted-sender wrappers (`openspec/specs/electron-browser-host/spec.md:8`).
- **Framing (measured 2026-10-24):** `accounts.google.com` sends `X-Frame-Options: DENY`.

## Goals / Non-Goals

**Goals:**
- Google-native documents are edited at full fidelity, in Google's own editor, in a pane tab.
- The Google web session never reaches the dashboard page, the server or any CDP client.
- The view navigates only to enumerated hosts. Everything else leaves through the system browser or a device download.
- Pointer files open the Google view in one click.

**Non-Goals:**
- Office → Craft handoff, Drive API, OAuth (`add-drive-office-craft-handoff`).
- A relay renderer.
- Agent or CDP access.
- Creating pointer files from the UI.
- `.pptx` write-back.

## Decisions

### D1 — URL model and tab paths

**Accepted pasted URLs:**
- `https://docs.google.com/{document|spreadsheets|presentation}/[u/<n>/]d/<id>/<anything>`, with an optional `resourcekey` query parameter;
- fragments matching `gid=\d{1,12}`, `heading=h\.[a-z0-9]{1,32}` or `slide=id\.[A-Za-z0-9_]{1,64}` are kept.

**Rejected, with a reason:**
- `drive.google.com/open?id=` and `drive.google.com/file/d/` (the kind is unknown; the hint asks for the editor link);
- every other host and form.

**Validation:**
- `<id>` and the resource key match `^[A-Za-z0-9_-]{10,128}$`. `<n>` is 0–9 and is dropped; account choice happens in the view.
- The loaded URL is always constructed as `https://docs.google.com/<kind>/d/<id>/edit[?resourcekey=<k>][#<kept fragment>]`.

**Tab paths:**
- `gdoc:doc:<kind>:<id>[:<resourceKey>]` for a pasted URL;
- `gdoc:file:<cwd-relative path>` for a pointer. Everything after `gdoc:file:` is the path, verbatim, so colons inside the path are safe.

The tab path persists in pane state like a file path. That includes a resource key, which is a link-share credential the user pasted: it gets the same trust as file paths in pane state. The plugin never logs it.

**Dedupe (one tab, one view per document):** document identity is `(kind, id)`, ignoring resource key and fragment.
- A `gdoc:doc:` open whose `(kind, id)` matches an open Google tab in the window focuses that tab.
- A `gdoc:file:` tab learns its `(kind, id)` only after the pointer read. If another tab in the window already holds that document, the new tab focuses it and closes itself **before** calling `attach`.
- Main enforces this as well: `attach` for a `(kind, id)` already bound in that window returns `{error:"already-open"}` and never shares a `viewId` between tabs.

### D2 — Pointer parsing

The tab body reads the pointer through core `GET /api/file?cwd&path`, which already enforces admitted-cwd containment and its tier. It then parses the content with a 64 KiB cap.

*Trade-off:* `/api/file` reads the whole text file before responding (`packages/server/src/routes/file-routes.ts:762-768`), so the 64 KiB cap applies after transfer. It is bounded only by core's existing read limits, which task 3.3 verifies; if there are none, the plugin checks the reported size before parsing. A large `.gdoc` costs one read, never a parse or a load.

Precedence:
1. **`url` present** (a non-empty string): parsed per D1, including its own `resourcekey`. Top-level `resource_key` is ignored. If the URL is invalid → error. There is **no** fall-through to `doc_id`.
2. **Else `doc_id`** (a non-empty string): validated per D1. The kind comes from the extension (`.gdoc`→document, `.gsheet`→spreadsheets, `.gslides`→presentation). `resource_key` is used only here.
3. **Else** → "unrecognized pointer". An empty or `null` `url`/`doc_id` counts as absent.

A `url` kind that differs from the extension wins, and the tab shows a non-blocking mismatch note. Unknown keys are ignored.

The Drive for Desktop stub shape is confirmed by S3. Until then the `doc_id` path is best-effort.

### D3 — Plugin-tab extension redirect (core)

- **Claim:** an `editor-pane-tab` claim may declare `fileExtensions`. Each entry must match `FILE_HANDLER_EXT_RE`, and **must not** be an extension `isUnclaimableHandlerExt` rejects (`packages/shared/src/file-kind.ts:404`), nor one `fileKind` classifies as a known kind. A plugin cannot take over `.md`, `.json`, `.docx`, `.pdf` and the like. The field is added to the manifest type, normalization and registry (MODIFIED `dashboard-shell-slots`).
- **Collisions:** registry generation fails **unconditionally**, matching the prefix rule, when two plugins declare one extension or a redirect extension is also claimed by an `editor-pane-file-handler`. A collision is therefore caught when plugins are installed or registered, before either plugin runs. It never arises at runtime, so it does not affect rollback by disabling this plugin.
- **Funnel:** one client function, `resolveOpenTarget(path, {bypassRedirect?, requester?})`.
  - It returns the plain path or `<prefix>:file:<path>`, using enabled claims and the shared lower-case extension normalization.
  - Every caller invokes it **before** computing a viewer: the `openFile` dispatch wrapper in `useEditorPaneState`, and split open (`SplitWorkspaceContext.tsx:302` currently calls `fileKind` first, so it moves after).
  - Task 2.2 enumerates every caller and tests each entry point.
  - `fileKind` is not touched (MODIFIED `internal-monaco-editor-pane`).
- **Scope:** the redirect applies to pane opens only. The diff viewer's Preview mode (`change-summary-table`) keeps showing the pointer's JSON through `fileKind`, which is correct for a diff. File tabs restored from persisted pane state stay file tabs; the redirect applies only to new opens.
- **Disabled plugin:** no redirect, so the normal viewer opens.
- **Bypass:** honoured only when `requester` is the claiming plugin's own tab and the path equals the file in that tab's own `gdoc:file:` path. Any other bypass request is ignored, and the redirect applies.

*Alternatives considered:*
- A file-handler claim with the switcher: the JSON view shows first, two clicks.
- A "default claim" for file handlers: changes the shipped default rule for every plugin.

### D4 — Google view manager (Electron main)

**Availability.** The main-window preload exposes `googleView.availability()` → `{available, reason?}` on every origin, with `reason` ∈ `remote-window | debug-cdp`. All other `googleView` methods exist on the local origin only. When there is no `googleView` surface at all, the client derives the reason: `remote-window` if `navigator.userAgent` contains `Electron/` (a server window, which has no preload), else `browser`. The UA is used only to choose the card text, never for a security decision. The view is available only when all of the following hold; otherwise the fallback card (D7) shows the reason:
- Electron;
- the local-origin dashboard window (remote server windows get no surface);
- no remote debugging. Main checks `app.commandLine.hasSwitch("remote-debugging-port")` and `hasSwitch("remote-debugging-pipe")` as well as the app's own `--debug-cdp` / `PI_DEBUG_CDP` activation, so a raw passthrough switch also disables views.

**IPC.** Every channel goes through the trusted-sender wrappers, on the local origin only. Every view is owned by the sender `webContents` that attached it, and calls naming another sender's view are refused.

| Channel | Direction | Payload | Notes |
|---|---|---|---|
| `availability()` | renderer → main | — → `{available, reason?}` | |
| `attach(ref)` | renderer → main | `{kind, id, resourceKey?, fragment?}` → `{viewId}` or `{error}` | main **re-validates every field** (`kind` enum; `id`/`resourceKey` `^[A-Za-z0-9_-]{10,128}$`; `fragment` only the three D1 anchor patterns; extra keys rejected) and constructs the URL itself (D1); no URL accepted; `already-open` if `(kind,id)` is bound in that window |
| `setBounds(viewId, rect)` | renderer → main | integers, clamped to the window content size | |
| `setVisible(viewId, bool)` | renderer → main | | |
| `destroy(viewId)` | renderer → main | → `{ok}` or `{blocked:"unsaved"}` | unload-checked |
| `signOut()` | renderer → main | → `{ok}` or `{blocked:"unsaved"}` | unload-checks every live view first (same rule as `destroy`); any blocked view → nothing cleared, user told to wait; else destroy views, then `session.clearStorageData()` (all storage types) |
| `onEvent(cb)` | main → renderer | `{viewId, type}`, `type` ∈ `released`, `redirect-blocked` (with host), `outcome` (enum value) | host shown locally only; one subscriber per window in the plugin client root (not in tab bodies), which forwards outcomes to telemetry so events after a tab closes are still counted |

**View:**
- partition `persist:google-docs`;
- `sandbox:true, contextIsolation:true, nodeIntegration:false`, **no preload**, `webviewTag:false`;
- default user agent. S2 gates on Google sign-in accepting it; if it is refused, the fix (a partition-scoped UA) is a design change via `SHIP_IT_BLOCKED.md`.

**Budget and eviction:**
- at most 3 live views per owning window, independent of the file-handler `keepAlive` budget;
- releases are **serialized** per window (one release in flight; later attaches queue);
- a fourth attach picks the least recently active view that has had **no user input for 10 s** (main tracks `before-input-event` per view) and calls `webContents.close({waitForBeforeUnload: true})`;
- the only unsaved signal is the page's own `beforeunload` cancelling the unload, seen as `will-prevent-unload`. The release path **never** calls `preventDefault()`; it treats the event as "blocked", keeps the view, and tries the next candidate;
- if no candidate can be released, `attach` returns `{error:"budget-blocked"}` and the tab asks the user to close a Google tab;
- whether Google sets `beforeunload` during its save debounce is measured in S2. The 10 s input guard covers that window either way;
- a released view reloads its document on activation (fresh load: scroll position and undo history are not kept).

**Lifecycle:** `setVisible(false)` when the tab is hidden or the window minimised (detached from the window).
- **Owner page reload, navigation or crash:** on the owner's main-frame cross-document `did-start-navigation`, `render-process-gone` or `destroyed`, main releases all of that owner's views with the unload check and one 5 s retry, so no orphaned view holds the budget.
- **Tab close:** `destroy` with the unload check. `blocked:"unsaved"` keeps the tab open and tells the user Google is still saving.
- **Plugin disable, owner reload and window close:** views are destroyed with the unload check. A blocked view gets one 5 s retry, then is destroyed. This is a documented trade-off: these are explicit user or app acts, and the retry covers Google's save debounce in the common case.

**Overlays:** the rule is generic, not a list of app components, so plugin-rendered overlays are covered too. A client overlay watcher (one per window) hides the view (`setVisible(false)`, opaque placeholder "Google document hidden while this is open") whenever any element **intersecting the pane rect** is open with any of these:
- role `dialog`, `alertdialog`, `menu` or `listbox`;
- `:popover-open`;
- `aria-modal="true"`;
- an element inside the shared portal root.

The watcher uses a `MutationObserver` plus a rect check. **No page capture:** Google content never enters the dashboard renderer. Tooltips and toasts are excluded (non-blocking, frequent). One that lands over the pane area may be covered by the view, which is a documented trade-off.

### D5 — Fence

**URL normalization (before any decision):** parse with `URL`; compare `URL.hostname` lower-cased, after IDN to punycode. Reject userinfo, and reject any port other than the scheme default. `about:blank` and `about:srcdoc` subframes are allowed (inert, same origin as their parent). `blob:` and `data:` subframes are allowed only when their parent frame's origin is an enumerated host. Every other scheme is dropped, except `mailto:`, which goes external.

**Top-level navigation and redirects:** allowed hosts (exact):
- `docs.google.com`;
- `accounts.google.com`;
- `drive.google.com`. This is accepted scope: Docs links to Drive folders, and Office files opened there keep Google's default behaviour until `add-drive-office-craft-handoff`.
- plus operator-configured SSO hosts (`plugins['google-docs'].ssoHosts`, exact https hosts, default empty) for federated Workspace sign-in.

`ssoHosts` entries must be bare lower-case hostnames: no scheme, path, port or wildcard, not an IP literal, and not on the top-level list. Invalid entries are refused when settings are saved.

**Subframes:** an **exact** host list, initially the top-level hosts only. There are no suffix rules: user-content hosts such as `sites.google.com` or `script.google.com` must never run in the signed-in partition. S2 records the subframe hosts the three editors need. Any host outside the list is a spec change, made through `SHIP_IT_BLOCKED.md` → `plan-proposal`, which adds the exact host names to this list and the spec.

**Outside the lists** (phases: `will-navigate`, `will-redirect`, `will-frame-navigate`, `window-open`, `will-download`):
- **User-initiated** means a trusted input event in that view within the preceding 1 s, tracked by main via `before-input-event`. Electron's navigation events carry no user-gesture flag (`will-navigate` params: `url, isSameDocument, isMainFrame, frame, initiator`).
- An off-list top-level `will-navigate`, a `window.open`, or a `mailto:` that is **user-initiated** → cancelled, then `openExternalIfAllowed` (system browser).
- The same event **without** recent input, and every off-list `will-redirect` → cancelled, **never auto-launched**. The tab shows a notice naming the host, with "Open in browser" (user click). This also covers an externalised sign-in hop ("Continue sign-in in your browser, or add this host to sign-in hosts").
- an off-list subframe or an unsupported scheme → dropped.

**Subresources and service workers are not fenced.** The view runs Google's own app, and the fence prevents browsing arbitrary sites in a chrome-less view. It does not prevent Google's app from fetching. This residual is documented.

**Popups:** every popup (`setWindowOpenHandler` → `deny`) goes to the system browser per the rules above. No secondary Electron window is ever created, which keeps `electron-shell` "External links open in the system browser, not a secondary Electron window" intact. S2 verifies sign-in, Share and comments work without popups. If one needs a popup, that is a design change (an `electron-shell` delta) via `SHIP_IT_BLOCKED.md`.

**Permissions:** default-deny via both `setPermissionRequestHandler` and `setPermissionCheckHandler` (the `server-windows.ts:575-576` pattern). Allowed: `clipboard-sanitized-write` and `fullscreen` (Slides "Present"; S2 verifies it fills the window and Esc returns). Server windows also allow `notifications`; the Google view does not, because Google notifications would arrive from a hidden partition. Paste uses native paste events with no clipboard-read grant (S2 verifies).

**Downloads:** `will-download` → `setSaveDialogOptions` with a default path in the OS Downloads folder. The user may pick any folder, including the workspace: that is an explicit user choice, and a residual for indexers and agents. The view never writes into the workspace on its own or opens the file in an editor. Exporting a deck as `.pptx` is a download; it is not `.pptx` write-back.

**Implementation:** a pure helper `decideGoogleViewNavigation(target, phase, ssoHosts)` → `allow | external | drop`. Its tests include lookalike hosts, userinfo tricks (`https://docs.google.com@evil.example`), IDN, ports, and `mailto:`.

### D6 — Isolation and CDP exclusion

The partition is used by no dashboard window. The renderer gets no cookie, storage or `webContents` handle, only view ids. The server never sees the view's traffic.

With debug CDP on, no Google view is created (D4 availability), so a signed-in Google session is never a remote-debugging target. Turning debug CDP on while views are live requires an app restart, and at startup no views exist.

Settings offer "Sign out of Google in the dashboard view" (`signOut()`): destroy live views, then `session.clearStorageData()` with all storage types on the partition.

### D7 — Fallback card

The card names the document kind (not the id) and states the reason: "Desktop app only", "Unavailable in remote server windows" or "Unavailable while debug CDP is on". It offers "Open in Google", which calls `window.open(constructedUrl, "_blank", "noopener")` on click. The card loads no Google content.

### D8 — Observability

`POST /api/plugins/google-docs/telemetry` takes `{outcome}` from a fixed enum:
- tier `control`, registered in `packages/shared/src/route-tiers.ts`;
- body ≤ 1 KiB (rejected otherwise);
- rate limit per client connection, the same as the craft-web telemetry route.

Outcome enum:
- `opened`, `fallback-browser`, `fallback-remote-window`, `fallback-debug-cdp` (aligned with the D4 `reason`s);
- `pointer-invalid-json`, `pointer-too-large`, `pointer-unrecognized`, `pointer-bad-url`, `pointer-bad-id`, `pointer-read-failed`;
- `attach-failed`, `budget-blocked`, `fenced-external`, `fenced-dropped`, `redirect-blocked`, `permission-denied`, `download`, `view-released`, `release-blocked`.

Unknown values → 400. Log lines are fixed templates with the enum value and a count. No input is interpolated, and ids, URLs, hosts and paths are never sent or logged.

## Risks / Trade-offs

- [Script-initiated navigation within 1 s of a keystroke] → treated as user-initiated and opened externally. Accepted: the user just interacted with that document, and the target still goes through the scheme allowlist.
- [Federated SSO host unknown] → sign-in redirect dropped. Mitigation: `ssoHosts` setting, a clear "sign-in host blocked: add it in settings" message (host shown locally, never logged), and S2 tests with a federated account when available.
- [Google adds a navigation host] → fenced. Mitigation: `fenced-dropped` counter, one tested helper, quick follow-up.
- [Persistent Google session] → explicit sign-out; rollback note.
- [Pointer read size] → the 64 KiB cap applies after core's read (D2 trade-off).
- [Repo-supplied pointer opens a Google doc chosen by someone else] → accepted. The constructed URL is always `docs.google.com`, and the document shows in Google's own UI (owner, sharing). This is no more exposure than clicking a shared link.
- [Unload blocked for all views] → the user must close a tab. This beats silent edit loss.
- [Electron-only] → plain-browser and mobile clients get the fallback card.

## Open Questions

- Q1 (S2): subframe and top-level host lists, popup need, `beforeunload` during save debounce, paste, fullscreen, default UA accepted by sign-in, federated SSO hops.
- Q2: Drive for Desktop stub shape (S3).
