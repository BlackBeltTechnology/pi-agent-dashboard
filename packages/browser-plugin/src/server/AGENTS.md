# DOX — packages/browser-plugin/src/server

Files in this directory. One row per source file. See change: add-browser-relay.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry `registerPlugin` — MINIMAL scaffold: logs activation, returns. Relay machinery (`relay-instance`/`relay-manager` wrapping `relay/vendor/playwright-core`, WS routes via `ctx.registerWsRoute`, REST `/api/browser/*`) = workstream 2c (tasks 2.3–2.11). |
| `relay/` | Vendored playwright-core relay tree — see `relay/AGENTS.md` and `relay/vendor/AGENTS.md` (never-edit rule, shims, refresh policy). |

Files in `__tests__/`:

| File | Purpose |
|------|---------|
| `vendor-integrity.test.ts` | Scenario X14/7.57. SHA-256 every file under `relay/vendor/playwright-core/` against `vendor-hashes.json` (set-equality: no edits, no additions); NOTICE carries upstream commit. Also pins shim contracts: `CDPRelayServer` constructs inert, `start()` rejects `not supported — transport is supplied by relay-instance.ts`; registry shim throws on launch; `ManualPromise` real (resolve/reject/isDone). node env. |
| `vendor-hashes.json` | Recorded hashes + `upstreamCommit` (`d1ead3ecca23182f2d06d761c28e3d4edafb6595`, 2026-09-11). Regenerate on refresh — see the embedded `$comment` recipe. |
