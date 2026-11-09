# Design

## Context

See proposal.md — Why. Current startup order, verified against pi 1.5.0:

- pi awaits every extension factory: `await factory(load.api)`
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:518`);
  `ExtensionFactory` is `void | Promise<void>` (`dist/core/extensions/types.d.ts:1541`).
- `registerProvider` called during the factory is queued
  (`loader.js:169-170`, `pendingProviderRegistrations`) and flushed in order to
  the model runtime after extensions load (`dist/core/agent-session-services.js:72-84`).
- Only then is `--model` resolved: `createAgentSessionServices` (`dist/main.js:609`)
  precedes `buildSessionOptions` → `resolveCliModel` (`dist/main.js:672`,
  `dist/main.js:367`); an unknown model is a hard error
  (`dist/core/model-resolver.js:366`) and pi exits 1. `-p` and `--mode rpc` share
  this path.
- The bridge default export is synchronous (`packages/extension/src/bridge.ts:120`).
  In its `try` block it calls `activateProviderRegister(pi)` (`bridge.ts:128`),
  `activateRoleManager(pi)`, `claudeCompatExtension(...)` and `initBridge(pi)`
  (`bridge.ts:126-156`). Tests call the default export without `await` and assert
  synchronously afterwards (`packages/extension/src/__tests__/bridge-reentry-guard.test.ts:47-49`).
- `activate()` (`provider-register.ts:1146-1178`) per provider calls
  `preRegisterProviderAuth` (auth only, `provider-register.ts:857-869`) and pushes
  a fire-and-forget `registerEntry(pi, name, entry)` with a logging `.catch`
  (`provider-register.ts:1171-1176`). `registerEntry` uses `discoverModels`, which
  maps a failed fetch to `[]` (`provider-register.ts:583-585`); `tryDiscoverModels`
  returns `null` on failure and hardcodes `AbortSignal.timeout(10_000)`
  (`provider-register.ts:593-605`). `registerEntry` accepts `prediscovered`
  (`provider-register.ts:875`).
- During activation `getModelRegistry()` is still `null`, so startup
  registrations get native/api-typed fallback metadata, not the catalog probe
  (`provider-register.ts:895-899`); `onProviderChanged`'s callback is only set
  later in `initBridge` (`bridge.ts:2092`).
- Probe: an extension that awaits `/v1/models` and calls
  `pi.registerProvider("proxy", {…, models})` inside its factory makes
  `pi --model proxy/cc/claude-sonnet-5-5 -p …` succeed.

## Goals / Non-Goals

**Goals**
- A custom-provider model given as `--model` resolves at pi startup on every
  road (automation/plugin, browser, REST, resume/fork, standalone CLI).
- No added startup latency with a warm cache; bounded latency otherwise.

**Non-Goals**
- Changing the server spawn roads or `--model` argv shaping.
- Fast failure of automation runs on other pre-register crashes — follow-up
  change `fail-automation-run-on-spawn-failure`.
- Validating the requested model id before spawning.

## Decisions

### D1 — Await startup registration as the LAST step of the bridge factory
The default export keeps its synchronous body unchanged and in the same order
(provider activation, role manager, claude-compat, `initBridge`), then as its
final statement does `return await awaitStartupProviderModels(pi)` inside the
existing `try` (so a rejection is caught and logged, never escapes). Signature:
`export default function (pi): void | Promise<void>` (async). Everything tests
assert synchronously is registered before the first `await`; pi awaits the
promise (`loader.js:518`), so queued `registerProvider` calls with models flush
before `--model` resolution. The inert-bridge early return (`bridge.ts:124`) and
the re-entry guard inside `initBridge` are untouched. `activate()` stays
synchronous for its direct callers; it stores the startup promise in module state
that `awaitStartupProviderModels` returns (reset on each `activate()` call).
*Alternative rejected:* server strips `--model` for custom providers and the
bridge `setModel`s after discovery — larger surface and leaves standalone
`pi --model proxy/…` broken.

### D2 — What is awaited: only the provider named by `--model`
Per provider in `providers.json`, inside `activate()`:
1. `preRegisterProviderAuth` (unchanged).
2. Usable cache entry (D3) → additionally `registerEntry(pi, name, entry, cached)`
   — no `await` precedes `pi.registerProvider` on the `prediscovered` path
   (`provider-register.ts:871-940`), so this registers synchronously.
3. ALWAYS (cached or not) the unchanged fire-and-forget background
   `registerEntry` on `reloadChain`, which refreshes the list and the cache.

Startup target: the provider pi itself will resolve, derived from `process.argv`
the way pi parses it (`dist/cli/args.js`, `dist/core/model-resolver.js:329-339`):
- `--provider <p>` present → `<p>`;
- else `--model <v>` with a `/` → `<p>` = text before the FIRST `/` (model ids may
  contain `/`, e.g. `cc/claude-sonnet-5-5`; a trailing `:<level>` stays in the id
  part and is irrelevant here);
- else (bare id, fuzzy match) → no startup target (covered only when cached).
Provider names compare case-insensitively, as pi does. When the target is a
custom provider without a usable cache entry, `activate()` runs ONE live
discovery for it under `AbortSignal.timeout(5000)` (`tryDiscoverModels` gains an
optional `signal`, combined with its own 10 s timeout via `AbortSignal.any`).
`awaitStartupProviderModels` awaits only that discovery; a non-empty result is
registered via `registerEntry(…, discovered)` and recorded; a `null`/empty result
is logged as `[dashboard] startup discovery for "<p>" failed` and `<p>` relies on
its background `registerEntry` (step 3).
Hence: no `--model`, a built-in `--model`, or a cached custom `--model` → zero
added latency regardless of other providers' health.
`reloadChain`: `reloadChain = reloadChain.then(() => Promise.all(startup))`
(`provider-register.ts:1178`) keeps covering every background `registerEntry`
(the startup discovery is added to `startup`), so a re-sync waits for both.
The awaited startup promise never rejects (all failures are caught and logged):
pi `discard()`s every queued registration of a factory that rejects
(`loader.js:518-522`), so an escaped rejection would also drop the cached
registrations.

### D3 — Cache: one file per provider, written by every successful discovery
`~/.pi/dashboard/custom-provider-models/<encoded-name>.json`, mode `0600`:
`{ version: 1, baseUrl, keyFingerprint, discoveredAt, models: DiscoveredModel[] }`.
- Per-provider files remove the read-merge-write race: each write is a complete
  file via `<file>.<pid>.tmp` + `renameSync`; concurrent writers for the same
  provider are last-writer-wins with equally valid content; writers for different
  providers never touch each other.
- `keyFingerprint` = first 16 hex chars of SHA-256 over `name + "\0" + resolved`,
  where `resolved` is the key after `$ENV` resolution (`resolveApiKey`,
  `provider-register.ts:536`); for a `!command` key the raw reference is hashed
  (the command is not executed for fingerprinting — accepted: rotating a command's
  output does not invalidate the cache; background refresh corrects the list).
  Only the one-way fingerprint is stored.
- Usable entry = same `baseUrl`, same `keyFingerprint`, non-empty `models`.
- Writes happen in ONE helper used by every live discovery (`registerEntry` when
  it discovers itself, the startup `--model` discovery, and `reloadProvidersNow`
  forced refresh, `provider-register.ts:1009`): write only on a non-null,
  non-empty result. `registerEntry` switches from `discoverModels` to
  `tryDiscoverModels` to know success; on failure it keeps registering `[]` ∪
  native models as today and does not write.
- Files for providers no longer in `providers.json` are never read; no pruning.

### D4 — Interaction with pendingDefaultModel and /reload
`pendingDefaultModel` is unchanged; a cached custom default resolves on the first
`applyDefaultModel()`. `/reload` re-runs factories; only a cold-cache custom
`--model` can wait (≤5 s).

## Risks / Trade-offs

- [Stale cache lists a model the provider dropped] → pi starts on it; background
  refresh (seconds later) re-registers the live list, so the session may sit on a
  model no longer listed and its first turn fails with the provider's error —
  same outcome as a model withdrawn mid-session.
- [`--model <bare-id>` naming an uncached custom model] → not covered at cold
  cache (pi's fuzzy match cannot be predicted from argv); covered once cached.
- [Cold cache + unreachable provider named by `--model` adds ≤5 s to that start]
  → bounded, and only for that case; failures are not cached so recovery is
  automatic.
- [Startup models carry fallback metadata until background/next refresh] → only
  for the `--model` provider discovered at startup; cache hits carry the advertised
  metadata recorded at discovery; catalog-probe enrichment arrives on the next
  re-sync as today.
- [Project-trust path may load extensions twice] → unverified; each load is
  bounded by the same timeout and a warm cache makes it free.

## Migration Plan

None: first activation after upgrade has a cold cache (D2 live path); the cache
fills on the first successful discovery. Rollback = previous bridge; the cache
file is then ignored.
