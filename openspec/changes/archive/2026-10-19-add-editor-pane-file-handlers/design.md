## Context

See proposal.md — Why. Current state (cited):

**Pane dispatch.**
- `EditorPane.tsx` dispatches the active tab by `activeTab.viewer`: pseudo-tab kinds go to `pseudo-tab-registry.tsx`, `plugin` goes to `PluginTabHost`, and every file goes to `CappedViewer` → `viewerRegistry`.
- `viewer-kinds.ts` partitions `ViewerKind` (20) with a compile-time totality assertion.
- Tab state persists per session in `lib/layout/editor-pane-state.ts` (`VALID_VIEWERS`, `dropUnknownViewers`).

**`editor-pane-tab` slot** (`openspec/specs/dashboard-shell-slots/spec.md` "`editor-pane-tab` slot"; `docs/plugin-seams.md`):
- prefix-addressed (`<prefix>:<rest>`, `PANE_TAB_PREFIX_RE`);
- body rendered only while active;
- claims carry `component`, `pathPrefix`, `labelComponent`.

**Keep-alive precedent.** `TerminalPaneLayer.tsx` mounts one view per open `term:` tab beside the pane body and toggles visibility (single-mount-per-id contract).

**Text writes.**
- `POST /api/file/write` → `prepareMdWrite` → `isWritableMdTarget` (`packages/server/src/routes/file-routes.ts:152-170`).
- mtime 409; per-target serialization (`file-routes.ts:96-98`); atomic tmp+rename.
- No `application/octet-stream` parser exists in `packages/server/src`; Fastify's default `bodyLimit` is 1 MiB (only override `pi-settings-routes.ts:199`).

**Tiers.** `packages/shared/src/route-tiers.ts:30` `ROUTE_TIERS`; unlisted routes default to `operate` (`:480-482`).

**Loopback trust.** `auth/auth-plugin.ts:491` returns early for `isLocallyTrusted`. `cors-origin.ts:128-132` refuses ACAO for `null`. `mutation-origin-gate.ts:34-53` 403s non-safe `null`-origin requests.

**Dependency** (`gate-changed-on-disk-by-content`, lands first):
- per-tab content baseline;
- `GET /api/file/digest` → `{size, mtime, sha1}`;
- `/api/file/write` returns `sha1`;
- own-save suppression;
- watch survives atomic replace.

## Goals / Non-Goals

**Goals:**
- A file-type-addressed plugin extension point whose safety-critical behaviour lives in core: containment, conflict, unsaved-edit protection, resource bounds.
- A small, versionable handler props contract that does not leak core internals.
- Zero change for users with no handler plugins enabled.

**Non-Goals:**
- Re-registering built-in viewers through the slot (L2), and per-extension "always open with" defaults (later change).
- Handler-defined server routes beyond the existing plugin route mechanisms.
- Text editing via handlers. Text kinds keep `/api/file/write`.
- Handlers for pseudo-tabs (`diff:`, `term:`, `url:`, `live:`) or plugin tabs.

## Decisions

### D1 — New slot, not an extension of `editor-pane-tab`
`editor-pane-tab` is addressed by a virtual path the plugin owns. File handlers attach to *real workspace files* whose tab path, viewer kind, containment and banner already exist. Folding both into one slot would change one of the two addressing models, and would make every `pathPrefix` claim validate extension fields it never uses.

**Claim fields.**

| Field | Required | Rule |
|---|---|---|
| `component` | yes | handler body (may be lazy via `module`, like other claims) |
| `id` | yes | `^[a-z][a-z0-9-]{0,31}$`, unique within the plugin |
| `extensions` | yes | non-empty; each `^\.[a-z0-9][a-z0-9+-]{0,15}$` (lower-case, single segment — `extOf` takes the last dot, so `.tar.gz` could never match; no wildcard); see "text-backed rejection" below |
| `mode` | yes | `"preview"` \| `"edit"` |
| `label` | yes | ≤ 40 chars |
| `keepAlive` | no | `{ max: 1..3 }` |
| `maxBytes` | no | ≤ core ceiling `HANDLER_MAX_BYTES = 128 MiB`; default = ceiling |
| `firstOverwriteNotice` | no | ≤ 300 chars |
| `validator` | no | `true` = saves require the plugin's registered validator (D4 fail-closed) |
| `copySuffix` | edit mode: yes | `^[a-z][a-z0-9-]{1,31}$` (required, so no lossy plugin-id fallback) |

