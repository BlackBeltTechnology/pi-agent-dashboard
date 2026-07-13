## Context

After `embed-managed-node-runtime` lands, every machine that runs the dashboard via Electron has a persistent Node copy at `~/.pi-dashboard/node/`. That solves the "spawn finds npm" problem, but freezes the runtime at whatever version was bundled at first install. Node and npm both ship security fixes and bug fixes regularly; an indefinitely-old managed Node will accumulate CVEs and start producing weird npm errors against newer registry tarballs (engine ranges, peerDep tightening, ABI mismatches in native modules pulled by pi extensions).

There are three distinct sources of `node` on a given machine, and they need different update routes:

- **`managed`** — `~/.pi-dashboard/node/`. We own this directory, can replace it, and (on Windows) need to handle the locked-`node.exe` problem.
- **`system`** — `node` on `PATH` outside any directory we control. The user installed it (Homebrew, MSI, package manager, nvm). We must not touch it; we can only nudge the user.
- **`bundled-electron`** — `<app>/resources/node/`. Owned by the Electron installer, replaced atomically when the user updates the app. We must not touch it; pointing the user at it would just get clobbered next upgrade.

The existing `pi-core-checker.ts` already classifies pi packages by `installSource: "global" | "managed"` and the existing UI already renders source-aware badges. The Node-runtime story slots into the same shape with a third source value.

The hardest single decision is the Windows update mechanic: `node.exe` is locked while any process is running it (the dashboard server itself, every active pi session). We cannot do an in-place replace. Two clean options exist — quiesce-and-swap or stage-and-swap-on-restart — and the choice cascades into the entire UX.

## Goals / Non-Goals

**Goals:**

- Surface the Node runtime in the existing Pi Ecosystem UI as a first-class row alongside `pi (core agent)`.
- Classify the runtime by source and route updates accordingly: actually-update for `managed`, refuse-with-guidance for `system` and `bundled-electron`.
- Probe nodejs.org for the latest LTS in the current major; cache aggressively (24 h) to avoid hammering their CDN.
- Stage downloads so the running dashboard never has its `node.exe` ripped out from under it. Apply on next start.
- Keep the major-version line stable by default; require explicit confirmation to cross majors.
- Reuse the existing `pi_core_update_progress` event channel and `runExclusive` busy-lock — no new WS event class, no second concurrency model.

**Non-Goals:**

- Updating system Node — we never touch user-installed Node.
- Updating bundled-electron Node — handled by the Electron app updater itself.
- Updating npm independently of Node — npm ships in the same Node tarball; one update covers both.
- Switching distributions (Bun, Deno, alternative Node builds).
- Auto-updating without explicit user click. Notification yes; auto-apply no.
- Honoring an enterprise npm registry / proxy configuration for the Node download (we hit nodejs.org directly).
- Background download. Download is interactive, gated by the Update button click.

## Decisions

### Decision 1: Stage-and-swap-on-restart, not quiesce-and-swap-immediately

When the user clicks **Update** on the managed Node row, download into `<managedDir>/node-pending/`, write a `<managedDir>/.node-swap-pending` marker file, surface a "Restart to apply" UI state. On next dashboard / Electron start, before any HTTP server starts, run the swap helper: rename `node` → `node-old`, `node-pending` → `node`, delete marker, schedule `node-old` removal on the next-next start.

**Why:** The alternative — broadcast `server_restarting` to every bridge, wait for sessions to release `node.exe`, swap, restart — is fragile. A pi session in the middle of a long-running tool call (architect agent, large bash output streaming) holds `node.exe` for minutes, and force-killing it loses user work. Stage-and-swap mirrors how the Electron auto-updater itself works on Windows; users already understand "update queued, takes effect on restart." Same UX as `npm update` for system packages.

**Alternatives considered:**

- *Immediate in-place replace on Windows* — rejected: file is locked, `EBUSY` is guaranteed.
- *Quiesce-broadcast-then-swap* — rejected per above; works but punishes long-running sessions.
- *Spawn a tiny "swap process" detached from the dashboard, ask the dashboard to exit, swap, restart* — adds one more moving piece for marginal latency improvement; staging-on-restart wins on simplicity.

### Decision 2: `classifyNodeSource(nodePath)` is a pure helper, not a method on the checker

Pure function in `packages/shared/src/platform/classify-node-source.ts`. Takes a node binary path, returns `"managed" | "system" | "bundled-electron"`. Compares `realpathSync(nodePath)` against `~/.pi-dashboard/node/` and against `process.resourcesPath/node/` (when `resourcesPath` is defined).

