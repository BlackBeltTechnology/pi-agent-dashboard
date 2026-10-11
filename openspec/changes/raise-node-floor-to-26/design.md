> **DRAFT.** This captures the exploration from 2026-10-11. Nothing here is decided.

## Context

**Node release state (2026-10-11, `nodejs/Release` `schedule.json` + nodejs.org `index.json`):**

| Line | Status | Next | EOL |
|---|---|---|---|
| 22 "Jod" | Maintenance LTS | — | 2027-04-30 |
| 24 "Krypton" | Active LTS (24.21.0) | Maintenance 2026-10-20 | 2028-04-30 |
| 26 | Current (26.11.1) | **Active LTS 2026-10-28** | 2029-04-30 |

**Verified on Node 26.11.1:** `node-pty` 1.2 (N-API), `sharp`, and `node:sqlite` load and run;
`fs-xattr` / `macos-alias` are build-time only (pulled in by `appdmg`). `module.register` emits
DEP0205 (handled by `strip-only-native-ts-loader`). Transform-mode type stripping is gone (also
handled there).

**Which Node runs the server today:**

| Launch path | Node | Source |
|---|---|---|
| Electron | bundled `BUNDLED_NODE_VERSION` (v24.15.0) | `packages/electron/scripts/_node-version.sh` |
| `pi-dashboard` CLI | the user's Node (`process.execPath` of the wrapper) | `packages/server/bin/pi-dashboard.mjs:251` |
| Bridge auto-start | **pi's** Node: `launchDashboardServer` defaults `nodeBin` to `process.execPath` (`packages/shared/src/server-launcher.ts:232`), and the bridge passes none (`packages/extension/src/server-launcher.ts:162`) | — |

pi declares `engines.node >=22.19.0` (`@earendil-works/pi-coding-agent@1.0.0`). With a 26 floor,
a pi session on 22 or 24 would spawn a server that `node-guard` refuses. Today that would be a
silent auto-start failure, visible only in `server.log`.

**Existing building block:** `managed-node-runtime` "Spawn-runtime resolution ladder"
(`openspec/specs/managed-node-runtime/spec.md:111`). The order is override → user Node
(PATH / login shell / version-manager probe) → managed `~/.pi-dashboard/node` → own runtime, with a
version gate. It is total and covers server → pi-session spawns only.

## Goals / Non-Goals

**Goals:** a single supported Node line; bridge auto-start never spawns a server that will refuse
to start; removal of the 22/24-specific workarounds.

**Non-Goals:** changing pi's own Node requirement; changes to the loader (done in
`strip-only-native-ts-loader`).

## Decisions (proposed, not settled)

- **D1:** apply the ladder in reverse for bridge auto-start, gated on `MIN_SUPPORTED_NODE`. Step 4
  (`process.execPath`) is used only if it passes the gate; if nothing passes, do not spawn and
  show a pi TUI notice: *"dashboard needs Node ≥26; found <ver> (pi's). Install Node 26 or the
  desktop app."*
- **D2:** remove `preload-fastify.cjs` only after a 26-only boot-plus-Fastify-reload test proves
  nodejs#58515 does not apply.

## Open Questions

1. **Is it worth it?** After `strip-only-native-ts-loader`, Node 26 no longer unblocks anything
   for users; the gain is maintenance. Alternative: keep the floor at 22.19 until Node 22 EOL
   (2027-04-30), then raise it to 24.
2. **Ladder location:** the ladder lives in server code, but the bridge runs before any server
   exists. Can it move into `packages/shared` (next to `tool-registry`) without pulling in server
   dependencies?
3. **Bridge latency:** a login-shell probe at every pi session start costs about 100–500 ms. Should
   the bridge use only PATH, the version-manager filesystem probe and the managed runtime (no
   shell)?
4. **Exact minimum:** 26.0.0, or a later 26.x carrying a specific fix?
5. **Docker / `node:26-bookworm-slim`:** availability and glibc parity for the `node-pty` prebuilds.
6. **pi-core-version-check:** its requirement currently says the floor *tracks* pi's minimum. It
   needs rewording to "≥ pi's minimum", and its stale scenario (`<25`, actual `<27`) has to be fixed
   either way.