Ordering uses the existing plugin-level `priority` (ascending, default 1000; `openspec/specs/dashboard-shell-slots/spec.md` "Plugin priority orders contributions deterministically"), then plugin id, then claim id. There is no per-claim priority.

**Text-backed rejection, derived from `fileKind`.** A claimed extension is rejected when `fileKind("/x" + ext)` (an absolute probe path — `fileKind` throws on relative paths, `file-kind.ts:311-312`) (`packages/shared/src/file-kind.ts`) returns `editable: true`, or returns a *recognised* kind (`kind !== "unknown"`) whose viewer is in `{monaco, markdown, mermaid, asciidoc, html, diagram}`. This covers `.md`/`.mdx`/`.markdown`, `.csv`, `.adoc`, `.mmd`, `.puml`/`.plantuml`, `.txt`, `.json`, source code and `.html`. The check is exported as `isTextBackedExt(ext)` from `file-kind.ts` and used by the manifest validator. Unrecognised extensions (`.drawio`, `.psd`, `.odt`) fall through to `{kind:"unknown", viewer:"monaco"}` (`file-kind.ts:355`) and stay claimable — they are the extension point's purpose. Text stays on `/api/file/write` and its `isWritableMdTarget` gate. Deriving the set from `fileKind` keeps it the single source of discrimination, so new text kinds are covered automatically.

**Plumbing** (all three are needed, or fields are silently dropped):
- `packages/shared/src/dashboard-plugin/manifest-types.ts`: `PluginClaim` gains the fields above.
- `packages/dashboard-plugin-runtime/src/manifest-validator.ts`: validates and copies them into the normalized claim.
- `packages/dashboard-plugin-runtime/src/server/loader.ts:259-300` registry serialization: adds each field with the existing spread-when-present pattern, so other plugins' hashes are unchanged.

A duplicate (`pluginId`, `id`) is a generation error. Two plugins claiming the same extension is allowed (`many`); the switcher lists both.

### D2 — Mode is per-tab state, not a viewer kind
The tab keeps its built-in `viewer` (e.g. `docx`).
- **Mode state.** A new optional field `handlerMode: "<pluginId>/<claimId>"` in `editor-pane-state`. `undefined` = built-in view. `isValidState` accepts it as an optional string. It is *not* validated at load: `loadEditorPaneState` is synchronous and the slot registry may not be ready. It is resolved at render; a missing or disabled claim renders the built-in view for that tab only.
- **`ViewerKind` unchanged.** No new kind, so `viewer-kinds.ts` totality and `VALID_VIEWERS` are untouched.
- **Matching.** The switcher and the server both compare the file's extension normalized by the `fileKind` module's `extOf` (`file-kind.ts:239-245`, lower-cased; exported by this change). `REPORT.DOCX` therefore matches `.docx` on both sides.
- **Switcher.** A new `FileModeSwitcher` toolbar above `CappedViewer`, shown only when ≥1 enabled claim matches. Built-in view first, then claims in D1 order.
- **Built-in viewer lifecycle.** While a handler mode is selected, `CappedViewer` is not mounted, so no preview fetch or office conversion runs. Selecting the built-in view mounts it as today. The "kind-based registry" dispatch requirement is MODIFIED to say so.
- **`handlerMode` load check.** `isValidState` (`editor-pane-state.ts:301-321`) is all-or-nothing, so the field gets an explicit `typeof === "string"` check like `unread`/`autoOpened`; a malformed value is dropped for that tab only.
- **Files the built-in pane treats as binary.** A claimed extension classified `binary-warn` still gets the switcher; its built-in view is the existing binary notice.
- **Outside the session cwd.** Handler modes are offered only for files whose path lies under the session cwd, the same anchor as the write route. Files reachable through the wider read containment (git common root, `file-read-containment`) show the mode unavailable ("outside the session folder"), so a snapshot can never be taken that cannot be saved.

**Alternative considered:** a `plugin-file` viewer kind. Rejected: it duplicates the built-in kind and breaks `fileKind` as the single classifier.

### D3 — Handler props contract
`FileHandlerProps` (exported from `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin`, versioned with the slot):

```ts
interface FileHandlerProps {
  cwd: string; path: string; session: DashboardSession | null; isActive: boolean;
  snapshot(): Promise<{ bytes: ArrayBuffer; size: number; mtime: number; sha1: string }>;
  save(bytes: ArrayBuffer, opts: { target: "overwrite" | "copy" }):
    Promise<
      | { ok: true; path: string; mtime: number; sha1: string }
      | { ok: false; reason: "cancelled" | "conflict-unresolved" | "rejected" | "too-large" | "busy"; message: string }
    >;
  setDirty(state: boolean | "unknown"): void;   // initial state = "unknown" until first call
  context: PluginContext;
}
```