**Why:** Pure helpers live in `packages/shared/src/platform/` (the convention established by `process.ts`, `node-spawn.ts`, etc.). Keeps the checker side-effect-free at the classification layer. Trivially table-testable.

### Decision 3: Node runtime appears as a synthetic row in `pi-core-checker.getStatus()`

Inject a single synthetic `PiCorePackage`-shaped entry with `name: "node"`, `displayName: "node (runtime)"`, `installSource: "managed" | "global" | "bundled"` (mapped from `classifyNodeSource`), and `currentVersion` / `latestVersion` populated from `node-runtime-checker.ts`.

**Why:** The existing `UnifiedPackagesSection` UI (replaced the former `PiCoreVersionsSection` under change: consolidate-packages-settings-ui) already handles the row shape, the badge, the Update button, the loading/error states. Adding a synthetic row is a 5-line change in `pi-core-checker.ts` plus one source-mapping helper. Avoids inventing a parallel UI surface for one row. Source-string mapping (`managed → managed`, `system → global`, `bundled-electron → bundled`) keeps the badge taxonomy stable: the existing `local`/`global` pills get a new third value `bundled`.

**Alternatives considered:**

- *Separate "Runtime" section in Settings* — more code, identical UX.
- *Separate WS event class for runtime updates* — duplicates `pi_core_update_progress` infrastructure; reuse wins.

### Decision 4: nodejs.org/dist/index.json, 24-hour cache

`node-runtime-checker.ts` fetches `https://nodejs.org/dist/index.json` once per 24 h, filters `lts !== false`, sorts by version, picks the newest entry whose major matches the currently-installed major. Cache lives in memory; persists across restart via the existing `pi-core-checker` cache file pattern (or a sibling `~/.pi/dashboard/node-runtime-cache.json`).

**Why:** nodejs.org returns the full release index in a single ~50 KB JSON file. One request gives us latest-per-major across every supported line. 24 h cache matches the cadence of upstream LTS patch releases (typically every 2–4 weeks). No npm registry involvement → no proxy/auth headaches.

**Alternatives considered:**

- *Per-major endpoint* — does not exist; nodejs.org only ships the index file.
- *GitHub Releases API* — rate-limited without auth; index.json has no rate limit.
- *npm registry for `node` package* — no such thing on the registry; rejected.

### Decision 5: Major-version policy: stay-in-major by default, opt-in to cross-major

`getStatus()` reports the latest LTS in the **current** major. The Update button updates within-major. Cross-major (e.g. v22 → v24) requires the client to send `{ allowMajor: true }` on the POST and is gated by a confirmation dialog explaining the risks (native-module ABI breaks, pi-extension peerDep changes).

**Why:** Within-major updates are nearly always safe (security and bug fixes only). Cross-major updates can break native modules silently — pi extensions that pull `node-pty`, `better-sqlite3`, etc., can fail to load until rebuilt. Defaulting to within-major eliminates the "I clicked Update and now nothing works" surprise. Cross-major stays available for users who know what they're doing.

### Decision 6: Reuse `pi_core_update_progress` events keyed by `name: "node"`

Progress and completion events use the existing `pi_core_update_progress` / `pi_core_update_complete` channels. The `name` field carries `"node"` instead of an npm package name. Phases gain two new values specific to runtime updates: `"download"` and `"staged"`.

**Why:** Avoids inventing a parallel WS protocol for one row. The client already routes these events to `UnifiedPackagesSection` via the `pi-core-event` DOM event; (the section replaced the former `PiCoreVersionsSection` under change: consolidate-packages-settings-ui) adding two phase strings is a one-line client change. Tests in `pi-core-updater.test.ts` already cover the channel; runtime-updater tests reuse the same harness.

### Decision 7: New REST route, but mirror the existing one

`POST /api/pi-core/update-node` instead of overloading `POST /api/pi-core/update` with a runtime case. Body: `{ allowMajor?: boolean }`. Response: `202 Accepted` with `{ ticketId }` (matching the bootstrap-routes ticket pattern), or `409 Conflict` if `runExclusive` is busy, or `400 Bad Request` if the source is `system` or `bundled-electron`.

**Why:** Two separate routes keep the contract for each cleanly typed and documented. The existing `update` route's body is `{ packages?: string[] }` — adding a runtime case would require a polymorphic body shape. The new route shares `runExclusive` with `update` so concurrency is still the same single-lock.

### Decision 8: `node-old/` cleanup is lazy

After a successful swap on start, the previous `node-old/` is left on disk. On the next-next start (one full cycle later), the swap helper checks for `node-old/` and deletes it.

