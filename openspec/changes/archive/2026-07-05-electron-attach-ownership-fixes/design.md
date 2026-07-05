# Design — Electron attach-mode ownership hardening

## Context

Four loosely-related issues all stem from one observation: **`launchSource` is a static label set from `DASHBOARD_STARTER` at spawn time, and ownership decisions made outside `decideShutdownOnQuit` either don't consult it or trust it past its useful lifetime.** This change adds two cheap dynamic signals to `/api/health` (`ppid`, `activeBridgeCount`) and uses them to fix the tray ownership bug, detect zombies, surface version skew, and label orphaned bridge-spawned servers honestly.

## Goals / Non-Goals

**Goals**
- Tray must never offer a "Restart" action that could nuke a server Electron doesn't own.
- After an Electron crash on POSIX, the user has an in-app affordance to clean up or adopt the leftover server.
- The Electron app surfaces (via Doctor, at minimum) when its bundled shell version doesn't match the server it's attached to.
- `launchSource` consumers can distinguish a bridge-started server with a live pi session from one whose pi session has long since quit.

**Non-Goals**
- Auto-killing zombies without user consent.
- Title-bar pill or startup modal for version skew (Doctor-only first).
- Changing the existing `decideShutdownOnQuit` invariant.
- Refactoring `launchSource` to a fully dynamic field. The static label remains meaningful for the original `decideShutdownOnQuit` rule, which is scoped to "did *this* Electron lifetime spawn it".

## Ownership classifier — single rule, three consumers

The classifier lives in `server-lifecycle.ts` as a pure helper, alongside the existing `decideShutdownOnQuit`. Same module, same testing pattern.

```ts
export function decideOwnership(params: {
  healthLaunchSource: LaunchSourceEffective | null; // null = server unreachable
  healthPid: number | undefined;
  storedSpawnedPid: number | null;
}): "electron" | "foreign" | "none" {
  if (params.healthLaunchSource === null) return "none";
  if (params.storedSpawnedPid === null) return "foreign";
  if (params.healthLaunchSource !== "electron") return "foreign";
  if (params.healthPid !== params.storedSpawnedPid) return "foreign";
  return "electron";
}
```

**Why use `launchSourceEffective` not `launchSource` here:** an orphaned bridge server reports `launchSource: "bridge"` and `launchSourceEffective: "bridge-orphaned"`. Either string falls into the `!== "electron"` clause, so both classify as foreign — same outcome. But future surfaces (e.g. "your bridge session ended" pill) need the orphan distinction, so the effective field is the right input throughout.

**Three consumers, one classifier:**

```mermaid
flowchart LR
  A[/api/health<br/>launchSourceEffective, pid] --> B[decideOwnership]
  C[storedSpawnedPid] --> B
  B --> D[Tray: render menu]
  B --> E[Zombie modal: gate]
  B --> F[Doctor row: choose suggestion text]
```

## Zombie detection — cross-platform, opt-in adoption

**Windows still has the Job Object as first line of defence:** `spawnDetached({ detach: false })` keeps the server inside Electron's global Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), which the OS terminates with the parent — including on forced/abnormal exit (`taskkill /F`, crash), because terminating a process closes its handles, closing the job's last handle. So on the **common** Windows crash path no zombie forms. Detection is the safety net for the bypass cases (`CREATE_BREAKAWAY_FROM_JOB`, nested-job assignment failure on locked-down/CI hosts, self-respawn outside the job).

On macOS/Linux, `detach: false` only means "don't `child.unref()`" — the OS-level tree relationship doesn't survive an abnormal Electron exit, and the detached child is reparented to a subreaper.

### The detection signals (three health fields)
- `bootParentPid` — captured ONCE at server boot (module-load const). The Electron PID the server was spawned under.
- `ppid` — the server's **live** parent PID, read fresh per health request (POSIX signal only).
- `bootParentAlive` — whether `bootParentPid` is still the *same* live process it was at boot (Windows signal + POSIX guard).

