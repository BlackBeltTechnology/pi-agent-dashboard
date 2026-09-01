## Context

`ProviderAuthSection` splits `/api/provider-auth/status` into an OAuth list
(`flowType !== "api_key"`) and an API-key list, rendering one `OAuthProviderRow` per OAuth
provider. The `anthropic` row (`flowType: "auth_code"`) is the Claude-subscription sign-in; its
authenticated branch shows a green **Connected** marker, an expiry countdown, and **Sign Out**.

That authenticated state only delivers working sessions/flows when the
`@blackbelt-technology/pi-anthropic-messages` peer resolves for the bridge.

**Ground truth for "does the peer resolve" is the bridge's own probe, not the installed-package
list.** `peer-probe.ts` resolves two tiers — tier-1 `createRequire(cwd).resolve(spec)` (workspace
`node_modules`, invisible to pi's `settings.json#packages[]`) and tier-2 pi packages — and probes
both the scoped name and the legacy `@pi/anthropic-messages` alias. The bridge broadcasts the
result; `flows-anthropic-bridge-plugin/src/server/index.ts:90` records it via
`recordBridgeProbe("flows-anthropic-bridge", …)`, and `plugin-status-store.ts:45` enriches
`/api/health.plugins[]` rows with `lastProbe: BridgeProbeSnapshot { status, peers, at }`.

The installed-package list cannot serve as this signal: `package-manager-wrapper.ts:375`
(`scopeFilter = scope === "global" ? "user" : "project"`) returns exactly one scope per call, the
Settings surface has no `cwd` for a project-scope read, and neither scope sees a tier-1
`node_modules` resolution.

## Goals / Non-Goals

**Goals:**
- Tell the operator, at the moment the Anthropic OAuth row shows Connected, that the peer the
  bridge needs is not resolving — inline on that row.
- Derive that from the bridge's authoritative probe, so tier-1/tier-2, git/local/npm installs and
  both package names are all handled by machinery that already ships.
- Offer a one-click install, and state honestly when it takes effect.

**Non-Goals:**
- Auto-installing the peer, or blocking sign-in / sign-out.
- Hints on other OAuth providers, on API-key rows (incl. `anthropic-api`), or on the LLM Providers
  custom-endpoint card.
- Any server, extension, or bridge change — the probe already ships end to end.
- Reporting the *other* bridge peer (`pi-flows`) or the bridge's overall health; doctor and the
  Plugins tab own that.

## Decisions

**D1. Signal = `lastProbe.peers["@pi/anthropic-messages"].ok`, not `status`.**
`BridgeStatusEvent` keys the peers map by the **legacy** literal `"@pi/anthropic-messages"` even
though `probeAll` resolves both names (`peer-probe.ts` `PEER_AM_NAMES`), so the client reads that
key. Reading `lastProbe.status === "waiting_peers"` instead is **wrong**: the bridge also parks in
`waiting_peers` when `pi-flows` is missing, which this hint must not claim is an Anthropic-peer
problem.

**D2. Strict `=== false`; every other shape is fail-open.**
`peerMissing` is true only when `lastProbe.peers["@pi/anthropic-messages"].ok === false`. Absent
`/api/health` response, absent `flows-anthropic-bridge` plugin row, absent `lastProbe`, absent peer
key, still-loading — all yield `false` (render nothing). Consequences accepted deliberately: an
operator who has not installed the bridge plugin, or who has never run a pi session (no probe
emitted yet), gets no hint. A missing signal is not evidence of a missing peer, and a warning under
a green Connected marker is expensive to get wrong. This also removes the first-paint hole that a
`packages.length === 0` style check would have had.

**D3. Detection lives in `ProviderAuthSection`; the row takes a boolean prop.**
A new `useAnthropicPeerProbe()` hook fetches `/api/health` once for the section and derives
`peerMissing`; `OAuthProviderRow` receives `peerMissing: boolean` + `onInstallPeer`. Per-row hooks
would fan out one fetch per provider. `usePluginEnabledSet` already fetches `/api/health` on mount
and on `plugin_config_update`; the new hook follows that established shape rather than extending it
(its consumer is the slot registry, not this section).

**D4. The row renders the hint only for `id === "anthropic"` && `authenticated` && `peerMissing`.**
Gating on authenticated state — not on the sign-in event — so an already-connected row hints on page
load. A signed-out row has no problem to report.

**D5. Install affordance enqueues the scoped npm name via the existing queue.**
`usePackageOperations("global", undefined)` → `install(<RECOMMENDED_EXTENSIONS source>)`. The third
`onAnyCompletion` argument is deliberately **omitted**: it fires on any successful op, and this hook
does not own an installed-packages fetch to refresh. Per-source state comes from `statusFor(source)`
/ `messageFor(source)`, which the hint renders — so a failed install surfaces its error instead of
leaving a dead button. Duplicate enqueues are prevented by the queue's own `(source, action)` dedupe.

**D6. The hint self-clears through the probe — install triggers a real re-probe.**
A successful install calls `reloadSessions()` server-side (`package-manager-wrapper.ts:486`), which
sends `/reload` to every connected pi session; the bridge re-probes on `session_start`
(`bridge/index.ts:197`) and broadcasts a fresh snapshot. So in the normal case install → reload →
re-probe → `ok: true` → hint gone, no page reload. The client re-reads `/api/health` on
`pi-package-event` completion and on window focus to pick that up; the completion refetch races the
async reload chain, so the focus/interval re-read is what usually lands the cleared state, not the
immediate one.

**D6b. The "installed, pending re-probe" state is the narrow fallback, and needs its own latch.**
When the probe exists but *no live session* remains to reload (the emitting session has since
exited), install cannot flip the probe. For that case a successful install switches the surface to an
informational line: installed, applies on the next pi session start. This state **must not** be
derived from `statusFor(source) === "success"` — `package-queue.ts:39` clears success after
`SUCCESS_AUTOCLEAR_MS = 3000`, which would silently revert to the warning + Install button. It is an
explicit local latch, set on completion and released when the probe reports `ok: true`.

**D6c. `ok: false` with an import failure is not an install problem.**
`bridge/index.ts:155` sets `am: { ok: false, reason: "import failed: …" }` when resolve succeeded but
import threw — the package IS installed. Offering "Install peer" there is wrong. Detection is a
literal `import failed:` **prefix match** on `reason` (decided at the scenario-design gate, C1). This
deliberately couples to the bridge's string: the coupling is pinned by a contract test asserting the
bridge still emits that prefix, so a rename fails a test rather than silently degrading the hint.
Every other `ok: false` shape (including a missing/empty `reason`) keeps the install affordance.

**D6d. The probe is polled while the section is mounted.**
Focus + package-operation re-reads miss the case that matters most on a long-lived tab: the operator
is sitting on the providers page when the first pi session starts and emits the first probe. A
`setInterval` while `ProviderAuthSection` is mounted covers it (decided at the gate, C2). Interval =
**60 s**, adopting `usePiCompatibility.ts:22` — the existing `/api/health` poll — rather than
introducing a new cadence. Cleared on unmount, alongside the existing polling refs the section
already manages.

**D7. Presentation: the shipped `InlineMessage` primitive, inside the row below the header line.**
`severity="warning"` for the missing state, `severity="info"` for the installed-pending-reprobe
state, single action pill, no dismiss, no modal — in the slot the row already uses for the
enterprise-domain prompt and device-code panel. Static copy routes through `i18nT(...)`, matching
every other string in `ProviderAuthSection`; dynamic strings that originate server-side (`messageFor`
npm/PM output, probe `reason`) are rendered verbatim and are **not** translatable — stated here so
the i18n claim is not overread. Mockup + UX rubric: `mockups/index.html`, `mockups/ui-plan.md`.

**D8. Peer specifier constants are imported, not re-declared.**
The probe map key comes from `PEER_AM_LEGACY` and the install source from the existing
`RECOMMENDED_EXTENSIONS` entry (`recommended-extensions.ts:142`, already
`npm:@blackbelt-technology/pi-anthropic-messages`) — no new copy of either string, and no hand-built
`npm:` prefix. Note the asymmetry deliberately: **the probe key is the legacy name, the install
target is the scoped name.** Swapping them silently breaks detection, so each has a named constant
rather than a literal at the call site.

## Risks / Trade-offs

- **No probe ⇒ no hint** (bridge plugin absent, or no pi session has run) → accepted per D2; doctor
  and the Plugins tab remain the exhaustive report. This is the cost of not false-warning.
- **Probe staleness**: `lastProbe` reflects the last session that emitted status. A peer removed
  since then still reads `ok: true`. Under-warning, not over-warning — consistent with D2.
- **Cross-session oscillation**: `recordBridgeProbe` is global last-writer-wins
  (`plugin-status-store.ts:34`), so with sessions in heterogeneous cwds the snapshot flips with
  whichever session emitted last — a peer visible only in project A's `node_modules` reads `ok:
  false` after a session boundary in project B. Compounded by the bridge's broadcast dedupe: a
  healthy ACTIVE session does not re-emit, so a stale `false` can dominate. Accepted: fixing it means
  per-session probe storage, i.e. a server + bridge change this client-only hint will not carry.
- **Plugin-specific knowledge in a core component**: `ProviderAuthSection` learns one plugin's id and
  peer key, bypassing the slot/claims architecture and the existing PluginsSection
  missing-requirement → `RECOMMENDED_EXTENSIONS` install pipeline. Accepted for a single hint;
  a second such surface should become a plugin-contributed slot instead of a third hardcode.
- **`authenticated` staleness**: `ProviderAuthSection` fetches statuses on mount and on its own
  actions, so a token expiring while the page sits open keeps `authenticated: true`. Pre-existing
  behaviour of the section; this change neither improves nor worsens it.
- **Warning tone next to a green Connected marker reads as "sign-in failed"** → copy leads with the
  next step, not with a failure; the Connected marker and expiry stay untouched above it.
- **One extra `/api/health` fetch per providers-tab mount** → cheap, and the endpoint is already
  polled by `usePluginEnabledSet`.

## Migration Plan

Additive client-only change. No server, extension, protocol, or persisted-state change — the probe
already ships end to end. Rollback = revert the commit. Rebuild path: `npm run build` +
`curl -X POST http://localhost:8000/api/restart`.

## Open Questions

None blocking. If a second surface later wants the same signal, promote `useAnthropicPeerProbe` to a
general `useBridgePeerProbe(pluginId, peerKey)`.
