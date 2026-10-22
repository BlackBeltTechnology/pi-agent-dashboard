# Design

## Context

See proposal.md (Why). Facts, with citations (paths under `packages/`; line numbers as of `develop` `255635084` — re-check at implementation, functions and routes are the stable anchors):

- **Shipped guard** (`core-cwd-admission`, archived 2026-10-22):
  - `admitRouteCwd(cwd, {knownCwds, admitOptions})` → shared `Admission` (`server/src/lib/route-admission.ts`).
  - `listKnownFolderCwds({sessionManager, preferencesStore})` = session cwds ∪ pinned dirs; `server/src/server.ts:1597` builds `knownFolderCwds`, which is also the plugin service `host.knownFolderCwds` (kb, mcp-client, goal plugins, folder-project routes).
  - Workspace folders are a separate list, orthogonal to pins (`server/src/persistence/preferences-store.ts:3-9`, `getWorkspaces()` `:224`). A folder only in a workspace has a home page and Pi Resources tab, and today reaches the ungated package/canvas/resources routes.
  - `sendAdmissionUnavailable(reply)` → 503 + `Retry-After: 1` + `CWD_ADMISSION_UNAVAILABLE_BODY` (`route-admission.ts:54-73`). Usable only where a `reply` is in hand.
  - `admissionAllows(admission, cwd)` / `releaseAdmission(token)` / `issueHeldAdmission(decision, rawCwd)` (`shared/src/cwd-guard.ts:187,167,200-206`). `issueHeldAdmission` refuses unless `decision.cwd === path.resolve(rawCwd)` and the canonical cwd has no `.git` segment.
  - Host logger: `admitOptions: { onIndeterminate: cwdAdmissionLogger }` (`server.ts:2686`).
  - Rules: canonical direct match (no git) → admit; else main checkout known → admit; sibling worktree / main checkout of a known worktree / child repo of a pinned non-repo → refuse; non-directory → refuse; `.git` segment → refuse; realpath failure of the cwd other than ENOENT, or an unreadable known entry with no match → `indeterminate`. Concurrency cap 4 derivations (`cwd-guard.ts:151`), deadline 3000 ms.
  - D0 probe (`changes/archive/2026-10-22-core-cwd-admission/evidence/codeql-probe.md`): route shape, helper returning `token.canonCwd`, helper returning the guarded raw value — all silent; twins reported. Not probed: a constant-segment join (`path.join(cwd, ".pi", "settings.json")`).
  - Latency (`…/evidence/latency.md`, bench `server/src/__tests__/route-admission.bench.test.ts`, opt-in `PI_BENCH=1`): direct match at 84 known folders Δp50 +0.3–0.7 ms; derivation p50 93 ms / p99 284 ms; 8 concurrent p99 481 ms.
  - Git routes hold the token across the operation (`server/src/routes/git-routes.ts:206-253`, released in the caller's `finally`).
- **File-route cwd gates** — exact session membership `sessionManager.listAll().some(s => s.cwd === cwd)` in `server/src/routes/file-routes.ts`:

  | Site | Line | Callers / routes |
  |---|---|---|
  | `resolveScopedMdPath` (sync; global scope when no cwd) | `:171-184` | `prepareMdWrite :208` (`POST /api/file/write`; body `cwd` coerced to `undefined` when not a non-empty string, `:201`), `GET /api/file/md-read :1028` |
  | `gateFilePath` (exported) | `:342-372` (check `:353`) | `/api/open-in-system`, `/api/reveal-in-file-manager` `:851`; EML `:1598,:1657`; `server.ts:3262` (`start-static`), `server.ts:3278` (per-asset proxy re-check, `quiet`) |
  | `gateReadPath` | `:383-414` (check `:395`) | `GET /api/file :666`, `GET /api/file/digest :755` |
  | `gateOfficeFile` (closure inside `registerFileRoutes`) | `:476-504` (check `:490`) | `:1370,:1395,:1501,:1543` |
  | `GET /api/file/tree` | `:884` (check `:894`) | inline |
  | `GET /api/file/md-candidates` | `:995` (check `:1000`) | inline, cwd optional; `enumerateMdCandidates({ cwd })` with the request variable |
  | `GET /api/file/exists` | `:1061` | presence check, sessions ∪ pins exact set, `unknownCwdVerdictAdmits` prompt (def `:1762`, sole caller `:1080`) |
  | `POST /api/file/resolve-mention` | `:1143` (check `:1153`) | `resolveFileMention(mention, {cwd})` anchors `[cwd, homePiAnchor()]` (`server/src/lib/resolve-file-mention.ts:52-79`) |
  | `GET /api/file/raw` | `:1182` | `isAllowed(…, {anchors:[cwd, homePiAnchor()]})` `:1209`, artifact-root, then `evaluateContainment(…, [cwd, homePiAnchor()])` `:1211` |
  | `GET /api/file/render` | `:1347` | inline (containment `:1427`) |

- **Failure plumbing:** `GateFailure = {code (HTTP status), error} & Partial<DenialRemedy>`; `denialBody` (`file-routes.ts:82`) emits `success, error, reason, hint, subject, denialId, ancestors, promptOutcome` only. `MdWritePrep` failures are `{code, error}`.
- **Other cwd gates:**
  - `server/src/routes/grep-routes.ts:51` (`GET /api/grep`), then `runGrep(cwd, …)` and per-match `isAllowed(…, {anchors:[cwd]})` `:67-68`.
  - `server/src/routes/file-write-binary-routes.ts:380` inside sync `resolveHandler` `:362-383` (editor-pane save). `registerFileWriteBinaryRoute` is called from `registerFileRoutes` (`file-routes.ts:463`). Its `Outcome = {code, body}` reply path sets only the status (`file-write-binary-routes.ts:124-131,286-297`).
  - `server/src/routes/openspec-group-routes.ts:46-66` `rejectInvalidCwd` (sync, exact sessions ∪ pins, 403 `"cwd not allowed"` + reason/hint); 6 routes `:101-249`.
  - `watch_files` browser-WS handler (`server.ts:1441-1450`): its only sender is `client/src/App.tsx:3160-3167` with the selected session's id and cwd (always a session cwd); the folder pane (`FolderSplitProvider.tsx:48-62`) sends none, and the server drops a message without `sessionId` (`:1442`). Sync, exact session membership, then `fileWatchManager.setWatched(ws, sessionId, cwd, paths)`. The manager keeps watches lexically inside `cwd` (`server/src/file-watch-manager.ts:32,245-246`) — the same lexical rule as read layer ①. `setWatched` creates the per-connection map on demand (`:223-229`); `clearConnection` runs once on disconnect (`server.ts:1451`). No reply on refusal.
  - The groups store writes `<cwd>/openspec/groups/groups.json` (`server/src/openspec/openspec-group-store.ts:149-153`); `core-cwd-admission` refuses a cwd whose canonical `openspec/` is `GLOBAL_OPENSPEC_DIR` on the openspec sites it widened.
- **Ungated cwd routes:**
  - `server/src/routes/package-routes.ts`: `installed :95-101`, `install :122-136`, `remove :152-166`, `update :182-192`, `move :213-238` (`fromCwd`, `toCwd`), `reset-to-npm :271-299`, `check-updates :321-326`. `cwd` is destructured from the body with no type check. `server/src/package/package-manager-wrapper.ts:474,518` use `cwd ?? process.cwd()` (an empty string is passed through); `move` uses `toCwd ?? fromCwd ?? process.cwd()` (`:675`). `move` validation answers `400 invalid_request` for a local scope whose cwd is missing or not a string (spec `package-management` :121-137). Protected by the universal network-guard `onRequest` hook (`server/src/auth/localhost-guard.ts` `createNetworkGuardHook`), no per-route `preHandler`.
  - `server/src/routes/canvas-types-routes.ts:46-53` GET → `readCanvasTypesScopes(cwd)` (reads `<cwd>/.pi/settings.json` when non-empty, `server/src/canvas/canvas-settings.ts:59-66`); `:55-70` PATCH → `validatePatch` (400, `:30-37`) → `writeCanvasTypesScope` (`canvas-settings.ts:90-98`). GET coerces a non-string `cwd` to `""` (`:50`).
  - `server/src/routes/addons-routes.ts:52-60` already admits with `admitCwd(cwd, deps.knownCwds ?? deps.knownDirectories)`; `server.ts:3454-3463` passes only `knownDirectories` (`directoryService.knownDirectories()` = pins ∪ non-ended sessions, `server/src/directory-service.ts:968-978`). `/api/addons/:featureId/toggle` writes `<cwd>/.pi/settings.json` and registers trust challenges like the resources toggle.
  - Other `host.knownFolderCwds` consumers: the MCP global-write collision scan reads every trusted known folder's `.pi/mcp.json` (`mcp-core/src/config-writer.ts:250`); goal-plugin cwd validation (`goal-plugin/src/server/routes.ts:86`).
  - `server/src/routes/resource-activation-routes.ts:122-178` `POST /api/resources/toggle`: `settingsPathForScope(scope, body.cwd)` → `applyResourceToggle` writes `<cwd>/.pi/settings.json`; `registerTrustChallenge(body.cwd)` `:154`. `POST /api/resources/trust` `:181-217` acts only on a cwd with a registered challenge; challenges are registered by the resources toggle (`trustRequired` only for project scope, `server/src/pi/resource-activation-toggle.ts:250-258`) and the addons folder toggle. `POST /api/resources/reload` `:223-245` uses `cwd` only to match sessions (no disk).
- **Containment** (`server/src/lib/path-containment.ts:149-166`): layer ① lexical `within(resolved, anchor)`, layer ② real-path'd checkout roots per anchor; grant layer in `server/src/access/containment-gate.ts:202`. Sites pass the raw request `cwd` (`file-routes.ts:357,401,494,900,1111,1209,1211,1427`; `grep-routes.ts:68`; `resolve-file-mention.ts:79`). `isWritableMdTarget` realpaths `cwd` itself (`server/src/lib/writable-md-target.ts`).
- **Live preview:** `start-static` failure `{ok:false, status, body}` has no header channel (`server/src/routes/live-server-routes.ts:46,232-235`); the proxy maps a `false` gate to a refused asset (`server/src/live-server/live-static.ts:154`). Spec `live-server-preview` "Static serving overhead is bounded": per-request re-check ≤ 10 ms p95.
- **Client coupling:**
  - `client/src/components/preview/FilePreviewOverlay.tsx:91` matches `"unknown session path"`.
  - Digest verification (`client/src/lib/file-digest.ts:37`, `client/src/components/split/use-change-verification.ts:137-150`) shows the changed-on-disk banner when a digest is refused or fails — required by spec `internal-monaco-editor-pane` (`:327`).
  - `client/src/components/editor-pane/file-handler/file-handler-host.ts:152-154` maps any save 503 to `"busy"`.
  - `client/src/lib/canvas/canvas-types-api.ts:41` throws `failed (<status>)`; package UIs show `body.error`.
  - i18n `err.cwd_unknown` / `err.cwd_admission_unavailable` exist (`client/src/lib/i18n-en-source.json:932-933`).
- **CodeQL** (`codeql-baseline.json`, `js/path-injection`): `file-routes.ts` 19 (14 `operator-authz`, 5 dismissed #334–#338); `lib/grep.ts` 3, `lib/md-candidates.ts` 1, `lib/office-preview.ts` 1, `lib/writable-md-target.ts` 1, `lib/resolve-file-mention.ts` 1, `lib/writable-handler-target.ts` 2 (dismissed #463/#464), `canvas/canvas-settings.ts` 4. Dismissal #463 cites the `file-write-binary-routes.ts` `listAll` check. A truthiness check is not a CodeQL barrier, so a no-cwd branch that forwards the request variable stays reported. `browse.ts` 6 = cwd-less folder browser.

## Goals / Non-Goals

**Goals**
- Every caller-cwd site listed in Context admits a supplied `cwd` with the shared guard: one rule across plugin, git, openspec (incl. groups), file, package, canvas-types, resource-toggle and file-watch.
- The known-folder set includes workspace folders (operator 2026-10-22), so nothing a workspace-only folder reaches today regresses.
- Close what admission can close in CodeQL; book the rest for `codeql-file-containment-barrier`.

**Non-Goals**
- A modelled containment predicate for `path`-fed sinks (follow-up `codeql-file-containment-barrier`).
- Server-chosen fallbacks when no `cwd` is sent (package wrapper `process.cwd()`; global scope of md routes, canvas-types and resources).
- `/api/browse*` (no cwd), `session-routes.ts` (server-owned session dir), `/api/diagram/render` (no cwd), `/api/resources/reload` (no disk).
- Aligning the static-preview gate's anchors (the admitted cwd, both spellings via `gateFilePath`) with `/api/file/raw` (`~/.pi` + artifact roots): a pre-existing difference, unchanged.
- Client wiring of `watch_files` for folder panes.
- Changing `admitCwd` semantics. `route-admission.ts` changes only in `listKnownFolderCwds` (D8).
- The exact-membership `knownInitTargets()` of the gated openspec write sites (`init`, `workflow-schema`, dependencies) — unchanged, so workspace folders do not widen them.
- Re-checking revocation between admission and the operation (same as git routes).

## Decisions

### D1 — Route-boundary admission
```ts
// shape: cwd absent → existing behaviour; present but not an absolute string → refusal (D4)
const admission = await admitRouteCwd(cwd, routeAdmission)
if (admission.kind === "indeterminate") → 503 (D3)
if (!admissionAllows(admission, cwd)) → refusal (D4)
try { …operation on cwd… } finally { releaseAdmission(admission.token) }
```
- `cwd` passed to `admissionAllows` is the unmodified request value (`tokenAllows` compares exactly).
- **Order.** Each route's existing 400 validation runs first (`move` `invalid_request`, canvas `validatePatch`, exists/groups presence), unchanged. The shape check and admission apply to values that pass it.
- **Absent vs present.** The shape check reads the **raw** request value, before any coercion (`prepareMdWrite :201`, canvas GET `:50`). `undefined` and `""` count as absent on routes with a no-cwd behaviour (md routes, canvas-types, package routes, resources toggle) and keep today's behaviour. Any other value that is not an absolute string (relative, array, object, number) is refused; it never selects a global scope.
- **No-cwd branch passes a constant.** The absent branch hands the sink a server constant (`enumerateMdCandidates({})`, `readCanvasTypesScopes("")`, `cwd: undefined`), never the request variable, so every sink is reached only from the guarded branch or a constant.
- **Wiring.** `registerFileRoutes`, `registerGrepRoutes`, `registerPackageRoutes`, `registerCanvasTypesRoutes`, the resource-activation registrar and the openspec-group registrar take `routeAdmission: RouteAdmissionDeps` (`knownCwds` = `server.ts` `knownFolderCwds`, `admitOptions` = host logger). `registerFileRoutes` forwards it to `registerFileWriteBinaryRoute` and to its `gateOfficeFile` closure. Default stays fail-closed (nothing known).
- **Helpers.** `gateFilePath`, `gateReadPath`, `gateOfficeFile`, `resolveScopedMdPath`, `resolveHandler` and `rejectInvalidCwd` admit, branch on `admissionAllows`, release in their own `finally`, and return the guarded raw `cwd` plus `canonCwd` in their success shape (probe shape (c')). The exported `gateFilePath` swaps its `sessionManager` parameter for `routeAdmission`; `server.ts:3262,3278` pass the host deps. `resolveScopedMdPath`, `resolveHandler` (phase 2 of the editor-pane save) and `rejectInvalidCwd` become async.
- **Token lifetime.** A helper's token proves only its own guard; releasing it before the caller's disk access is safe because a live token does not re-check membership. Inline routes release in their `finally`.
- **Package `move` / `reset-to-npm`.** Their scope/cwd validation runs today inside `packageManagerWrapper.move()`/`reset()` (`package-manager-wrapper.ts:368-381,421`). The routes gain the same checks up front (local scope needs a string cwd → `400 invalid_request`, as the `package-management` spec requires), before admission. `move` then admits `fromCwd` and `toCwd` independently; both release in one `finally`. Either side refused → 403; else either side indeterminate → 503.
- **Resources.** `toggle` admits a present `cwd` for both scopes before computing the settings path, so every trust challenge it registers is for an admitted cwd. `trust` acts only on a challenged cwd (resources toggle or addons folder toggle, both admitted); no extra gate. `reload` is unchanged.
- **Addons.** `registerAddonsRoutes` receives `knownCwds: knownFolderCwds` (the route already prefers it), so the addons folder view follows D8; its 400/403/503 bodies are unchanged.
- **Openspec groups.** `rejectInvalidCwd` admits instead of the exact set and also refuses a cwd whose canonical `openspec/` is the global openspec dir, by reusing `isGlobalOpenSpecParent` (`openspec-routes.ts:165`, exported from its module and shared — not reimplemented). Its 403 body is unchanged plus `code: "cwd_unknown"`.
- **`watch_files`.** Server-side consistency only: no client sends a non-session cwd today, so the observable effect is unchanged; the guard replaces the ad-hoc check. The handler admits `msg.cwd`; refusal and indeterminate are a silent no-op, as today. A per-`(ws, sessionId)` sequence number is taken before the await; after it, the result is dropped when the socket has disconnected or a newer message for that pair arrived, so a late admission never re-creates a cleared connection or applies stale paths. Release after `setWatched`. The watch manager keeps its lexical containment under the request `cwd` (watch ⊆ read layer ①).

### D2 — Containment anchors: request spelling plus canonical cwd
- Relative paths resolve against the request spelling: `path.resolve(cwd, relPath)`. Clients send absolute paths in the session's spelling; resolving against `canonCwd` alone would refuse those in non-git directories.
- Each admitted site's cwd anchor becomes `[cwd, canonCwd (when it differs)]`, followed by the site's own anchors. This applies to `gateFilePath`, `gateReadPath`, `gateOfficeFile`, tree, exists, both raw anchor lists (`:1209` and `:1211`), render, grep's match filter, and `resolveFileMention` (gains an optional `canonCwd`, so resolve and open keep the same anchor set). Layer ② roots are the same for both spellings; nothing outside the admitted directory is added. The pinned-directory anchor stays exists-only.
- `isWritableMdTarget` and `enumerateMdCandidates` keep receiving the request `cwd`; `isWritableMdTarget` realpaths it itself.
- `session:` labels passed to `evaluateContainment` stay the raw `cwd`. `session-routes.ts` is unchanged.
- Regressions (symlinked cwd `/tmp/link → /real`, non-git): relative path, absolute link spelling, absolute real spelling, `../` escape — on read, raw, tree, exists, grep, mention and md write.

### D3 — Indeterminate → shared 503
- Inline routes: `sendAdmissionUnavailable(reply)`.
- Helpers return a `GateFailure` with status 503 and `wire: { code, message, retryAfterMs }` taken from `CWD_ADMISSION_UNAVAILABLE_BODY`. `denialBody` emits `wire` fields when present. One new reply helper, `sendGateFailure(reply, gate)` in `file-routes.ts`, sets the status, sets `Retry-After: 1` on a 503, and returns `denialBody(gate)`. Every caller of the helpers switches to it (`/api/file`, digest, open-in-system/reveal, EML, office routes, md-read, write).
- `start-static`: the `StaticStartGate` failure gains an optional `headers` map; `live-server-routes.ts` applies it, so the 503 carries `Retry-After`.
- Per-asset proxy re-check (`quiet`, boolean): indeterminate → `false` (existing refused-asset path). No prompt, no denial record.
- `watch_files`: no-op.
- Editor-pane save: `Outcome` gains an optional `headers` map applied in its `send`; the admission 503 carries `Retry-After: 1` and the shared body; nothing written. Validator-busy 503s are unchanged. The client's 503 → `"busy"` mapping stays (accepted: both mean "retry").
- Digest: a 503 shows the changed-on-disk banner, as the spec requires for a refused or failed digest (fail-safe). No client change.
- `FilePreviewOverlay.friendlyReadError` maps `cwd-admission-unavailable` to the `err.cwd_admission_unavailable` text. Editor-tab load, tree and grep surfaces show the raw identifier — accepted. No automatic retry anywhere.

### D4 — Refusal bodies
- **File-family routes:** status and `error` string unchanged (`403 "unknown session path"`; exists `403 "unknown cwd"` with its remedy fields; editor-pane save `403 "unknown session path"`), plus additive `code: "cwd_unknown"` via the same `wire` field as D3, threaded through `MdWritePrep` for md write/read.
- **Openspec groups:** unchanged `403 "cwd not allowed"` body plus `code: "cwd_unknown"`.
- **Package, canvas-types and resources-toggle routes:** `403 { success: false, code: "cwd_unknown", error: "cwd not allowed", reason: "cwd is not a known session or pinned directory.", hint: "Pin this directory to allow it, or open a session rooted in it." }`. No package manager is created; no settings file is read or written; no trust challenge is registered.
- The client surfaces that show raw text (package UIs: `body.error`; canvas-types: `failed (403)`) are accepted as is.

### D5 — `/api/file/exists` prompt
1. Presence check (unchanged, 400). Then `!isAbsolute(cwd)` → the `"unknown cwd"` 403 + `code`, never held or prompted.
2. `admission = await admitRouteCwd(cwd, routeAdmission)`; `indeterminate` → 503, no prompt.
3. `refuse` → existing hold (`holdDenial`, plane `cwd`, subject = real path) → `resolveCwdVerdict(cwd, resolution, { known, rerunAlways: c => admitRouteCwd(c, routeAdmission).then(a => { if (a.kind === "admit") releaseAdmission(a.token); return a.kind; }) })`. `rerunAlways` makes an allow-always answer admit a cwd the pin just made known by derivation, as plugin holds do (`server/src/access/cwd-verdict.ts:139-142`).
4. Decision `admit` → `admission = issueHeldAdmission(decision, cwd)` (refuses a decision for another spelling); `indeterminate` → 503; else refuse.
5. `if (!admissionAllows(admission, cwd))` → the unchanged `"unknown cwd"` 403 body + `code`.
6. Anchors `[cwd, canonCwd?, …pinned]` (D2).
- `unknownCwdVerdictAdmits` becomes `unknownCwdVerdict(…): Promise<CwdHoldDecision>`; the `cwd-verdict.ts` doc note "absent for the core site" is updated.

### D6 — Latency
Extend `route-admission.bench.test.ts` (opt-in, `PI_BENCH=1`) with known = max(100, live `listKnownFolderCwds()` incl. workspace folders):
- **Gate:** `GET /api/file` direct match: Δp50 ≤ +2 ms, Δp99 ≤ +15 ms vs 1 known folder.
- **Gate:** `GET /api/file` on a sessionless worktree of a pinned repo: 0 `indeterminate` over 200.
- **Gate:** per-asset re-check on a direct-match static target: ≤ 10 ms p95 (the `live-server-preview` bound).
- **Gate:** while a 50-asset derived-worktree preview loads (6 concurrent fetches), 20 concurrent `GET /api/git/status`, each on a **distinct** sessionless worktree of a different pinned repo (distinct cwds defeat the in-flight dedupe, `cwd-guard.ts:252-254`, so they contend for derivation slots), with the preview's assets fetched sequentially per asset see 0 `indeterminate` and p99 ≤ 3000 ms.
- **Recorded:** per-asset re-check p50/p95 on a derived worktree target; 16 concurrent `GET /api/file/raw` on a direct-match cwd.
- **Always-on (CI) assertion:** a vitest that `GET /api/file` on a direct-match cwd spawns no git (injected runner counts 0 calls).
- On a miss: `performance-optimization` before any cache; a cache stays request-scoped.

### D7 — CodeQL evidence and follow-up
- `evidence/codeql.md`: per-file `js/path-injection` before/after from a local real analysis; residue list (path-fed sinks) handed to `codeql-file-containment-barrier`.
- Residue includes `lib/eml.ts` (1, path-fed EML sink).
- Candidates to close (verified only by the analysis, not assumed): `lib/grep.ts`, `lib/md-candidates.ts`, the cwd leg of `resolve-file-mention.ts`. `canvas/canvas-settings.ts` joins a constant segment, which D0 never probed — residue if still reported.
- Refresh baseline justification text that names the removed `listAll` check (dismissal #463).
- `openspec/changes/codeql-file-containment-barrier/` stub and the `triage-codeql-alert-debt` blocker + D5 precondition were added in this planning commit; implementation only verifies they are present.

### D8 — Workspace folders join the known set (operator 2026-10-22)
- `listKnownFolderCwds` adds every folder of every workspace (`preferencesStore.getWorkspaces()`), de-duplicated with sessions and pins. `KnownFolderSources.preferencesStore` gains `getWorkspaces`.
- Effect is global: plugin routes (`host.knownFolderCwds`: kb, mcp-client, goal, folder-project), git, openspec (ungated sites, groups), file, package, canvas-types, resources, addons (via `knownCwds`) and watch all admit workspace folders and, by derivation, their worktrees and subdirectories. The MCP global-write collision scan also reads trusted workspace folders' `.pi/mcp.json`.
- Doc comments naming "sessions ∪ pins" are updated: `route-admission.ts`, `access/cwd-verdict.ts`. The existing refusal `reason` string ("cwd is not a known session or pinned directory.") is kept verbatim for wire compatibility.
- Unchanged: `knownInitTargets()` (gated openspec writes), the exists pinned-directory anchor, `computeKnownDirectories()` (openspec poll set), and the allow-always remedy (it still pins).
- mcp-client "not tracked" pill: a workspace folder becomes tracked; the client's retry trigger (session or pinned list change) does not watch workspace changes — accepted, a reload refreshes it.

## Risks / Trade-offs

- **[Workspace folders widen every admitted route]** (D8). → Operator-accepted; workspace membership is an operator action of the same trust as a pin.
- **[Widening reads/writes]** md writes, editor-pane saves, canvas-types and resources writes, openspec group edits and local package installs now work in pinned folders and known-repo worktrees. → Operator-accepted (2026-10-20, 2026-10-22). Containment, grants and write-target checks stay authoritative. Unlike the gated openspec write sites of `core-cwd-admission` (exact membership), openspec groups widen (operator 2026-10-22).
- **[Tightening]** a cwd known only through a sibling worktree is refused, as on git routes. Live session cwds are direct matches, except a session cwd whose realpath fails other than ENOENT (503) or that has a `.git` segment (refused); today's string match admitted both.
- **[Per-asset admission cost]** a derived worktree preview pays git derivation per asset on the 4-slot semaphore. → D6 gates direct-match cost and cross-route starvation; the spec delta bounds derived re-checks by the admission deadline. Operator chose full per-asset admission over a cache.
- **[Transient 503 on a digest]** shows the changed-on-disk banner (spec: refused or failed → banner). → Accepted fail-safe.
- **[Unreadable known folder ⇒ 503 storm]** now also on previews and watches. → Same accepted trade-off as `core-cwd-admission`.
- **[Residual oracle]** timing reveals existence of unknown paths. → Accepted; network-guarded callers.
- **[Watch through an in-folder symlink]** a lexical in-folder symlink to an outside file is watched (change signal only, no content). Reads already allow it at layer ①. → Accepted, unchanged rule.
- **[Package routes reachable remotely]** they rely on the universal network-guard hook, like the other routes; admission narrows them further.
- **[CodeQL]** most `file-routes.ts` alerts stay until the follow-up. → Evidence + follow-up.

## Migration Plan

- No data migration. Server restart (jiti) + client build (`friendlyReadError`).
- Rollback: revert; no persisted state changes.