**`snapshot()`** — consistent bytes + content token, as a digest bracket. `GET /api/file` is *not* used: it returns whole `content` for `monaco`-viewer files, which includes every unrecognised extension (`file-routes.ts` ~591-600).
1. `GET /api/file/digest` → `size`, `sha1₁` (no content); above `maxBytes` → reject `too-large` before any content is fetched;
2. `GET /api/file/raw` with `cache: "no-store"`;
3. digest again → `sha1₂`.

Accept when `sha1₁ = sha1₂` and `sha1(bytes) = sha1₂`; mtime-only changes (touch) do not force a retry. Otherwise retry up to 3 times, then reject. The token is `sha1`. The result sets the instance's changed-on-disk baseline to `sha1`. A file that grew past `maxBytes` between the size check and the bracket is refused by the size of the fetched bytes; the digest ceiling (256 MiB) is never reached because such files are refused first.

**`save()`** — core runs the policy, then writes; the handler only sees the outcome.
- **First overwrite.** With `firstOverwriteNotice`, the first `overwrite` per instance (D5) shows Overwrite / Save as copy / Cancel.
- **POST** `/api/file/write-binary` with `expectSha1` = the last snapshot or successful-save `sha1`.
- **409.** Conflict dialog:
  - Reload from disk (confirm when dirty → re-mount, resolves `cancelled`; hidden when the file no longer exists);
  - Save as copy;
  - Overwrite anyway (re-reads the digest, re-sends with the new `expectSha1`; an explicit, spec-level exception to "only if unchanged": the user chose to replace whatever is on disk now, and the dialog states that the agent's or another change will be lost);
  - Cancel.
- **Success.** The `write-binary` call is wrapped in the dependency's per-path in-flight save tracker (`trackedFileWrite`, `gate-changed-on-disk-by-content` D3). That wrapper is route-agnostic: it takes the save promise and its `sha1` result. So a candidate arriving during a handler save is verified after it settles, and the baseline becomes the saved `sha1` (no banner on the own save).
- **Copy.** Toasts the new path with "Open". The instance stays bound to the original file and its token is unchanged.

**`setDirty`** feeds the guards (D5). `"unknown"` is treated as dirty for every guard decision.

**Alternative considered:** let the handler call routes directly. Rejected: every plugin would re-implement conflict UX and baseline bookkeeping, and the dependency's own-save suppression would be bypassed.

### D4 — `POST /api/file/write-binary`
- **Registration.** In an encapsulated Fastify plugin that holds only this route. It registers a `Buffer` content-type parser for `application/octet-stream` with `bodyLimit: HANDLER_MAX_BYTES`, scoped to that encapsulation context. Verified with `fastify.inject`.
- **Query.** `cwd`, `path`, `mode=overwrite|copy`, `expectSha1` (required for overwrite; absent → 400, never "skip the check"), `claim=<pluginId>/<claimId>`.
- **Tier and guard.** `ROUTE_TIERS` entry → `control`; `{ preHandler: networkGuard }` like every other file route (`file-routes.ts:764`). Loopback-trusted callers bypass tier gating as on `/api/file/write` today (existing residual, D7 follow-up).
- **`isWritableHandlerTarget(rawPath, {cwd, claim})`:**
  - `cwd` must be a known session cwd, the same check as `resolveScopedMdPath` (`packages/server/src/routes/file-routes.ts:130-135`); unknown → 403;
  - overwrite target: realpath under `<cwd>/**`, symlink/`..` escape → 403, and **both** the requested and the realpath extension ∈ `claim.extensions`;
  - copy target: realpath of the *parent* directory under `<cwd>/**`, basename built by core (never caller-supplied), extension = the source's;
  - the claim exists in the server-loaded plugin registry, its plugin is enabled (`plugin-enabled.ts` resolution, read at request time), and `mode` is `"edit"`;
  - body ≤ `claim.maxBytes`.
- **Validator hook.** `ctx.registerFileValidator({ claimId, module, enabled? })`. `enabled` is an optional main-thread predicate evaluated before anything else for that claim (false → 403), so a plugin can refuse saves for a sub-feature it has switched off without a restart. `claimId` must name one of the registering plugin's own edit claims, otherwise the call throws. `module` is a relative path with no `..`, realpath-confined to the plugin's package (the manifest `module` rule), exporting `validate(bytes, ext) → {ok} | {ok:false, reason}`.
  - Core runs it in a bounded `worker_threads` pool (2 workers, FIFO queue of 8, overflow → 503) with a hard `terminate()` at 5 s, so a synchronous loop cannot block the server. Bytes are transferred, not cloned.
  - It runs **before** acquiring the per-target lock, so a slow validator never stalls text saves to that file.
  - A throw, timeout or `ok:false` → 422; pool overflow → 503 (`save()` reports `busy`, retryable). It can only reject.
  - **Fail closed when not loaded.** A claim whose manifest declares `validator: true` is writable only while its plugin's server entry is loaded (`getPluginStatusStore().getStatus(id)?.loaded`, as at `server.ts:2477`) and has registered that validator. Enabling a plugin applies its server entry only after a restart (`plugin-activation-routes.ts` returns `restartRequired`), so between a live re-enable and the restart such saves get 503, not an unvalidated write.
- **Lock key.** Both routes key the per-target lock by the target's realpath (today `/api/file/write` keys `serializeWrite` by the unresolved path; this change switches it), so a symlink alias cannot run two writes to one file concurrently.
- **Overwrite.** Under that lock:
  - hash the current file; a mismatch with `expectSha1` (including a missing file) → 409 `{sha1?, mtime?}`. Content comparison, not mtime, so coarse or preserved mtimes cannot hide an agent edit;
  - tmp+rename with the existing file's mode preserved (as the text route does, `file-routes.ts:208`);
  - return `{mtime, sha1, path}`.
- **Copy.** `<stem>.<copySuffix>.<ext>` (stem and ext from the requested basename), then `-2`, `-3`… via exclusive create (`wx`), retrying on `EEXIST` (max 99). New files take the source file's mode, or `0644` masked by the process umask when the source no longer exists. Never overwrites. Returns as above.
- **Residual.** As with the text route, an external writer racing between hash and rename is not excluded (same window as today).

### D5 — Instance layer, keep-alive and guards
- **Every handler instance is page-level.** `FileHandlerLayer` is mounted once at the app shell, outside `EditorPane` and `SplitWorkspace` (`SplitWorkspace.tsx:128` unmounts the editor subtree when the pane closes; `EditorPane.tsx:199-214` keys tab bodies by path). It positions each instance over the active tab body and hides the rest. Closing the editor pane, switching layout, switching tabs or switching sessions therefore never unmounts an instance.
- **Scope.** Handler modes exist only in session-scoped editor panes (`SessionSplitView`); folder-scoped panes (`DirectoryHomeView`, `FolderEditorView`) have no session cwd for the write route and show no switcher. The layer anchors to the session pane's body element via a `ResizeObserver`, so split and pane resizes keep the overlay aligned.
- **Instance key.** `sessionId + cwd + normalize(path)` (POSIX-normalized, so `./a.docx` and `a.docx` agree) `+ claim`. Tabs of the same file and claim in one session share an instance. Dirty state, first-overwrite flag and token live on the instance, so shared tabs agree. The instance is destroyed (through the guard) when its last tab closes.
- **Claims without `keepAlive`.** When their tab becomes inactive, the instance is closed only if its state is `false`; an unsaved or unknown instance stays mounted (hidden) and counts against the cap until saved, discarded or its tab is closed.
- **Cap and clock.** `MAX_LIVE_HANDLERS = 3` live instances per browser page across plugins and sessions (kept-alive ones and unsaved non-kept-alive ones alike); a claim's `keepAlive.max` lowers its own share. "Least recently used" = oldest last-activation time.
- **Eviction.** Mounting at the cap evicts the LRU instance whose state is `false`.
  - Its tab shows "Editor closed to save memory — Resume" (fresh mount + `snapshot()`).
  - If none is evictable, a dialog names the unsaved tabs and asks to save or discard one; Cancel aborts the mount.
  - Eviction trusts the handler's `setDirty(false)`. The plugin is trusted code; a handler that reports clean while holding edits loses them on eviction. This is stated in the slot contract, together with "call `setDirty` as soon as the document is loaded" (an `"unknown"` instance is never evictable).
- **Plugin disabled live.** Disabling applies without a reload (`usePluginEnabledSet.ts:75` → `setEnabledSet` + `bumpSlotClaimsVersion`). The layer keeps the component reference captured at mount, so a disabled claim's instance stays mounted:
  - state `false` → closed, tab falls back to the built-in view;
  - unsaved/unknown → the instance stays, overlaid with "<plugin> was disabled. Re-enable it to save, or discard the edits." The server refuses saves for a disabled plugin's claims, so the overlay offers only **Re-enable** (opens plugin settings) and **Discard** (confirm).
- **Every core-initiated discard is guarded** when the state is `true` or `"unknown"`: mode switch, last-tab close, banner/manual Refresh, conflict-dialog Reload, eviction (never automatic), plugin disable (overlay above), page unload/reload (`beforeunload`).
- **Refresh wiring.** The header refresh and banner Refresh (`EditorPane.tsx:278,359-360`) bump `refreshNonce`, which only re-keys `CappedViewer`. When the active tab is in a handler mode, the same handler instead calls the layer's `remount(instanceKey)` after the guard. The banner clears only once the re-mount proceeds; Cancel leaves it shown.
- **Deleted or renamed file.** The instance stays mounted. The next overwrite gets 409 (no file / different content) and the conflict dialog offers Save as copy.

### D6 — Refresh and the large-file limit, without re-modifying the dependency's requirements
`gate-changed-on-disk-by-content` MODIFIES "changed-on-disk banner" and "Oversized files". This change does not MODIFY them again (no double-MODIFY):
- **Refresh.** The banner requirement says Refresh "SHALL re-fetch via the existing manual-refresh path". This change defines that path for handler tabs inside "Pane SHALL be read-only in v1" (which owns the manual-refresh button and is not modified by the dependency): on a handler tab, manual refresh confirms when the state is unsaved or unknown, then re-mounts the handler from a fresh snapshot. The banner text therefore stays true for handler tabs.
- **Large-file limit.** "Oversized files" gates *rich viewers* and lists built-in renderers. A handler mode is not a rich viewer; an ADDED requirement states that handler modes are gated by `claim.maxBytes` only.

### D7 — Opaque-origin `/api/*` GETs: out of scope, follow-up
Sandboxed opaque-origin frames on the operator's machine (live-server previews today, handler frames such as craft-web tomorrow) can issue credential-less loopback GETs to `/api/*`. CORS hides the responses (`cors-origin.ts:128-132`) and `mutation-origin-gate` refuses non-GETs, but side-effecting GETs execute.
- Closing this belongs in the shared genuine-local predicate (`isLocallyTrusted` callers: `auth-plugin.ts:491`, `localhost-guard.ts` network guard, `route-tier-gate.ts`, `operate-required.ts`, `canDiscloseAccessPosture`). `close-loopback-legacy-window` already MODIFIES that requirement, so a follow-up hardening change, sequenced after it, covers live-server and handler frames together.
- This change adds no new exposure for core: core handlers themselves render no frames. Handler plugins that frame third-party code document the residual.

## Risks / Trade-offs

- **[Contract lock-in]** → Props contract versioned with the slot. New fields are optional-additive; the doubt-review gates it.
- **[Heavy handlers exhaust memory/GPU]** → D5 cap, dirty-aware eviction, opt-in modes only. No byte budget beyond `maxBytes` per instance (≤ 3 × 128 MiB worst case); accepted.
- **[A malicious enabled plugin writes workspace files]** → Writes need `control` tier, a known session cwd, an enabled `edit` claim for that extension (requested and real), realpath containment and size caps. Text kinds are not claimable. A plugin is trusted code already; this does not widen trust beyond its declared non-text extensions.
- **[Handler misreports dirty state]** → Edits lost on eviction (D5); documented contract.
- **[Two plugins claim the same extension]** → Both appear in the switcher; no silent override. A default handler is deferred to L2.
- **[Snapshot retries under a busy writer]** → 3 retries then a visible error; the user retries.
- **[Loopback-exempt observe bearers]** → As for `/api/file/write` today, tier gating applies to non-loopback devices; no new exposure. Closed with the D7 follow-up.
- **[`.svg` / `.eml` claimable]** → They are not text kinds in `fileKind` (image / email). A handler writing them passes the same containment and validator rules; accepted.

## Migration Plan

- Additive:
  - new slot (minor bump of `pi-dashboard-shared`);
  - new route;
  - new optional tab-state field (older state hydrates unchanged);
  - no existing path changes behaviour.
- **Rollback:** disable handler plugins. Core with no claims renders exactly as today.