**Why:** Conservative — if the new Node turns out to be broken (corrupt download, bad version), the user can manually rename `node-old` back to `node` and recover without re-downloading. One full successful start cycle gives confidence the new Node works before we burn the bridges. Disk cost is bounded at one extra ~80 MB copy for one start cycle.

## Risks / Trade-offs

- **Stage-and-swap requires restart** → User-visible. Mitigated by clear "Restart to apply" UI state and a one-click "Restart now" button that goes through the existing `/api/restart` orchestrator.
- **Cross-major updates can break native modules** → Mitigated by the major-version-policy gate (Decision 5) and the confirmation dialog. We can't auto-detect or auto-rebuild native modules without far more infrastructure.
- **Download from nodejs.org requires direct internet** → Documented; users behind enterprise proxies that block nodejs.org cannot use this. Workaround: manually drop a Node tarball into `<managedDir>/node-pending/` and let the swap helper apply it. Out of scope for v1.
- **`node-old/` leak if start crashes between swap and next-next-start** → Mitigated by Doctor checking for stale `node-old/` and deleting it. Bounded leak (one extra Node tree per leak event).
- **24h cache might mask a critical security release** → Acceptable; users can force-refresh via the existing "Check Now" button (passes `?refresh=true`).
- **System / bundled-electron rows are read-only** → Slightly confusing UX. Mitigated by tooltip text on the disabled Update button explaining why and what to do (`"Update via your OS package manager"` or `"Update via the Electron app updater"`).
- **classifyNodeSource depends on `realpathSync`** → On filesystems that don't preserve symlinks (some Windows network drives), classification may misfire. Mitigated by treating any unknown source as `"system"` (the safe-don't-touch default).
- **No automatic rollback** → If the swap succeeds but the new Node is broken at runtime, the user has to manually rename `node-old` back. Documented in the Doctor output. Acceptable for v1.

## Migration Plan

1. **Predecessor lands first.** `embed-managed-node-runtime` must be in production before this change; otherwise the `managed` source classification has nothing to classify and `node-pending/` has no `node/` to swap with.
2. **Pure helpers second.** `classifyNodeSource`, `node-runtime-checker.ts`, the staging helper, and the swap helper land with their unit tests. No production code calls them yet.
3. **Backend wire-up third.** Synthetic row in `pi-core-checker.getStatus()`; new REST route in `pi-core-routes.ts`; updater module wired through `runExclusive`. Server now reports the runtime row but the UI doesn't render it differently yet.
4. **Frontend wire-up fourth.** `UnifiedPackagesSection` (replaced former `PiCoreVersionsSection` under change: consolidate-packages-settings-ui) learns the third source badge value, the disabled-button states, the cross-major confirmation dialog, the "Restart to apply" state, and the "Restart now" button. `PiUpdateBadge` updates its count.
5. **Swap-on-start fifth.** Hook the swap helper into Electron startup (`packages/electron/src/main.ts`) and the standalone CLI (`packages/server/src/cli.ts`) before the HTTP server starts.
6. **Doctor sixth.** Doctor checks for stale `node-old/` and surfaces the runtime row's source/version/swap-pending state.
7. **Rollback strategy.** If the swap mechanic regresses, ship a hotfix that disables the Update button on the runtime row (server-side feature flag in `pi-core-checker.ts`). Pure helpers and download flow stay inert. Already-staged `node-pending/` directories on disk become harmless until the helper re-enables.

## Open Questions

- **Should we honor `npm config get registry` / `https-proxy` for the nodejs.org download?** Probably yes for enterprise users, but it introduces a second config surface. Leaning no for v1; revisit if user reports come in. If we do add it, it lives behind a `nodeRuntimeProxy` field in `~/.pi/dashboard/config.json`, not derived from npm config.
- **Should the swap helper verify the downloaded Node before swapping?** Minimal verification (run `<pending>/node --version` and parse the output) is cheap and catches catastrophic corruption. Adding it.
- **Should we offer "downgrade" if the user picks an older LTS line via cross-major?** Out of scope for v1. Update flow is forward-only; downgrade requires manual intervention (delete `node/`, reinstall predecessor change's bootstrap step).
- **Does the staging download integrity-check via the SHA-256 published alongside each Node release on nodejs.org/dist/?** Yes — nodejs.org publishes `SHASUMS256.txt` next to every release. Verify before swap. Otherwise a corrupted download bricks the runtime on restart with no recovery short of `node-old`. Strongly recommended; folded into the `node-runtime-update` spec scenarios.
