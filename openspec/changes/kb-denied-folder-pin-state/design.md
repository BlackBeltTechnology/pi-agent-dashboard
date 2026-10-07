## Context

- Sidebar folder set ⊋ server `host.knownFolderCwds` (live sessions ∪ pinned, `packages/server/src/server.ts:1357`). An archived-only folder (sessions evicted from `sessionManager` by `archive-sessions-lazy-load`) still renders its folder group, OpenSpec card and KB slot.
- `isAllowedCwd` (`packages/shared/src/cwd-guard.ts`) refuses such a cwd → every `/api/kb/*` returns `403 { error:"cwd not allowed", reason, hint }` (`packages/kb-plugin/src/server/kb-routes.ts:86-92` `denyCwd`).
- OTHER 403s reach the same routes and are NOT cwd refusals: `403 { error:"network_not_allowed" }` (`packages/server/src/auth/localhost-guard.ts:355,367`), `403 { error:"host_not_allowed", reason, hint }` (`packages/server/src/auth/host-gate.ts:263,375`; HTML variant `:373`), `403 { error:"forbidden" }` (`packages/server/src/identity/identity-road-gate.ts`).
- Client today: `kb-api.ts:52-59` `parseJson` — non-JSON content-type → plain `Error("HTTP …")` BEFORE status check; JSON non-ok → `Error(json.error)`; status lost. `kb-stats-store.ts:198-210` `onStatsError` treats a stats 403 as a poll miss: `MAX_POLL_MISSES`=3 retries at `POLL_MS`=1s, then `error`. Reindex reject (`:122-126`) → `reindexError`. `FolderKbSection.tsx:78` maps both → red "index failed" + Retry.
- Consumers of the shared per-cwd store: `FolderKbSection` (sidebar + card), `KbSettingsPanel.tsx:152`. The panel ALSO loads `/api/kb/config` (`useKbConfig`, `:149`), which 403s for the same cwd → early return rendering the refusal text (`:194`) — the panel already shows the refusal independently of the stats store.
- Remedy contract: `openspec/specs/pinned-directories/spec.md` "A cwd-allowlist denial offers pinning as its remedy" names the KB plugin HTTP routes and pinning as the `allow-always` remedy ("Pinning from the remedy surface"). KB routes do not `hold` requests (`kb-routes.ts` `denyCwd`), so no access-grant dialog is raised for them — the KB row is the remedy surface, no duplicate prompt.
- Pin plumbing: `pin_directory` WS verb (`packages/shared/src/browser-protocol.ts:1731`), sent by `App.tsx:2008,2674`; server `directory-handler.ts:24-54` persists + broadcasts `pinned_dirs_updated { paths }` (`:54`). Plugin seams: `usePluginSend` (`plugin-context.tsx:414`, fire-and-forget, no ack; THROWS outside `PluginContextProvider`), `usePluginMessage(type, handler)` (`:436`), `useShellConnectionStatus` (`:298`, soft-returns `disconnected` without provider). Send before `connected` is silently dropped (`:123-124`). `pin_directory` requires `workspace.write` scope (`packages/server/src/identity/ws-road-classification.ts:37`).
- Reproduced live: `GET /api/kb/stats?cwd=/Users/robson/Project/rackinspect` → 403 `cwd not allowed`; all `.worktrees/*` of this repo → 200.

```mermaid
stateDiagram-v2
  [*] --> loading
  loading --> denied: stats 403 cwd-not-allowed
  loading --> derived: 200
  derived --> pending: reindex()
  pending --> denied: POST 403 cwd-not-allowed
  pending --> error: other reject
  denied --> pinning: Pin (connected) — pinPending
  pinning --> derived: pinned_dirs_updated → refetch 200
  pinning --> denied: refetch 403 / PIN_GUARD_MS elapsed
  denied --> derived: pinned_dirs_updated (external pin) → refetch 200
  state derived {
    error2: error
    not_indexed
    indexing
    stale
    populated
  }
```

## Goals / Non-Goals

**Goals:**
- Cwd-refusal 403 → distinct `denied` state, non-error styling, server `reason` in tooltip, no Retry.
- One-click **Pin folder** from the KB slot that recovers the real state.
- `denied` clears whenever the folder gets pinned — by this control or any other pin path.
- Cwd-refusal 403 stops polling at once (definitive, not transient).

**Non-Goals:**
- Server guard / `knownFolderCwds` widening (archived-only admission = option B, separate decision).
- Any server, protocol, or persistence change.
- `KbSettingsPanel` — untouched (already shows the refusal via its config load, see Context).
- `KbTestSearch`, mcp-client's identical guard behavior, unpin.
- Re-probing `denied` when a SESSION (not a pin) starts in the folder — deliberately not keyed on `session_added` (see Risks).

## Decisions

