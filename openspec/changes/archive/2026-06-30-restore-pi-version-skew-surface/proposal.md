# Proposal — restore-pi-version-skew-surface

## Why

`eliminate-electron-runtime-install` (shipped 0.5.4) removed the entire bootstrap-state machinery — including `BootstrapBanner`, `useBootstrapStatus`, and `/api/bootstrap/*`. That cleanup was correct: with pi/openspec/tsx now regular npm deps of the bundled server tree, there is no first-run install to surface. But the surface was overloaded — it also carried the **pi-version skew** indication, and that signal had real value that was silently dropped.

Today's reality, after `bump-pi-compat-to-0-75`:

- `packages/server/package.json::piCompatibility` is authoritative documentation but **not enforced at runtime**.
- `packages/server/src/pi-version-skew.ts` exports `readCurrentPiVersion`, `computeCompatibility`, `readPiCompatibility`, `BootstrapCompatibility` — all **dead code** (zero importers in the live codebase).
- A user on pi 0.74.x against a dashboard with `minimum: "0.75.0"` sees **no warning anywhere**. They will encounter cryptic errors at session-spawn time (pi's own version assertions fire), not a clean "your pi is too old, upgrade to 0.75.5" hint.
- Future floor bumps (`bump-pi-compat-to-0-76` is queued; more will follow) have **no verification target** — their "Phase 3 manual smoke" tasks are unverifiable as written.

This proposal re-wires version-skew detection through a single thin path: `/api/health` gains a `compatibility` field (using the already-implemented `pi-version-skew.ts` primitives), and a small client-side advisory renders when a hint or error is present. No bootstrap-state machinery, no `/api/bootstrap/*` revival, no `BootstrapBanner` resurrection — just one health-response field plus a small advisory component.

**Folded in 2026-06-30** (from the retired `modernize-pi-version-handling`): the global advisory answers "is the dashboard's bundled pi recent enough?" via a *server-side* read of the server's own tree. It does NOT answer "what pi is *this session* running?" — in the bundled-server architecture an out-of-band `pi update --self` / `npm i -g` changes the pi a session spawns against but leaves the server's bundled copy untouched, so the server-side read is the wrong source for per-session truth. The bridge runs **inside** each session's pi process and holds the ground-truth version. This change therefore also has the bridge report its session's pi version, displayed as a per-session label — complementary to, not a replacement for, the global advisory.

## What Changes

### Phase 1 — Server surface

- **MODIFY**: `packages/server/src/routes/system-routes.ts::/api/health` — add `compatibility: BootstrapCompatibility | null` field to the response. Computed lazily per request via `readPiCompatibility(serverPkgJsonPath) + readCurrentPiVersion() + computeCompatibility()`. Cached for 30s (probe is non-trivial: registry resolve + file read).
- **VERIFY**: the dead-code exports in `pi-version-skew.ts` (`readCurrentPiVersion`, `readPiCompatibility`, `computeCompatibility`) all work as intended via a focused integration test against a real `node_modules` layout.
- **NO** revival of `/api/bootstrap/*`. The `compatibility` shape lives on `/api/health` directly. The `BootstrapCompatibility` type can stay named as-is (rename optional, but bigger blast radius).

### Phase 2 — Client surface

- **NEW**: `packages/client/src/components/PiVersionAdvisory.tsx` — a small banner-style component (NOT a top-of-app blocker). Renders:
  - **Hidden** when `compatibility` is null OR `compatibility.error` is absent AND `compatibility.upgradeRecommended` is false.
  - **Yellow soft-warning pill** when `upgradeRecommended: true` (running below `recommended`, but at-or-above `minimum`). Single line: "Pi <current> available: <recommended>. <Upgrade hint link>."
  - **Red below-minimum advisory** when `compatibility.error` is set. Single line + a "How to upgrade" disclosure with copy-paste-able npm command.
- **MOUNT POINT**: top of `SettingsPanel` Settings → General (NOT a full-app banner — pi 0.74 → 0.75 is a soft transition, not a blocker; if a future pi version is an actual blocker, a follow-up can promote it).
- **NEW**: `packages/client/src/hooks/usePiCompatibility.ts` — fetches `/api/health` every 60s and surfaces `.compatibility` reactively.

### Phase 3 — Tests + documentation

- **NEW**: `packages/server/src/__tests__/health-compatibility.test.ts` — integration test exercising the `/api/health.compatibility` field with three fixtures: pi-matches-recommended, pi-below-recommended, pi-below-minimum.
- **NEW**: `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx` — render snapshot per state (hidden / soft / hard).
- **MODIFY**: `docs/file-index-server.md` — `pi-version-skew.ts` row: drop the "(dead code)" implication; cite `restore-pi-version-skew-surface`.
- **MODIFY**: `docs/file-index-client.md` — add row for `PiVersionAdvisory.tsx` and `usePiCompatibility.ts`.

### Phase 4 — Per-session pi version (bridge-reported)

Reuses the existing per-session-observation idiom: the bridge already pushes `git_info_update` / `model_update` / `session_name_update`; the server stores each on the `DashboardSession` record and re-broadcasts to browsers. `pi_version_update` joins that family.

- **NEW protocol**: `interface PiVersionUpdateMessage { type: "pi_version_update"; sessionId: string; version: string }` in `packages/shared/src/protocol.ts`, added to `ExtensionToServerMessage`. Shape mirrors `GitInfoUpdateMessage`.
- **NEW field**: `DashboardSession.piVersion?: string` in `packages/shared/src/types.ts`.
- **NEW bridge helper**: `sendPiVersionIfChanged(bc)` in `packages/extension/src/model-tracker.ts`, mirroring `sendGitInfoIfChanged`. Reads `@earendil-works/pi-coding-agent/package.json` via `createRequire(import.meta.url).resolve(...)` (the bridge runs inside pi's tree, so resolution always succeeds — no registry / realpath / `.cmd` edge cases). Module-scoped `lastPiVersion` debounces; sends only on first read and on change. Read failure logs a warning and skips.
- **MODIFY bridge**: `packages/extension/src/bridge.ts` calls `sendPiVersionIfChanged` once in the `session_register` flow and on each existing git/model poll tick (`runGitPollTick`, 30s; no new timer).
- **MODIFY server**: `packages/server/src/event-wiring.ts` gains a `pi_version_update` arm next to `git_info_update`: `sessionManager.update(sessionId, { piVersion })` + `browserGateway.broadcastSessionUpdated(sessionId, { piVersion })`.
- **MODIFY client**: render `session.piVersion` as a read-only label where git branch / model already render in the session header; hidden when `undefined`.

## Capabilities

### Modified Capabilities

- `pi-core-version-check`:
  - `/api/health` SHALL include a `compatibility` field of shape `BootstrapCompatibility | null` (`null` when pi cannot be resolved).
  - A user-visible advisory in Settings → General SHALL render the same `compatibility` info: hidden / yellow soft hint / red below-minimum advisory based on the state.
- `bridge-extension`: bridge SHALL push `pi_version_update` for its session at register and on detected version change, sourced from inside pi's own process; server SHALL store it on the session and broadcast a session update.

## Impact

- **Code (Phases 1–3, global advisory)**: 2 server files (route handler + 30s cache), 2 client files (component + hook), 2 test files.
- **Code (Phase 4, per-session)**: `protocol.ts` (+1 message, +1 union member), `types.ts` (+1 field), `model-tracker.ts` (+1 helper), `bridge.ts` (2 call sites), `event-wiring.ts` (+1 arm), 1 client label, ~3 tests.
- **Tests**: +3 integration + +3 component (advisory) + ~4 (bridge helper / server arm / protocol round-trip).
- **Migration / compat**: pure additive — no API removed, no breaking shape. Existing `/api/health` consumers see one new optional field; older bridges simply never send `pi_version_update` and `piVersion` stays `undefined`.
- **Risk**: low. The advisory primitives already exist; the per-session report reuses a proven idiom (`git_info_update`). The 30s cache prevents per-request thrash.
- **Rollback**: remove the health field + delete the two client files; remove the `pi_version_update` arm + message. Advisory and label disappear, no orphan state.

## Out of Scope

- Reviving `/api/bootstrap/*`, `BootstrapBanner`, `useBootstrapStatus`, `bootstrap-state`, or any of the pre-R3 install machinery. The new surface is one health field + one Settings widget.
- Auto-upgrading pi when the user is below minimum. The existing pi-core-updater path handles that; this proposal only surfaces the *signal*.
- Programmatic refusal-to-spawn-sessions when pi is below minimum. Could be a follow-up, but the soft advisory + pi's own version assertions are likely enough today.
