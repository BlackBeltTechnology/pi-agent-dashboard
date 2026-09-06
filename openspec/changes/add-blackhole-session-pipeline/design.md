# Design — add-blackhole-session-pipeline

## Context

See `proposal.md` — Why, and the five-mechanism failure table. The facts that shape this design:

- `add-blackhole-plugin` has landed (`packages/blackhole-plugin/`): config IO with fail-closed parse (`config-io.ts`), env-derived path resolution (`config-path.ts`), injected-Fastify route tests, and a client REST layer (`blackhole-api.ts`) whose `isExtensionInstalled()` already reads `GET /api/plugins` → `status.missingRequirements`.
- The server answers "is pi extension X installed" authoritatively today via `packageManagerWrapper.listInstalled(...)` feeding `requirement-probes.ts` (`sourcesMatch` matching, 30 s cache) — but that answer is not in the plugin-facing server surface (`ServerPluginContext`).
- `useSlotHasClaimsForSession` calls `shouldRender` synchronously during render and subscribes to nothing, so a gate signal that resolves after first render never re-renders the wrapper for sessions that stop broadcasting (the `fix-empty-flows-subcard` scar).
- Per-session capability data reaches the browser only for the subscribed session; the spec has already accepted the **global** gate trade-off.

## Goals / Non-Goals

**Goals:**