**D1 — Typed refusal error, discriminated by body code.** In `kb-api.ts` `parseJson`, inside the JSON branch: `!res.ok && res.status === 403 && json.error === "cwd not allowed"` → throw `KbCwdDeniedError extends Error` (`message = json.error`, `reason?`, `hint?`). Every other failure unchanged — including non-JSON 403 (proxy/host-gate HTML) and the `network_not_allowed` / `host_not_allowed` / `forbidden` 403s → plain `Error` → existing error channels. Alternative — status-only `403`: rejected, misclassifies the auth/host/tier gates and would offer a Pin that can never help. The literal is already contractual (`kb-routes.ts:89`, asserted by `kb-routes.test.ts:148`). Blast radius: `parseJson` is shared by all eight kb-api calls (`fetchKbConfig`, `fetchKbSources`, `searchKb`, `saveKbConfig`, `grantSourceTrust`, …); their consumers only test `instanceof Error` and render `message` (`useKbConfig.ts:47,65`, `kb-stats-store.ts:65`), so they are byte-identical. The error also carries `code = "cwd_not_allowed"`; the store discriminates on `code` (robust to duplicated module copies in bundled builds), not `instanceof`.

**D2 — `denied` = scalar snapshot fields; `pending` semantics untouched.** `KbStatsSnapshot` gains `denied: boolean`, `deniedReason: string | null`, `pinPending: boolean`; all three added to `update()`'s field-wise equality (`kb-stats-store.ts:235-249`) so identity stays load-bearing. Fields also added to `EMPTY_SNAPSHOT` (`kb-stats-store.ts:56-62`) and `UseKbStatsResult` (`useKbStats.ts:29-45`); the hook additionally exposes `beginPinWait: () => void` (a `useCallback` over `store?.beginPinWait()`, like `reindex`/`refetch`). Set by `onStatsError` — the refusal branch runs AFTER `this.inFlight = false` (`:199`) and BEFORE `misses += 1`, otherwise `onSubscribed`'s `inFlight` early-return (`:144`) wedges revalidation — and by the reindex `.catch`, both on `code === "cwd_not_allowed"`, with patch `{ denied:true, deniedReason, loading:false, pending:false, pinPending:false, error:null, reindexError:null }` + `stopPoll()` + `clearGuard()` + clear pin timer + `misses = 0`. Clearing the two error channels is deliberate: a pre-refusal failure is obsolete once the folder must be re-admitted, and leaving it would force `error` after re-admission. `onStats` success additionally sets `denied:false, deniedReason:null, pinPending:false` + clears the pin timer; its existing `pending` rule (clear only on `indexing:true`, `:184-192`) is UNCHANGED. Non-403 semantics of both error channels (fix-kb-index-feedback) unchanged. Mid-index refusal (folder unpinned while a job runs): `denied` wins and polling stops; the job's outcome becomes visible after re-admission.

**D3 — Precedence `denied > error > pending/indexing > loading > not-indexed > stale > populated`; `denied` has a `pinning` sub-presentation.** `FolderKbSection` call site: `state = denied ? (pinPending ? "pinning" : "denied") : clientError ? "error" : pending ? "indexing" : deriveKbRowState(stats)`. `deriveKbRowState` stays pure over stats (returns `loading` on null stats; `denied` outranks it because a refusal leaves stats null).

**D4 — Pin via existing WS verb, sent by the component.** `FolderKbSection` calls `usePluginSend()({ type:"pin_directory", path: cwd })` — same verb App.tsx sends; no new route. The store never holds `send`. Pin affordance (card sibling AND sidebar menu item) is disabled unless `useShellConnectionStatus() === "connected"`. `usePluginSend` throws without `PluginReactContext` (`plugin-context.tsx:414-417`; `CurrentPluginLayer` does not supply it). Slots render inside `PluginContextProvider` in production; `FolderKbSection.test.tsx` renders the component at three provider-free sites (`:50-60`, `:63-72`, `:358`) — all three gain a stub provider supplying `send`, `ws`, and connection status.

**D5 — Recovery keyed on ANY `pinned_dirs_updated` while denied + bounded pin window.**
- Listener mounted ONLY while denied: `FolderKbSection` renders a tiny child `<PinnedDirsWatcher onUpdate={refetch} />` when `denied`; the child calls `usePluginMessage("pinned_dirs_updated", onUpdate)`. `usePluginMessage` attaches one `ws` listener that `JSON.parse`s every frame (`plugin-context.tsx:436-456`), so an unconditional subscription per mounted section (one per sidebar folder + worktree card) would add N parses per frame; conditional mount keeps the cost at zero for admitted folders and makes the denied condition structural (no stale closure). No path matching — broadcast paths are server realpath-canonical (`directory-handler.ts:21-31`) and the client cannot canonicalize; one cheap refetch is self-correcting (still 403 → stays denied). Covers the KB Pin AND every other pin path. Multiple mounted placements each call `refetch`; the store's epoch abort (`kb-stats-store.ts:162-170`) coalesces them.
- Store gains `beginPinWait()`: no-op if `pinPending` or `!denied`; else `pinPending:true` + a dedicated tracked timer `PIN_GUARD_MS` (3000), cleared in `dispose()`. Elapse → `pinPending:false` + `refetchIfObserved()` (never fetch at zero subscribers, mirroring the reindex guard, `kb-stats-store.ts:115-121`). `onStats` success / `KbCwdDeniedError` clear it (D2).
- Alternative — blind refetch ladder (0/500/1500 ms): rejected; racy and misses external pins. Alternative — reuse `pending`: rejected; it is the shared reindex-optimism channel (`useKbStats.ts:36-40`) and would disable reindex in every consumer.

