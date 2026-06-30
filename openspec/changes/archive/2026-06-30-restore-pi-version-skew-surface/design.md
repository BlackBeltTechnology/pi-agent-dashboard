## Context

`eliminate-electron-runtime-install` removed the bootstrap-state machinery (`/api/bootstrap/*`, `BootstrapBanner`, `useBootstrapStatus`) — correctly, since pi/openspec/tsx are now regular npm deps with no first-run install. But that surface also carried the pi-version-skew signal, which was dropped. Today `packages/server/src/pi-version-skew.ts` exports `readCurrentPiVersion` / `readPiCompatibility` / `computeCompatibility` with the only live importer being `pi-changelog-routes.ts`; the `piCompatibility` floor (now `0.78.0`) is documentation, not a runtime signal. A user on too-old pi gets cryptic spawn-time errors, not a clean upgrade hint.

Two distinct version questions exist and must not be conflated:

| Question | Authoritative source | Granularity |
|---|---|---|
| "Is the dashboard's bundled pi recent enough?" | server's own tree via `readCurrentPiVersion(registry)` | global (one per dashboard) |
| "What pi is *this session* running?" | the bridge, via `createRequire` inside pi's process | per session |

In the bundled-server architecture an out-of-band `pi update --self` / `npm i -g` changes a session's pi but not the server's bundled copy — so the server-side read cannot answer the per-session question. The bridge can. This change surfaces both, through separate, complementary paths.

The per-session path was folded in from the retired `modernize-pi-version-handling`, whose other premises (floor bump, registry-probe, version-skew cache invalidation) were already obsolete.

## Goals / Non-Goals

**Goals:**
- Re-attach the existing `pi-version-skew.ts` primitives to a live surface: `/api/health.compatibility`.
- Render a small, non-blocking advisory (hidden / soft-yellow / hard-red) in Settings → General.
- Report each session's actual pi version from the bridge; display it as a per-session label.
- Keep both additive: no removed APIs, no revived bootstrap machinery.

**Non-Goals:**
- Reviving `/api/bootstrap/*`, `BootstrapBanner`, `useBootstrapStatus`, or any pre-R3 install machinery.
- Auto-upgrading pi, or refusing to spawn sessions below minimum (pi's own assertions + the advisory suffice).
- Feeding the per-session bridge version into the global compatibility verdict (they answer different questions; keep them independent).
- A full-app blocking banner. The advisory lives in Settings only.

## Decisions

**D1 — Global advisory rides on `/api/health`, not a new endpoint.** `/api/health` is already polled by the client and is the natural home for a derived status field. Add `compatibility: BootstrapCompatibility | null`, computed lazily and cached 30s (the probe does a registry resolve + file read; rapid health polls must not thrash it). `null` when pi is unresolvable — a clean install legitimately predates a pi resolution, which is not an error. *Alternative considered:* a dedicated `/api/pi-compatibility` route — rejected as an extra surface for one derived field the health poll already round-trips.

**D2 — Add `error?: string` to `BootstrapCompatibility`; `computeCompatibility` populates it below-minimum.** Today `computeCompatibility` only sets `upgradeRecommended` for the below-minimum case. The advisory's hard-red state keys off a populated `error`, so the pure function must emit a non-empty string naming both the running and required versions. This keeps the server route a thin caller and all version logic in the one tested pure function. *Alternative considered:* derive the error string client-side — rejected; duplicates the version-comparison branch and the spec asserts `compatibility.error` server-side.

**D3 — Per-session version reuses the per-session-observation idiom.** The bridge already pushes `git_info_update` / `model_update` / `session_name_update`; the server stores each on `DashboardSession` and `broadcastSessionUpdated`. `pi_version_update` joins that family verbatim — `sendPiVersionIfChanged(bc)` in `model-tracker.ts` mirrors `sendGitInfoIfChanged`, and the re-read rides the existing git/model poll tick (`runGitPollTick`, 30s) alongside the model/name/git checks. *Alternative considered:* a dedicated subsystem / new timer — rejected; the poll tick already fires, so piggyback and add nothing to clean up on disconnect.

**D4 — Bridge reads via `createRequire`, not the registry.** The bridge runs inside pi's own `node_modules`, so `createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent/package.json")` always resolves — none of the server-side registry / realpath / Windows-`.cmd` edge cases apply. Module-scoped `lastPiVersion` debounces and survives reconnect.

**D5 — Per-session label is read-only and independent of the advisory.** It renders next to git-branch / model in the session header; hidden when `piVersion` is `undefined` (older bridges, pre-register). It does not feed, override, or reconcile with the global advisory.

## Risks / Trade-offs

- **30s health cache hides a just-completed upgrade for up to 30s in the global advisory** → acceptable; the per-session label (no cache, 60s bridge poll) is the timely signal, and a stale global hint self-corrects on the next probe.
- **Adding `error` to `BootstrapCompatibility` touches a shared type** → low blast radius; field is optional, only the new route + advisory read it. Existing `computeCompatibility` callers (`pi-changelog-routes.ts`) ignore unknown extra fields.
- **Older bridges never send `pi_version_update`** → `piVersion` stays `undefined`, label hidden; no breakage. Pure additive.
- **Two version surfaces could confuse users (global vs per-session)** → mitigated by placement and copy: global advisory in Settings phrased as "dashboard's pi"; per-session label phrased as the session's running version.

## Migration Plan

Pure additive, no migration. Deploy order: server (`error` field + `computeCompatibility` + `/api/health`), shared (`pi_version_update` + `DashboardSession.piVersion`), bridge (push), client (advisory + per-session label). Rollback: remove the health field + advisory files, and the `pi_version_update` message + arm; both surfaces vanish with no orphan state.

## Open Questions

- Promote the hard-red below-minimum advisory to a full-app banner (vs Settings-only) if a future pi version is a true hard blocker? Deferred — current floor transitions are soft.
- Surface the per-session `piVersion` in the sessions *list* (not just detail header)? Deferred to keep scope minimal; the field is broadcast either way, so a later UI-only follow-up can add it.