### `bootParentAlive` — two-tier computation (folds Tier 1 + Tier 2)

Windows never reparents an orphan (the recorded parent PID dangles at the dead value), so the POSIX "ppid changed" signal is unavailable there. The only Windows signal is **liveness of the original parent** — which runs into Windows PID reuse. Hence two tiers, chosen server-side by capability:

| Tier | Mechanism | PID-reuse safe? | Deps | When |
|------|-----------|:---:|------|------|
| **1** (baseline) | `isProcessAlive(bootParentPid)` — existing `platform/process.ts` (`process.kill(pid,0)`) | ❌ (recycled PID reads "alive" → under-detects; never mis-targets) | none | every platform, always |
| **2** (Windows upgrade) | boot: `OpenProcess(SYNCHRONIZE, false, bootParentPid)` → hold handle; per request: `WaitForSingleObject(h, 0) === WAIT_OBJECT_0` ⇒ that exact process exited | ✅ (kernel pins the object while the handle is held) | `koffi` (optional) | `win32`, when `koffi` + `OpenProcess` succeed |

Tier 2 falls back to Tier 1 if `koffi` fails to load or `OpenProcess` is denied — so the server always reports a `bootParentAlive`, degrading gracefully rather than throwing. `koffi` (v3, 0-dep, prebuilt Win x64/arm64, actively maintained) is the chosen FFI; `ffi-napi` is effectively unmaintained and `ps-list`/`pidtree` can't supply a reuse-proof identity on Windows (`fastlist.exe` returns pid/ppid/name only; wmic-based trees are removed in Win11 24H2).

### Packaging & loader (Windows Tier 2)

koffi ships **prebuilt binaries in its npm tarball** (`koffi/build/koffi/win32_x64/koffi.node`, etc.) — no node-gyp/compile at install. Delivery on Windows is a solved problem in this repo because of two existing facts:

1. **The server ships outside asar.** `forge.config.ts` packages the app with `asar: true`, but the dashboard server is an `extraResource` (`resources/server/`) — a plain directory whose `node_modules/` are materialized by `bundle-server.mjs`'s `npm install --omit=dev` (which installs optionals). So koffi's `.node` lands as a normal file: **no `asarUnpack`.**
2. **The server runs under bundled standalone Node, not Electron's process.** koffi's prebuilt targets standard Node N-API — **no `electron-rebuild`, no ABI mismatch.**

Precedent: `node-pty` (also native) already ships this exact way, guarded by a GO/NO-GO prebuild assertion in the bundle scripts. koffi mirrors it — an assert on `resources/server/node_modules/koffi/build/koffi/win32_x64/koffi.node` turns a dropped-prebuild regression into a build failure instead of a silent Windows-wide Tier-1 downgrade.

**jiti interaction (low risk, guarded).** The bundled server executes TS via jiti (`node --import <jiti>`). jiti transforms first-party TS but passes `node_modules` native addons through to Node's native `require`/`process.dlopen` untouched — proven here by `node-pty` loading successfully under the same loader. Two guardrails make koffi's load robust regardless: (a) load via `createRequire(import.meta.url)("koffi")` (bypasses jiti ESM-interop wrapping, resolves from the bundled tree — the same `createRequire` pattern `server.ts` uses for the client), with `mod.default ?? mod` to absorb default-interop; (b) use only **synchronous** koffi calls (`WaitForSingleObject(h, 0)`), so koffi's async worker thread never enters the picture. The whole load sits in a try/catch that degrades to Tier 1, so even an unforeseen jiti/koffi edge case cannot break `/api/health`.

### `decideIsZombie` — platform-branched, one shared field

- **Common gates:** `launchSourceEffective === "electron"` AND `storedSpawnedPid === null`.
- **POSIX:** AND `ppid !== bootParentPid` AND `bootParentAlive === false` (reparented away *and* original parent gone).
- **Windows:** AND `bootParentAlive === false` (no ppid signal; liveness is the whole test).