- A sound, reviewable gate mechanism (attempt #6) that fixes the four named defects of mechanism 5: authoritative installed source, vitest guard, retry, re-render nudge.
- The two platform additions argued on their own merits as a `dashboard-plugin-loader` delta, usable by any plugin (flows has the same hole).
- The per-session read-only route and both client surfaces (subcard, content-view drill-in) exactly as specced.

**Non-Goals:**

- No per-session capability delivery to unselected cards (bulk subscribe / enriched `DashboardSession`). That remains the platform gap; the global gate is the accepted resolution.
- No writes to any blackhole file; no flush/compact triggers.
- No change to slot definitions (`slot-types.ts` / `slot-props.ts` untouched — repo-lint scenario).

## Decisions

### D1 — Installed truth source: registry capability authoritative; config-file existence only as degraded fallback

`GET /api/plugins/blackhole/status` (new, on the plugin's own server entry) returns `{ installed: boolean }`:

```
installed = ctx.isPiExtensionInstalled
  ? await ctx.isPiExtensionInstalled("pi-blackhole")   // capability present → authoritative, alone
  : existsSync(blackholeConfigPath)                     // capability absent → degraded fallback only
```

- **Registry** (via D2) is the authoritative "is installed" signal when the capability exists. Its negative answer is final: config-file existence never overrides it, because `pi-blackhole-config.json` (fixed name, never cleaned) survives an uninstall and would hold the gate open forever — the "has run once ≠ installed" defect that killed mechanism 5.
- **Config-file existence** (reusing `resolveBlackholeConfigPath`, one `existsSync`) is consulted **only when the capability is absent** (older host, injected test context) — acceptable as a degraded answer, never as an override. (The file is created by the dashboard settings page's PUT route, so existence strictly means "configured via the dashboard" — the residual mechanism-5 weakness is confined to this degraded branch and accepted there.)
- Capability answers `false`, or no capability and no file → `false`; the client gate fails closed.
- **Capability rejection ≠ not-installed:** the route wraps the capability call; a rejection (registry scan failure — pi mid-update, registry lock) returns **503**, never `{ installed: false }`, so the client's 5xx retry path treats it as transient. Without this, a scan error would collapse to a `200 false` that the client finalizes — a permanent false negative through the back door.
- **One truth source inside the plugin:** the existing `blackhole-api.isExtensionInstalled()` (settings surface; currently reads `GET /api/plugins` → global-only `missingRequirements`, fails open) is repointed at this same `/status` route — its fail-open-on-unknown posture is preserved — so the settings page and the subcard gate cannot disagree once a resolve succeeds. During a scan failure (503) they intentionally diverge: settings fails open (keeps advertising config), the gate fails closed (renders no chrome) — opposite stakes, deliberate postures.

Alternatives: registry-OR-file (rejected — whenever the registry is negative and the file exists, the file becomes the sole basis for `true`, contradicting the spec's "corroborating only" clause and re-opening the mechanism-5 defect); file-only (mechanism 5, rejected); client reading `GET /api/plugins` directly (works for `BlackholeSettings`, but couples the gate to the host status payload shape and gives the plugin no server-side seam to test — and the spec pins the plugin's own route).

### D2 — Platform capability: `ctx.isPiExtensionInstalled(name)` on `ServerPluginContext`

New optional method `isPiExtensionInstalled(name: string): Promise<boolean>` in `packages/dashboard-plugin-runtime/src/server/server-context.ts` (+ `ServerContextDeps`), wired in `packages/server/src/server.ts` from the union of `packageManagerWrapper.listInstalled("global")` and `listInstalled("local")`, matched with the same `installedMatchesName` logic (id/name/displayName/source + `sourcesMatch`) as the `piExtensions` probe in `packages/dashboard-plugin-runtime/src/server/requirement-probes.ts`, cached ~30 s like that probe.

- The union of scopes is deliberately a **superset** of the probe's current global-only wiring (`server.ts`), so for a *local-scope* install this capability answers installed while the Packages UI (`missingRequirements`) says missing — a pre-existing probe limitation, recorded as a trade-off below, not silently reconciled here.
- **Scan errors propagate:** unlike `probePiExtension` (which swallows a `listInstalled` throw into `satisfied: false`), the capability rejects on scan failure — a boolean cannot carry "unknown", and resolving `false` would be indistinguishable from an authoritative answer (see D1's 503 mapping).
- Boolean-only answer: no package *records* leak to plugins. It remains a per-name existence oracle (any plugin can probe names one by one) — accepted, and the reason it can be exposed **ungated** (unlike `spawnSession`/`abortSession`).
- Optional (`?`) on the context type so injected-Fastify plugin tests and older hosts degrade: absent capability → treat as "unknown" → fall through to the config-file term.
- Alternative rejected: exposing `listInstalled()` records wholesale (unnecessary surface, mild enumeration sensitivity).

### D3 — Platform re-render nudge: slot-claims invalidation store

Client-side runtime addition in `dashboard-plugin-runtime`: a module-level version store with `bumpSlotClaimsVersion(): void` (exported to plugin client entries) and an internal `useSyncExternalStore` subscription inside `useSlotHasClaimsForSession` (and the slot consumers that call `shouldRender`). When a plugin's late-arriving gate signal resolves, it bumps the version; every gate wrapper re-evaluates, including cards for idle/ended sessions that will never broadcast again.

Implementation notes: the store is meaningful only while host and plugin client entries resolve to ONE `dashboard-plugin-runtime` instance (true under the hoisted workspace + Vite resolution today; a bundling change that duplicates the module would silently disconnect bumps from subscribers). And `useSlotHasClaimsForSession` currently early-returns before any hook when the registry context is null (`slot-consumers.tsx`) — the `useSyncExternalStore` subscription MUST be invoked before that early return, or the hook order breaks whenever the registry is absent.

- This is the honest fix to the blocker sentence "a late-arriving signal does not re-render the wrapper", scoped to *global* signals (no per-session payload).
- Alternatives: piggyback on `session_updated` broadcasts (never fires for idle/ended sessions — the exact scar); host polling (wasteful); leaving it out (mechanism 5 defect #4 survives).

### D4 — Client boot check: guarded module-scope resolve with retry

`packages/blackhole-plugin/src/client/` gains an `installed-gate.ts`:

- Module-scope `resolveInstalled()` kicked off at client-entry import time, **guarded** so it does not run under vitest/jsdom. The guard detects vitest specifically (`process.env.VITEST` / `import.meta.vitest`, plus an injected override) rather than `import.meta.env.MODE === "test"`, which a custom `--mode` run bypasses; `process` does not exist in the browser bundle, so access MUST be typeof-guarded (`typeof process !== "undefined" && process.env.VITEST`) or use `import.meta.vitest` — an unguarded read throws at module scope in production, the mirror image of the mechanism-5 breakage — and the generated plugin registry IS imported by client tests, so the guard is load-bearing (mechanism 5 broke the test suite here).
- Fetches `/api/plugins/blackhole/status`; anything other than a well-formed `200 { installed: boolean }` — network error, non-200 (incl. the 404 of a disabled plugin whose routes never registered), malformed body — is transient: it retries with capped backoff (3 attempts), then falls to a slow fixed interval (~60 s) **until the first success — it never gives up**, so a transient failure is never a permanent false negative (mechanism 5 defect #3). After the first successful resolve the value is final for the page lifetime; no re-poll.
- Success writes a module-level `installed` boolean and calls `bumpSlotClaimsVersion()` (D3).
- Exported `shouldRenderMemorySubcard()` reads that boolean **synchronously**, returns `false` until resolved (fails closed), and is named in the manifest as the claim's `shouldRender` string.
- Tests exercise `resolveInstalled` explicitly with injected fetch; the module-scope kick is a one-line guarded call.

### D5 — Per-session route: validate-then-confine, read-only

`GET /api/plugins/blackhole/session/:id` in the plugin server entry:

1. Validate `:id` against RFC 4122 syntax with an **unrestricted version nibble** (pi emits UUIDv7); reject before any fs access. Path separators / `..` never reach the fs by construction, but the validator rejects them anyway.
2. Build `<agentDir>/pi-blackhole/<id>-pending.json`, then assert the resolved absolute path lies inside `<agentDir>/pi-blackhole/` (defense in depth) before reading.
2a. The shapes of `<session.id>-pending.json` and `pi-blackhole-cooldown.json` (names, dir, worker-cursor/batch-count/resolved-model/cooldown fields) are external contracts with zero in-repo references: pin them with a `SOURCE-VERSION PIN: mirrored from pi-blackhole@<version>` comment, following the landed `config-path.ts` precedent.
3. Response merges: per-session pending state (absent or unparseable file → `activity: "none"`, never an error — matching config-io's quiet-degradation posture), global config fields (`compactAfterTokens`, `memory`, `compaction` via existing `readConfig`; parse failure degrades to nulls rather than 500), and resolved-model/cooldown info from `pi-blackhole-cooldown.json` (same quiet degradation).
4. `GET` only; no mutating verb registered; no write to any blackhole file (route tests assert bytes+mtime unchanged, following `routes.test.ts` precedent).
5. Auth posture: mounted on `ctx.fastify` like the landed blackhole routes, inheriting the host's `/api` posture; the payload is low-sensitivity operational data (cursors, model names, cooldown timing) — no transcript content, no secrets.

### D6 — Subcard and detail view render from one response

The subcard fetches the per-session endpoint on mount (per selected/rendered card) and derives its states: healthy single-row, no-activity-yet, workers-off, degraded (cooldown advisory), pending-batches advisory. Proximity meter = dashboard `contextTokens` vs `compactAfterTokens`, rendered as an explicitly approximate, unscaled fill (no numbers, no threshold marks) alongside the exact cursor lag. The `content-view` drill-in reuses the same response, adds provenance labels (pending file / cooldown file / dashboard accounting), activates only via explicit navigation with a route-back affordance, and carries a manifest-wide `priority` **higher-numbered** than first-party content-view claimants (lowest wins; no per-claim priority field). The landed manifest already ships `"priority": 100` — **tied** with flows' 100, and the tie-break (`pluginId.localeCompare` in `slot-registry.ts`) makes `blackhole` *win* — so this change MUST bump `packages/blackhole-plugin/package.json` manifest `priority` to a higher number (e.g. `200`).

## Risks / Trade-offs

- [Global gate ≠ per-session truth] → Accepted in the spec: installed-but-never-loaded sessions show the no-activity-yet state, not a hidden subcard.
- [Registry scan cost on a hot path] → 30 s cache in the capability, mirroring `requirement-probes.ts` (the only cache layer — the client resolves once per page load, so a route-level cache would be dead weight). Only successful scans are cached (like the probe); rejections are not, so a recovered registry answers on the next retry. Corollary: install-then-reload within the cache window can still return a cached `false`, which the client finalizes for that page lifetime — heals on a later reload after the TTL expires. Accepted.
- [`agentDir` resolved from the server process env] → `resolveBlackholeConfigPath`/`resolveAgentRoot` read the *dashboard server's* `PI_CODING_AGENT_DIR`; a session running under a different agent dir writes its pending file elsewhere and shows no-activity-yet. Same limitation as the landed config surface; documented, not solved here.
- [Platform delta grows blast radius: `dashboard-plugin-runtime`, `packages/server`] → Both additions are additive + optional; absent capability degrades to the config-file term; the invalidation store defaults to version 0 and changes nothing until bumped. Delta spec makes them reviewable platform features, per the proposal's split rationale.
- [Session id interpolated into a filename] → D5's validate-then-confine; `security-hardening` discipline task covers it; version-nibble trap (rejecting UUIDv7) is pinned by a dedicated spec scenario.
- [Boot fetch under tests] → Explicit environment guard + injectable resolve function; the guard itself is unit-tested.
- [Cooldown/pending file formats drift with the extension] → Reader treats unknown/missing fields as absent and degrades to no-activity/no-advisory; never a rendered parse error. Design-time shapes are source-version-pinned (D5 2a).
- [Capability (union global+local) disagrees with the Packages UI probe (global-only) for local installs] → Subcard (and, post-repoint, blackhole's own settings check) may show installed while the host Packages UI says missing. Pre-existing probe limitation; documented, not widened here — aligning the probe is a separate platform fix.
- [Per-name existence oracle] → Any plugin can probe installed extensions name-by-name via the boolean capability. Accepted: no records leak, and the information is low-sensitivity.
- [Subcard data is a mount-time snapshot] → Idle/ended sessions never refresh it (no broadcast, no polling); "exact cursor lag" is exact as of mount. Each rendered card issues one per-session fetch at gate-resolve (no batching). Accepted for scope; polling is a possible follow-up.

## Migration Plan

Additive except one field edit: the shipped manifest `priority` `100` → higher number (D6). Land order inside the change: (1) runtime capability + invalidation store with tests, (2) server wiring, (3) plugin server routes, (4) client gate + subcard, (5) content-view. No data migration; rollback = revert, no persisted state changes.

## Open Questions

None. (Retry cadence was open — now pinned in D4: capped backoff ×3 then ~60 s interval until first success, never give up, no re-poll after success — because "give-up-after-N" would violate the spec's transient-failure requirement.)
