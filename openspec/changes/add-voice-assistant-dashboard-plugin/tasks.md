## 1. Scaffold the plugin package

- [ ] 1.1 Run the `dashboard-plugin-scaffold` skill in `new` mode: id `voice-assistant`, display name "voice-assistant", **server entry yes, bridge entry NO**, configSchema yes, slots `session-card-badge`, `session-card-action-bar`, `sidebar-folder-section`, `shell-overlay-route`, `settings-section` (the wall uses none of these — it opens via the core `live-server-preview` mechanism, not a plugin claim; the knowledge browser is folder-scoped per design 6b, so NO `content-view`/`command-route` claim).
- [ ] 1.2 Register `packages/voice-assistant-plugin` as a pnpm workspace member; run `pnpm install` at repo root.
- [ ] 1.3 Add `NOTICE`/README documenting: upstream repo `tatargabor/set-copilot`, MIT license, the vendored commit SHA, and the explicit exclusion list (`cli.ts`, `doctor.ts`, `mirror-follow.ts`, `mirror-policy.ts`, `config-migrate.ts`, `.claude/skills/`, `hooks/`).

## 2. Vendor the set-copilot library surface

- [ ] 2.1 Copy `config.ts` → `src/vendor/set-copilot/config.ts` (exports `loadConfig`, `normalizeKeywords`, `DEFAULT_ALERTS`, `DEFAULT_DETECT`, `DEFAULT_DEFERRED_MARKERS`, `DEFAULT_COMPLETE_WORDS`, `CopilotConfig` and friends).
- [ ] 2.2 Copy `capture.ts` (`runCapture`, `CaptureOptions`) and its direct imports `soniox-rt.ts`, `whisper-local.ts`, `tones.ts`, `handover.ts` into `src/vendor/set-copilot/`.
- [ ] 2.3 Copy `transcript-writer.ts` (`TranscriptWriter`, `TranscriptLine`, `SilenceEvent`), `transcript-build.ts` (`stitchTranscript`, `stitchText`, `parseLines`, `renderPlain`), `transcript-stitch-run.ts` (`stitchFile`, `artifactPaths`) into `src/vendor/set-copilot/`.
- [ ] 2.4 Copy `poll.ts` (`runPoll`) into `src/vendor/set-copilot/`.
- [ ] 2.5 Copy `copilot-prompt.ts` (`renderCopilotPrompt`, `renderAlerts`) into `src/vendor/set-copilot/`.
- [ ] 2.6 Copy `knowledge/types.ts`, `knowledge/markdown-adapter.ts`, `knowledge/sources.ts`, `knowledge/keyword-matcher.ts`, `knowledge/run-digest.ts` into `src/vendor/set-copilot/knowledge/`. Note per design 4e: `types.ts` + `keyword-matcher.ts` are PRIMARY (used on both backend paths); `markdown-adapter.ts`, `sources.ts`, `run-digest.ts` serve the no-kb FALLBACK path only.
- [ ] 2.7 Copy `wall/index.ts` (`runWall`, `wallEventsPath`), `wall/server.ts` (`WallServer`), `wall/categories.ts`, `wall/types.ts`, and their direct imports `wall/director.ts`, `wall/emit.ts`, `wall/event-source.ts`, `wall/redaction.ts`, `wall/routing.ts`, `wall/channels.ts`, `wall/public/*` (static wall assets) into `src/vendor/set-copilot/wall/`.
- [ ] 2.8 Copy `recovery-ledger.ts` only if `transcript-stitch-run.ts` needs it at runtime; otherwise drop it (upstream's `index.ts` re-exports it for library consumers but the plugin does not use the recovery/ledger CLI path).
- [ ] 2.9 Add `ws` as a direct dependency of `packages/voice-assistant-plugin` (matches upstream's own dependency for `wall/server.ts`), and `@blackbelt-technology/pi-dashboard-kb` (workspace) for the kb knowledge path.
- [ ] 2.10 Fix relative imports after the move; confirm (via `tsc --noEmit` or the package's build) that no vendored module imports `cli.ts`, `doctor.ts`, `mirror-follow.ts`, or `mirror-policy.ts`.

## 3. Server entry — capture + session-prompt orchestration (`src/server/index.ts`)

- [ ] 3.1 Define `CaptureState` keyed by `` `${projectRoot}::${targetSessionId}` `` holding: capture handle, capture source (`server`/`browser`), `WallServer` instance, poll-loop abort controller, `onEvent` unsubscribe fn, last-known badge status.
- [ ] 3.2a VERIFY FIRST (design 4g, unverified seam): determine whether vendored `runCapture` can write its scratch transcripts outside the project tree — upstream resolves `.set/copilot/$SESSION_ID` relative to CWD. If no redirect parameter exists, either run capture with CWD set to the runtime dir while loading config explicitly from the project root, or record a second narrowly-scoped carve-out beside 4d's. Writing meeting transcripts inside the project's git working tree is NOT an acceptable default.
- [ ] 3.2b VERIFY FIRST (design 4g, unverified seam): determine whether vendored `soniox-rt.ts` implements its own reconnect policy. Adopt and document its bound if so; only add a plugin-side bound if it does not, rather than asserting a property the vendored module actually owns.
- [ ] 3.2 Implement `dict-start` (renames upstream's `ds`) for source `server`: call vendored `runCapture({ micOnly: true })` scoped to a runtime dir derived from `{ projectRoot, targetSessionId }` (substitute pi session id for upstream's `$CLAUDE_CODE_SESSION_ID` convention).
- [ ] 3.3 Implement `dict-end` (renames upstream's `dd`): call vendored `handoverTranscriptOnce` then `stitchTranscript`/`stitchText`; on stitch failure/empty result, fall back to the raw transcript text (fail-open, per design decision 3). Call `ctx.sendToSession(targetSessionId, text)`; on `false`, set an error/delivery-failed state and retain the text for retry. Shared by both capture sources.
- [ ] 3.4 Implement meeting-copilot start: call vendored `runCapture({})` (mic + system), then run a **per-capture, await-driven** batch consumer over the vendored `runPoll(cfg, windowSeconds)` — used as-is, unmodified (design 4f). One consumer per active pair, started with capture and stopped by every teardown path; NOT a server-wide fixed-interval poller, and no heavy synchronous work in the loop body.
- [ ] 3.4b Refuse a start that contends for the capture device already held by ANY active capture on this host (dictation or copilot, any project — the host has one microphone), naming the current holder in the error; make a repeated start for an already-running pair idempotent — no second recorder, no second consumer.
- [ ] 3.5 On each reaction-worthy batch (lines with `topics`/`urgency`/`question`/`command`), compose a message: first batch of the run prepends `renderCopilotPrompt(cfg)`; later batches are transcript-only. Call `ctx.sendToSession(targetSessionId, message)`; on `false`, set the copilot badge to error and stop forwarding further batches for that session.
- [ ] 3.5b Apply backpressure: at most ONE batch in flight per `{ projectRoot, targetSessionId }`. Batches produced while one is in flight MERGE in arrival order into a single pending payload (append, never replace), dispatched when the in-flight batch completes. Bound the pending payload by line/byte cap; on overflow drop OLDEST lines and insert an explicit truncation marker so loss is visible, never silent (design 4g). The wall leg still receives every line regardless.
- [ ] 3.6 Implement meeting-copilot stop: stop capture, stop the batch consumer, unsubscribe the `ctx.onEvent` handler, stop the `WallServer`, **deregister its live-server target**, and delete the `CaptureState` entry.
- [ ] 3.6b Wire `ctx.onSessionEnded` to run the same teardown for every capture pair bound to the ended session — dictation and copilot alike (design 4g). This hook exists on `ServerPluginContext` and was previously unused.
- [ ] 3.6c Spawn recorder children in their own process group and kill the group on teardown, so a killed/restarted dashboard (`/api/restart` is routine) cannot orphan a process holding the microphone. Register a process-exit handler that tears down every active capture.
- [ ] 3.6d Fault boundary around vendored code — all FOUR paths, since a sync `try/catch` alone catches none of the real crash modes (design 4f): (1) `try/catch` incl. `await` on every call in; (2) an `'error'` listener on EVERY emitter/stream vendored code exposes or returns (wall WS, Soniox socket, transcript streams) — an emitter with no `error` listener kills the process; (3) `child.on('error')` plus exit/close handling on recorders (`spawn` reports ENOENT asynchronously — a try/catch around `spawn()` will NOT catch a missing `sox`); (4) route rejections from vendored callbacks back to the owning pair so they never become process-level `unhandledRejection`. Degrade ONLY that pair.
- [ ] 3.6e Treat STT connection drop/auth-expiry/rate-limit as an explicit capture error state with a BOUNDED reconnect attempt — never an unbounded retry loop.
- [ ] 3.7 Subscribe via `ctx.onEvent((sessionId, event) => …)` scoped to the active target session id; extract assistant text from forwarded events and `ingest()` it into that project's `WallServer` as a copilot event. FIRST establish which `eventType`/field carries the FINAL assistant reply and how deltas are distinguished (design 4 unverified contract) — mirroring fragmented deltas or tool output would be worse than not mirroring.
- [ ] 3.8 Bind one vendored `WallServer` (via `runWall(cfg, { port })`) to its own loopback port per active project, when meeting-copilot starts; stop it when meeting-copilot stops. Serve upstream's own `wall/public/*` UI unmodified — no custom React wall component. Expose the bound port through a status endpoint the client's "View live wall" action reads.
- [ ] 3.8b VERIFY (do not assume) that upstream's `wall.js` builds a **prefix-aware** WebSocket URL so it still connects when served behind `/live/<id>/` from an opaque-origin iframe. If it does not, this is the one sanctioned exception to "serve upstream's UI unmodified" — record the deviation rather than silently patching (design 4b risk).
- [ ] 3.9 Implement `GET /api/plugins/voice-assistant/config` and `PUT /api/plugins/voice-assistant/config` taking an EXPLICIT folder param (the `settings-section` slot receives no session — never infer the folder from an active session), using the vendored `loadConfig`/config types for parse/validate. Reject folders outside the known-folder allow-list, enforce path containment on write, and apply the same request-auth guard other plugin REST routes use.
- [ ] 3.9b Mask the STT API credential on read and preserve the on-disk secret when the masked field is saved unchanged — never return the key in readable form to the browser.
- [ ] 3.10 Implement a read-only knowledge endpoint over the `KnowledgeBackend` seam (section 4) taking an explicit folder param, returning the resolved sources, the decisions, and the ACTIVE BACKEND id so the client can attribute results. Same allow-list + auth guard as 3.9.
- [ ] 3.11 Implement a preflight check (STT backend configured: Soniox key present or whisper model path exists; audio tooling present: `sox`/`parec` resolvable) exposed through a status endpoint the client badges consume — a server-side equivalent of upstream's `doctor.ts`, not a vendored copy of it. Include the dashboard server's own hostname in the response so the client can show WHICH machine's mic will be captured (design.md remote-access risk).

## 4. Knowledge backend seam (kb-first, vendored fallback)

- [ ] 4.1 Define the internal `KnowledgeBackend` interface (resolve sources, resolve decisions, optional facet counts, build keyword-index seed) — one contract, two implementations, no backend branching in the copilot flow.
- [ ] 4.2 Implement the kb-backed backend using `@blackbelt-technology/pi-dashboard-kb`: construct the folder's store from the package's exported `SqliteFtsStore`/`loadConfig` (mirroring `kb-plugin`'s `kb-routes.ts` — its `openStore` is a module-private helper, NOT an export of `packages/kb`), use `store.search(q, { filters })` with a `status` equality `Filter` for decisions and `store.facets(["status"])` for counts. NOTE: use the store API directly — the `kb_search` TOOL exposes no `filters` param.
- [ ] 4.3 Implement the fallback backend over the vendored `knowledge/sources.ts` (`resolveSources`) + `knowledge/markdown-adapter.ts`, with no facet counts.
- [ ] 4.4 Implement backend selection: kb when the folder is kb-admissible AND its index is populated; fallback otherwise. Record kb-admission rejection as an explicit "kb unavailable" outcome (logged + surfaced), never as an empty result.
- [ ] 4.5 Seed `knowledge/keyword-matcher.ts`'s index from the ACTIVE backend at meeting-copilot start (kb: indexed titles/headings/tags; fallback: vendored digest). Assert no knowledge-base query is issued per transcript line.

## 5. Client — dictation & copilot controls

- [ ] 5.1 `session-card-action-bar` claim: `dict-start`/`dict-end` buttons, disabled/relabeled per preflight state (from 3.11) and delivery-failure state (from 3.3). Title/tooltip states the capture host for the `server` source ("captures the microphone on <hostname>") so a remote user isn't misled into thinking it's their own mic. Source picker (`server` default / `browser`) — see section 7 for the `browser` leg.
- [ ] 5.2 `session-card-badge` claim: dictation status (idle/recording/error), annotated with active source when `browser`.
- [ ] 5.3 `session-card-action-bar` claim: start/stop meeting-copilot buttons, disabled/relabeled per preflight and "knowledge sources required" state.
- [ ] 5.4 `session-card-badge` claim: meeting-copilot status (idle/listening/error).

## 6. Client — live wall (embed via live-server-preview, no custom UI)

- [ ] 6.1 `session-card-action-bar` claim: "View live wall" button, visible/enabled only while a `WallServer` port is bound for that project (per 3.8's status endpoint).
- [ ] 6.2 On click, call `startLiveServer({ host: "127.0.0.1", port })` (same client API `CanvasServerChip` uses) to register the target and obtain the proxied `/live/<id>/` path. NOTE: `startLiveServer` returns a path — it does NOT mount a tab. Mounting the `LiveServerViewer` pseudo-tab is a separate step; if no host client API exposes pseudo-tab mounting to a plugin, fall back to navigating to the returned main-origin path and record the limitation.
- [ ] 6.3 Do NOT rely on `TabActions` for popout — `EditorPane` computes `tabActionTarget` as `null` for pseudo-tab viewers, so live-server tabs expose no system-open action. The only popout is `LiveServerViewer`'s own inline `<a target="_blank">` to the main-origin `/live/<id>/…` path; verify that link behaves acceptably in Electron/PWA/mobile and record the result (design 4b).
- [ ] 6.4 Surface the wall's exposure where it is opened: the wall URL is reachable by anyone who can reach the dashboard origin (`/live/:id/*` has no `preHandler`), and redaction is content reduction, not access control.
- [ ] 6.5 Deregister the wall's live-server target on stop so no stale row persists in `preferences.json` or the user's saved-targets picker.

## 7. Browser-mic dictation (source `browser`, v1)

- [ ] 7.1 Server: implement a tiny companion loopback `http`+`ws` server (own port) exposing `/audio-ingest`, started lazily on `dict-start` with source `browser` for `{ projectRoot, targetSessionId }`, stopped on `dict-end`/error (mirrors the wall's bind-on-start/stop-on-stop lifecycle, design decision 4b/risk).
- [ ] 7.2 Server: register that port via the SAME `startLiveServer`-backed mechanism the wall uses, so `/live/:id/audio-ingest` tunnels through the dashboard's existing `"live"` WS-upgrade scope (`handleLiveServerUpgrade`) — no new core `scope` case.
- [ ] 7.3 Server: feed incoming binary chunks from `/audio-ingest` into the vendored Soniox client (`soniox-rt.ts`), producing the same `TranscriptWriter` output the `sox`/`parec` path produces, so `dict-end` (3.3) is unaffected.
- [ ] 7.4 Client: capture-source picker on the dictation action-bar (server default, browser opt-in). Hide (not just disable) the `browser` option when `window.isSecureContext` is false.
- [ ] 7.5 Client: on `browser` source selected + `dict-start`, call `getUserMedia({audio:true})` and stream **raw PCM via an `AudioWorklet`** at the sample rate `soniox-rt.ts` already expects — NOT `MediaRecorder` (which emits Opus-in-WebM and would force a server-side demux/decode step, breaking the one-seam carve-out; design 4d).
- [ ] 7.5a Client: convert `AudioWorklet`'s Float32 samples to the signed-integer PCM format/sample-rate `soniox-rt.ts` expects, and frame to the expected size; the ingest endpoint validates the sample format rather than trusting the client (design 4d).
- [ ] 7.5b Client: obtain a live-scope WS ticket before connecting over a remote origin — the `"live"` upgrade path is ticket-gated, so an unauthenticated tunnel client would otherwise fail the upgrade with no clear reason.
- [ ] 7.6 Client: distinct UI states — permission denied, no input device, unsupported browser, insecure context (hidden per 7.4, not a failure state) — never a silent no-op.
- [ ] 7.7 Client: tear down the browser-side stream and the companion WS connection on `dict-end` or navigation away, mirroring 7.1's server-side lifecycle.

## 8. Client — knowledge browser & config editor

- [ ] 8.1 `sidebar-folder-section` claim (entry point): a per-folder row alongside `kb-plugin`'s `FolderKbSection`, reading `folder.cwd` from the injected `FolderDescriptor`, navigating to the overlay route below. Present regardless of whether a session is running in that folder.
- [ ] 8.2 `shell-overlay-route` claim at `/folder/:encodedCwd/voice-assistant-knowledge` (design 6b): decode the cwd from `params.encodedCwd` (mirror `kb-plugin`'s `decodeFolderPath`), render an explicit invalid-folder message when it does not decode, and wire the back affordance to the slot's `onBack` prop. Full-bleed page matching `KbSettingsPanel`'s structure — NOT a centered dialog.
- [ ] 8.3 Folder page body: read-only list of resolved sources and decisions (id/title/status) via the backend seam, an ACTIVE-BACKEND indicator (kb vs fallback, with a path to index the folder when on fallback), decisions grouped by `status` facet with counts on the kb path (flat list on fallback), empty state when neither backend has content.
- [ ] 8.4 `settings-section` claim: config editor reading/writing via the server REST routes from 3.9, preserving unrecognized fields on save, offering to create a default file when none exists.
- [ ] 8.5 `configSchema.json` for plugin-level settings (default STT backend hint, default target-session behavior note).

## 9. Core seam — plugin live-target bridge (design 6c)

- [ ] 9.1 Add a mutable live-target reference to `PluginContextProvider` in `packages/dashboard-plugin-runtime`, plus a plugin-facing hook that delegates through it and an availability check plugins can read before choosing embed vs fallback.
- [ ] 9.2 Populate the reference from `SplitWorkspaceProvider` in `packages/client` on mount (delegating to the existing `openLiveTarget`, NOT duplicating it) and clear it on unmount. Do NOT invert the provider nesting.
- [ ] 9.3 Unpopulated reference degrades to a logged no-op — never a throw, never a silent success.
- [ ] 9.4 Scope guard: the bridge exposes ONLY opening a live-server target; no editor-pane reducer access, no arbitrary tab kinds, no unrelated split state.
- [ ] 9.5 Wire the wall's "View live wall" action (6.2) through the new hook, with the full-page main-origin link as the fallback when the capability is unavailable.

## 10. Tests (folded from test-plan.md — manifest is the source of truth)

- [ ] 10.1 [L1] idle pair · dict-start then dict-end with non-empty transcript · exactly one sendToSession with stitched text, state back to idle (test-plan #1; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.2 [L1] idle pair · dict-end with no preceding dict-start · no sendToSession, no throw, state stays idle (test-plan #2; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.3 [L1] buffered transcript · stitch throws · fail-open, raw transcript sent instead of dropped (test-plan #3; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.4 [L1] recording, target disconnected · dict-end, sendToSession returns false · error state AND text retained for retry (test-plan #4; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.5 [L1] silence-only capture · dict-end · empty-result path, no empty prompt sent (test-plan #5; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.6 [L1] preflight flags {STT × audio tooling × knowledge} · start requested · each reachable combo yields its specified allow/block outcome (test-plan #6; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.7 [L1] neither kb-indexed nor knowledge.sources · copilot start · blocked; either alone · allowed (test-plan #7; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.8 [L1] copilot running for pair P · P's target session ends without stop · onSessionEnded tears down capture+consumer+wall+registration, map entry removed (test-plan #8; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.9 [L1] capture active · dashboard process exits · recorder child dies with it (process-group kill), no orphan on the mic (test-plan #9; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.10 [L1] copilot already running for P · second start for P · idempotent, no second recorder or consumer (test-plan #10; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.11 [L1] dictation active in project A · copilot start in project B, same host · refused, error names the holder (contention is host-wide) (test-plan #11; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.12 [L1] pending payload at cap-1 / cap / cap+1 (default 200 lines, 32 KB) · next batch merges · at/below dispatches whole, above drops oldest AND inserts truncation marker (test-plan #12; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.13 [L1] two batches produced while one in flight · in-flight completes · both merge in arrival order, dispatch once, no line lost by merging (test-plan #13; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.14 [L1] session-leg coalescing dropping oldest · same capture · wall leg still receives every line (test-plan #14; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.15 [L1] STT socket drops mid-capture · reconnect path · exactly 5 attempts, exponential backoff capped 30s, then terminal error state (test-plan #15; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.16 [L1] vendored code raises inside a batch · error surfaces · only that pair errors, other pairs and host keep running (test-plan #16; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.17 [L1] vendored emitter emits 'error' with no other listener · error emitted · construction-time listener catches it, no uncaughtException (test-plan #17; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.18 [L1] sox binary absent · recorder spawn · async ENOENT caught via child.on('error') not try/catch around spawn(); pair errors (test-plan #18; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.19 [L1] vendored callback throws synchronously in a setImmediate · callback runs · process-level backstop attributes it to the pair, host survives (test-plan #19; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.20 [L1] batch of routine chit-chat only · batch produced · no sendToSession call at all (test-plan #20; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.21 [L1] first batch vs later batch · each forwarded · first prepends rendered policy, later are transcript-only (test-plan #21; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.22 [L1] line that wall-redaction would scrub · batch forwarded · session gets it unredacted, wall copy redacted (test-plan #22; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.23 [L1] sustained batch production · loop runs · exactly one awaited consumer per active pair, no overlapping ticks, no KB query in loop body (test-plan #23; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.24 [L1] transcript line arrives · per-line matching runs · keyword-matcher only, zero KB queries, on BOTH backend paths (test-plan #24; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.25 [L1] folder {kb-indexed × admissible} · backend selection · indexed+admissible→kb, no index→fallback, admission-rejected→explicit 'kb unavailable' not empty result (test-plan #25; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.26 [L1] same fixture folder · identical queries on both backends · both satisfy one shared KnowledgeBackend contract suite (test-plan #26; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.27 [L1] decisions with status frontmatter · kb active · grouped by status with counts; fallback active · flat list, no counts (test-plan #27; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.28 [L1] config PUT with traversal/symlink/absolute path escaping folder root · write attempted · rejected, nothing written outside (test-plan #28; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.29 [L1] config+knowledge routes × {unauthenticated, folder outside allow-list} · request made · rejected before any disk read/write (test-plan #29; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.30 [L1] config with STT credential · GET then PUT with masked field unchanged · response masks secret, on-disk secret preserved, mask never written back (test-plan #30; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.31 [L1] config with fields the editor does not expose · save · unexposed fields round-trip untouched (test-plan #31; see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`)
- [ ] 10.32 [L1] SplitWorkspaceProvider unmounted/not-yet-mounted · plugin calls live-target bridge · logged no-op, no throw, availability check reports unavailable (test-plan #32; see `packages/kb-plugin/src/client/__tests__/useKbStats.test.tsx`)
- [ ] 10.33 [L1] SplitWorkspaceProvider mounts then unmounts · bridge inspected · populated on mount, cleared on unmount (test-plan #33; see `packages/kb-plugin/src/client/__tests__/useKbStats.test.tsx`)
- [ ] 10.34 [L1] encodedCwd param that does not decode · knowledge overlay renders · explicit invalid-folder message, not an empty list (test-plan #34; see `packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx`)
- [ ] 10.35 [L1] browser audio whose sample format mismatches the server-local contract · streamed to ingest · rejected with explicit error, malformed audio never reaches STT (test-plan #35; see `packages/server/src/attachments/__tests__/attachment-ingest.test.ts`)
- [ ] 10.36 [L3] dictation start→recording→stop · action-bar/badge observed · converges idle→recording→idle; error and delivery-failed visually distinct (test-plan #36; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.37 [L3] page over non-secure context · dictation controls render · browser-mic option hidden, not shown-and-failing (test-plan #37; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.38 [L3] browser-mic with {permission denied, no device, unsupported browser} · start attempted · each a distinct visible state, never a silent no-op (test-plan #38; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.39 [L3] two sessions in one folder · knowledge overlay opened from each · both reach the same folder-scoped route (test-plan #39; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.40 [L3] folder with knowledge, no running session · sidebar inspected · folder entry present, overlay lists knowledge normally (test-plan #40; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.41 [L3] live-target bridge unavailable · 'View live wall' activated · falls back to full-page main-origin /live/<id>/ URL, button never inert (test-plan #41; see `tests/e2e/bus-client-goal-plugin-action.spec.ts`)
- [ ] 10.42 [L3] copilot stopped · wall URL re-requested · no longer resolves (registration removed), exposure window bounded (test-plan #42; see `tests/e2e/bus-client-goal-plugin-action.spec.ts`)
- [ ] 10.43 [L3] copilot start · confirmation rendered · discloses system-audio capture of the other party AND persistence into session history (test-plan #43; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.44 [L3] settings section opened with no session running anywhere · rendered · folder selector present, editor fully functional (test-plan #44; see `tests/e2e/plugin-settings-pages.spec.ts`)
- [ ] 10.45 [L2] dashboard restarted with a wall/ingest target registered · restart · no stale registration accumulates in preferences.json (test-plan #45; see `qa/tests/02-server-start.sh`)
- [ ] 10.46 [L2] sox/parec absent on host · plugin preflight · reports missing dependency, blocks server-local capture, names the capture host (test-plan #46; see `qa/tests/02-server-start.sh`)
- [ ] 10.47 [L2] sustained capture with continuous batch production · soak window · no slow-tick event-loop starvation in server logs, host stays responsive (test-plan #47; see `qa/tests/02-server-start.sh`)

### Manual verification (deferred post-merge by ship-change)

- [ ] 10.48 real microphone on a real host · dictate a paragraph and stop · transcription accurate enough to be usable (test-plan #48) (test-plan: manual-only)
- [ ] 10.49 real two-party call with system audio · run meeting copilot · other party's speech captured and attributed to the right speaker (test-plan #49) (test-plan: manual-only)
- [ ] 10.50 wall rendered in the embedded iframe · observe · upstream wall.css renders legibly inside the dashboard shell (test-plan #50) (test-plan: manual-only)
- [ ] 10.51 vendored wall behind /live/<id>/ · open the wall · upstream wall.js WebSocket actually connects through the path-prefixed opaque-origin proxy (test-plan #51) (test-plan: manual-only)
- [ ] 10.52 popout link in Electron, PWA, and mobile browser · activate · main-origin /live/<id>/ link behaves acceptably in each shell (test-plan #52) (test-plan: manual-only)
## 11. Discipline checkpoints

- [ ] 11.1 Spawn `nodejs-expert` for review of the server entry (capture process lifecycle, poll-loop async control, `onEvent`/`sendToSession` usage, per-session state map cleanup, companion WS server lifecycle).
- [ ] 11.2 Spawn `react-expert` for review of the client claims (dictation/copilot action bars + badges, capture-source picker).
- [ ] 11.3 Spawn `Audit` for the config read/write route (path containment, allow-list, request auth), the vendored capture/STT-key handling (no key/secret logged or relayed to the client), the browser-mic companion WS endpoint (auth/scoping of `/live/:id/audio-ingest`, no unauthenticated audio ingestion path), AND the wall exposure boundary (`/live/:id/*` carries no `preHandler` — confirm the disclosure + teardown mitigations are actually in place).
- [ ] 11.4 Spawn `DocScribe` to add `packages/voice-assistant-plugin/AGENTS.md` (per-file tree, including the vendored subtree) and a `docs/architecture.md` mention of the new plugin, its `sendToSession`/`onEvent` usage, and the browser-mic transport's reuse of the `"live"` WS scope.
- [ ] 11.5 Invoke the `security-hardening` discipline skill before the wall/ingest/config surfaces land: untrusted input (browser-supplied audio frames), secrets (STT credential), and PII (meeting transcripts on disk and in session history) all trip its checkpoints.
- [ ] 11.6 Invoke the `performance-optimization` discipline skill on the batch/audio path: assert no plugin-owned polling timer, measure that batch handling does not block the event loop (this server has a documented starvation history), and validate the backpressure bound under a sustained-load simulation.
- [ ] 11.7 Invoke the `observability-instrumentation` discipline skill for the new REST routes, the WS ingest endpoint, spawned child processes, and the external STT socket — each needs a diagnosable runtime signal.

## 12. Build & verify

- [ ] 12.1 `npm run build && curl -X POST http://localhost:8000/api/restart` (server + client changes; no `npm run reload` needed — no bridge entry).
- [ ] 12.2 Manually verify on a project with `set-copilot.config.json` + `knowledge.sources` configured and a valid STT backend: dictation start/stop (both `server` and `browser` sources) delivers text into the target session's chat; meeting-copilot start/stop forwards batches and mirrors the target session's replies into the wall; "View live wall" embeds correctly AND its viewer's own inline "Open" link resolves to the main-origin `/live/<id>/` path (NOT `TabActions`, which is absent for pseudo-tabs); knowledge browser and config editor round-trip correctly.
- [ ] 12.3 Manually verify graceful states: missing STT config, missing audio tooling, neither-knowledge-backend-available, a target session with no bridge connection (delivery-failed / error badges, no lost dictated text), AND browser-mic states (insecure-context hidden picker, permission denied, no device).
- [ ] 12.4 Manually verify BOTH knowledge paths on the same project: with kb indexed (facet-grouped decisions, kb indicator) and with kb absent/unindexed (fallback indicator, flat decisions) — copilot alerts remain equivalent across both.