**Two traps this avoids (both flagged in doubt-driven review, confirmed cross-model):**
1. **Never cache `process.ppid`.** Node's `process.ppid` is a cache-on-first-access getter and does NOT reflect reparenting. A module-cached `ppid` stays pinned to the original (now-dead) Electron PID forever, so `ppid === 1` never becomes true — zombie detection would silently no-op on every POSIX system. The live per-request read (Linux `/proc/self/stat` field 4; macOS `ps -o ppid=`) is load-bearing.
2. **Never test `ppid === 1`.** Modern Linux user sessions run under a subreaper (systemd `--user` calls `PR_SET_CHILD_SUBREAPER`), and containers reparent to a non-1 init. Orphans do NOT reliably adopt PID 1. Comparing against the known `bootParentPid` + liveness is subreaper- and container-safe; macOS (launchd = PID 1) is a special case of the same rule.

```mermaid
sequenceDiagram
  participant E1 as Electron v1
  participant S as Server
  participant E2 as Electron v2 (next launch)
  participant U as User

  E1->>S: spawn (detach:false, DASHBOARD_STARTER=Electron)
  Note over S: bootParentPid = E1.pid<br/>ppid = E1.pid
  E1->>E1: SIGKILL (crash)
  Note over S: orphaned → reparented to subreaper<br/>live ppid ≠ bootParentPid; E1.pid now dead
  E2->>S: GET /api/health
  S-->>E2: {launchSource: "electron", pid, bootParentPid: E1.pid, ppid: <subreaper>}
  E2->>E2: decideIsZombie: ppid≠bootParentPid AND !isPidAlive(bootParentPid) → true
  E2->>U: showMessageBox("Leftover server...")
  U-->>E2: "Take ownership"
  E2->>E2: setSpawnedPid(health.pid)
  Note over E2,S: Future quit triggers shutdown
```

**Why the modal, not silent adoption:**
- A user might *want* the leftover server (e.g. running another Electron instance via dev script, or about to launch a `pi` session against it). Silent adoption races with that.
- "Stop now" gives a clean reset path: kill it, spawn fresh.
- "Leave running" preserves the current zero-action behaviour for users who don't care.
- The in-memory `askedThisSession` flag prevents re-prompting if the user cancels via Esc/close-button on the dialog (which Electron returns as the "default cancel index").

**Why opt-out via `--no-zombie-prompt`:** QA tests need to attach to known-state servers without modal interference. Same pattern as other Electron debug switches in this codebase.

## `launchSourceEffective` — why a derived field, not a mutated label

Two reasons to keep `launchSource` static and derive `launchSourceEffective`:

1. **`decideShutdownOnQuit` semantics.** Its rule is *"did this Electron lifetime spawn the server?"* The original `launchSource === "Electron"` check is correct as-is. Promoting a stale `"bridge"` to `"bridge-orphaned"` doesn't change the answer (still not Electron) but introducing label mutation invites bugs where the original spawner identity is lost.
2. **Race window.** During a server restart (the bridge `server_restarting` flow), the server reboots and the bridge reconnects within 1–5 s. If we promoted `bridge → bridge-orphaned` instantly on bridge disconnect, we'd flap the field during every restart. The 30 s grace window on the derived field avoids this without complicating the persistent label.

**Why 30 s, not 5 or 60:** the longest observed bridge reconnect after `server_restarting` in the test suite is ~8 s on a cold-cache JIT path. 30 s gives 3× headroom. Shorter risks flap; longer delays the "this is orphaned" signal to the point of uselessness.

## Tray contract — the `"foreign"` row decision

`buildTrayMenuTemplate`'s current contract is binary (run/not-run). The fix introduces a third state but the menu shape stays simple:

| ownership | First item |
|-----------|------------|
| `"electron"` | `Restart server` (enabled, click → `onLaunch(true)`) |
| `"none"` | `Start server` (enabled, click → `onLaunch(false)`) |
| `"foreign"` | `Server managed externally` (disabled, no click handler) |
| `"unknown"` | *(item omitted)* |

**Alternative considered:** show `"Server managed externally"` as the menu's *title* row (no separator) plus the existing Start/Restart actions disabled. Rejected — Electron tray menus don't have a native "title" concept on macOS/Linux, and rendering a disabled "Restart server (managed externally)" is more confusing than a single informational line.

**Alternative considered:** offer a "Stop external server" action under `foreign`. Rejected for v1 — this would let the tray nuke a user's `pi-dashboard start` terminal session or a peer pi session's bridge-started server with one misclick. Can revisit with a confirmation modal in a follow-up.

## Doctor row — why versioned suggestions

The version-skew check is wired into the **Electron arm only**. Wiring it into the server arm would be a loopback tautology — a server comparing its own pkg version to its own `/api/health` always matches, giving false coverage. Skew is only observable across the Electron-shell ↔ attached-server boundary.

The version-skew row's `suggestion` field varies by `launchSource` because the fix path is different in each case:

- `standalone`: the user installed pi-dashboard via npm; the upgrade path is `npm i -g`.
- `bridge` / `bridge-orphaned`: the server was spawned by a (possibly defunct) pi session; upgrading the Electron app doesn't help until that server stops and Electron can launch its own bundled one.
- `electron`: another Electron instance is the owner; either quit it, or use the zombie modal if applicable.

Single hard-coded suggestion would mislead at least two of the three cases.

## Trade-offs & risks

- **Adding fields to `/api/health` is a forever-supported contract.** We're adding five (`bootParentPid`, `ppid`, `bootParentAlive`, `activeBridgeCount`, `launchSourceEffective`). Mitigation: each one has a clear, narrow consumer; `launchSourceEffective` is the only derived-union value and its rule is small and pure; `activeBridgeCount` reuses the existing `pi-gateway.connectionCount()` (no new gateway surface); `bootParentAlive` is a single boolean whose computation is isolated in `boot-parent-liveness.ts`. Health tests assert presence.
- **`koffi` is an optional native FFI dep (Tier 2).** Risk: a native module raises the server package's install/build surface. Mitigation: it is an *optional* dependency, loaded lazily only on `win32`, behind a try/catch that degrades to Tier 1 (`isProcessAlive`). If `koffi` is absent, un-prebuilt for the arch, or `OpenProcess` is denied, detection still works PID-reuse-vulnerably rather than failing. Windows ARM64 note: verify `koffi` prebuilt availability; fall back to Tier 1 otherwise. The Job Object remains the first-line guarantee regardless of tier.
- **Modal-on-launch is intrusive.** Mitigated by `askedThisSession`, by the `--no-zombie-prompt` switch for QA, and by the fact that real users rarely hit Electron crashes. If telemetry showed the modal firing more than a few percent of launches, we'd revisit.
- **`storedSpawnedPid` is module-private.** Adding a read-only accessor (`getStoredSpawnedPid`) for the tray probe widens the module's surface slightly. Acceptable: it's still pure-read, and the alternative (passing the pid through every callsite) is worse.

## Open questions

- ~~Should the zombie modal's "Stop now" path re-enter `selectLaunchSource()`?~~ **Resolved (doubt-driven review):** re-enter `selectLaunchSource()`, then **reload the BrowserWindow after a positive health probe against the fresh server**. The window loaded the soon-to-be-killed server's URL before the modal fired, so the reload is mandatory — otherwise "Stop now" leaves the user on a connection-refused page.
- Should `launchSourceEffective` also promote stale `electron` (other-Electron-leftover) to a new value like `"electron-orphaned"`? Currently the zombie modal handles this case, so a separate label seems redundant. Could revisit if non-Electron consumers (e.g. server-side update strategy) need to distinguish.
