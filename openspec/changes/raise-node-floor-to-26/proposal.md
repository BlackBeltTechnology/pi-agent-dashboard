> **STATUS: DRAFT. Do not apply before 2026-10-28 (Node 26 Active LTS), and only after
> `strip-only-native-ts-loader` has shipped.** Spec deltas are intentionally not written yet; they
> depend on the open questions in `design.md`. `openspec validate` will flag this change until
> they are.

## Why

`default-node-24-keep-22-floor` (archived 2026-06-28) explicitly deferred raising the Node floor
to *"its own change"*, because it is a louder, user-facing decision. This is that change.

Node 26 becomes Active LTS on 2026-10-28; Node 24 enters maintenance on 2026-10-20, and Node 22 is
already in maintenance (EOL 2027-04-30). Source: `nodejs/Release` `schedule.json`. After
`strip-only-native-ts-loader`, the loader no longer *needs* Node 26. The remaining reasons are
narrower:

- The nodejs/node#58515 workarounds become dead code. The affected ranges (22.0–22.18.x,
  24.1–24.2.x) lie entirely below 26. This covers the `isAffectedNode` ranges and the
  `preload-fastify.cjs` CJS preload injected at every server spawn site.
- One supported Node line instead of three shrinks the smoke matrix and the version-gate surface.

These are maintenance benefits, not user-facing ones. Whether they outweigh dropping Node 22 and
24 users is the decision this draft has to justify.

## What Changes

- **BREAKING:** `engines.node` goes from `>=22.19.0 <27` to `>=26.0.0 <27` (exact 26.x minimum
  to be decided) in the root `package.json` and `packages/server/package.json`;
  `node-version.ts` `MIN_SUPPORTED_NODE` changes to match; `node-guard` refuses older Node at
  startup.
- **Bridge auto-start resolves a Node that meets the floor** instead of always using pi's
  `process.execPath`. pi itself still supports Node ≥22.19, so a pi session on Node 22 or 24 can
  no longer spawn the server with its own Node. This reuses the `managed-node-runtime` resolution
  order in the bridge → server direction, and when nothing qualifies it shows a visible notice in
  pi's TUI.
- Electron bundled Node (`_node-version.sh` `BUNDLED_NODE_VERSION`) moves from v24.15.0 to v26.x;
  Docker base image `node:24-bookworm-slim` → `node:26-bookworm-slim`; CI `node-version: 22` → 26;
  `_smoke.yml` matrix drops 22, 24 and 25.
- Remove the nodejs#58515 mitigation: `isAffectedNode` ranges and `preload-fastify.cjs`
  injection (pending verification that 26 does not need it).

## Capabilities

### New Capabilities
<!-- none expected -->

### Modified Capabilities (expected; deltas pending)
- `server-startup-node-version-guard`: floor raised; affected-range predicates removed.
- `pi-core-version-check`: "Node engines floor tracks pi minimum" changes, since the dashboard floor now sits deliberately above pi's floor. The stale `<25` scenario text is also fixed.
- `bundled-node-runtime` / `electron-node-runtime-selection`: bundled Node ≥ floor.
- `managed-node-runtime`: the resolution order also governs the bridge → server direction.
- `bridge-extension`: auto-start runtime resolution and the no-qualifying-Node notice.
- `server-launch`: CJS preload for Fastify removed (if confirmed).

## Impact

- **Users:** anyone running `pi-dashboard` from npm on Node 22 or 24 must upgrade Node; Electron
  users are unaffected (bundled Node). A pi session on Node 22/24 auto-starts the server only if a
  Node 26 is resolvable (managed, PATH, version manager).
- **Release:** a major version bump under SemVer. Release notes have to lead with it.
- **Code:** `packages/shared/src/node-version.ts`, `packages/server/src/auth/node-guard.ts`,
  `packages/shared/src/platform/preload-fastify.ts` and its four spawn sites,
  `packages/extension/src/server-launcher.ts`, the shared runtime-resolution code (currently
  server-side), `packages/electron/scripts/_node-version.sh`, `docker/Dockerfile`, workflows.

## Discipline Skills

- `doubt-driven-review`: an irreversible, public, user-breaking support-policy change.
- `observability-instrumentation`: the new bridge → server runtime resolution needs a visible
  outcome (TUI notice, Doctor row, `server.log` line) so a refused auto-start is diagnosable.
- `performance-optimization`: runtime resolution runs at every pi session start (bridge); latency
  budget required.
- `review-code`: before commit.