**D6 — Presentation.** `SlotAccent` (`SlotPill.tsx:30`) has no neutral member → keep `cyan` (accepted trade-off, no runtime change); distinguish by label in `--text-tertiary` + pin glyph on the control.
- `denied`: label `t("labelNotAllowedShort","not allowed")`; `activateTitle` = localized `t("titleDenied", …)` ("Folder not admitted — pin it to enable the knowledge base"). The server `reason` is constant English (`kb-routes.ts:90`) and is NOT shown (ui-i18n-coverage: server emits codes, not display English); `deniedReason` is kept in state for diagnostics only.
- `pinning`: label `t("labelPinningShort","pinning…")`; control disabled.
- Card sibling: `mdiPinOutline`, aria-label/tooltip `t("pinFolder","Pin folder")`; offline → disabled, tooltip `t("pinOffline","Pin folder — offline")`.
- Sidebar menu item: same id `kb-reindex` (one-KB-item invariant), icon `mdiPinOutline` in `denied`/`pinning` (else `mdiDatabaseRefreshOutline`), label "Pin folder" (unchanged during `pinning`), `disabled = pinPending || !connected`, `badge = t("labelOffline","offline")` when not connected (contribution has no tooltip field, `folder-menu-contributions.tsx:261-279`), `onSelect` = pin handler. Pin handler `useCallback`ed; `useMemo` deps add `denied`, `pinPending`, `connected`, the pin handler (`FolderKbSection.tsx:101-114`).

## Risks / Trade-offs

- [Pin widens admission for ALL path-guarded features of that folder] → explicit user click; label "Pin folder", not "Allow KB"; identical to the existing sidebar pin; matches the spec'd remedy (`pinned-directories` "A cwd-allowlist denial offers pinning as its remedy").
- [Pin side effects beyond admission: `directory-handler.ts:24-78` re-keys the archive index, imports historical on-disk sessions via `directoryService.onDirectoryAdded`, folder becomes a durable pinned sidebar entry] → same as any pin; manual check verifies sidebar stays coherent.
- [Workspace-owned folder: the sidebar hides its pin item (`pinned-directories-ui`), but server pin is valid and leaves workspace membership intact (`pinned-directories` "Pinning a folder that is in a workspace")] → KB Pin offered there too; folder additionally appears in the pinned list. Accepted.
- [Sidebar pin indicator lags the KB pill (plugin send skips App's optimistic `setPinnedDirectories`; shell catches up on the broadcast, `useMessageHandler.ts:1721`)] → transient, accepted.
- [Folder admitted by a new SESSION (no pin) stays `denied` until the consumer remounts / page reload] → deliberate: not subscribing to `session_added` (high-frequency, unrelated to most folders). Rare; starting a session usually remounts the folder group.
- [KbSettingsPanel opened with a loaded config, then folder unpinned: reindex click → `denied` only, panel's error line shows nothing] → rare edge; panel untouched by design; next panel load shows the config 403.
- [Neutral styling limited to label color — accent remains cyan] → accepted (D6).
- [`pinned_dirs_updated` delivery is itself grant-filtered (`packages/server/src/identity/bootstrap-grants.ts:51` `workspace` family; `browser-gateway.ts:1418`)] → a client lacking the `workspace` grant never sees the broadcast: its own pin recovers via the `PIN_GUARD_MS` elapse refetch; an external pin is only picked up on remount. Accepted.
- [Any broadcast while denied — including unpins of unrelated folders — costs one 403 refetch per denied folder] → bounded by the number of denied folders; accepted over unreliable client-side path matching.
- [Connection status is consumer-local (not in the shared snapshot)] → both placements render under one shell provider, so they agree in practice; the shared invariant covers `denied`/`pinPending` only.
- [Worktree card offering Pin for a worktree cwd] → a worktree is denied only when its main checkout is not known (`cwd-guard.ts:66-95`); pinning creates a durable pin on a transient directory that dangles after worktree removal. Accepted — same as pinning it from the sidebar; unpin remains available.
- [Settings page for a denied folder still renders the config 403 as red raw text (`KbSettingsPanel.tsx:194`)] → visually inconsistent with the non-error pill; panel is out of scope. Accepted.
- [`pin_directory` lacks `workspace.write` scope for the client (`ws-road-classification.ts:37`)] → no broadcast → `PIN_GUARD_MS` elapses → back to `denied`; no false success.
- [Existing tests asserting 403 → `reindexError` / "index failed" and provider-free `FolderKbSection` renders] → updated intentionally in the same commit.

## Migration / Rollback

Client-only. No persisted data, no protocol change. Rollback = revert commit + `npm run build` + restart.
