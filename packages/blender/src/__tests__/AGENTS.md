# DOX — packages/blender/src/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `cli.test.ts` | `pi-blender` dispatch + exit codes (E56, incl. `bin/pi-blender --help`/no-arg/`render` from a plain shell), `ensure` probe native/flag/unavailable × fetch spy + `--json` jspi field + failures → 69 (E57), `status` empty cache + throwing fetch, zero fetch, `--json` shape (E58), no implicit registration (E62). See change: add-blender-wasm-mcp. |
| `helpers/fake-host-kit.ts` | Test kit around `fake-host.mjs`: temp dirs, real `Supervisor` with every effect injected, call spies, host JSONL log, `cleanupAll()`. |
| `helpers/fake-host.mjs` | Scripted fake Blender host (real child process speaking the host IPC); behaviour from the JSON file in `FAKE_HOST_CONFIG` (boots, steps, delays, exits, files). |
| `helpers/fake-supervisor.ts` | In-process scripted stand-in for `Supervisor`: records requests, runs `stage` at dequeue, answers from a function. For MCP-layer-only tests. |
| `helpers/mcp-client.ts` | Client for the real `bin/pi-blender mcp` (launcher → server → host): line-framed JSON-RPC, `descendants`, `hostPidBelow`, `isAlive`, `waitUntil`. |
| `helpers/provision-child.ts` | Child process for the concurrent-commit test (E13): provisions once from a local tarball behind a barrier dir. |
| `helpers/runtime.ts` | Real-runtime gate: `describeReal` (runs only with `BLENDER_WASM_E2E=1` and JSPI; else skipped with reason), `classifyGate`, `TEST_CACHE` (`<tmp>/pi-blender-wasm-test-cache`), `REAL_TIMEOUT_MS`. |
| `helpers/socket-guard.cjs` | `NODE_OPTIONS` preload logging every listen/connect/dgram/WebSocket call to `BLENDER_WASM_GUARD_LOG` (no-listener / no-outbound assertions). |
| `helpers/tar-fixtures.ts` | Hand-written ustar/PAX/GNU tar writer + fixture runtime tarball with real pinned layout (`makeRuntimeFixture`, `pinFor`, `sha512Integrity`). |
| `jobs.test.ts` | Python job wrappers + `interpretResponse`/`tailBytes`/`stripProtocolNoise`: pure units, no runtime (E24). |
| `jspi-gate.test.ts` | X21: real JSPI probe + empty cache → `blender_scene` is `jspi-unavailable`, nothing downloaded (applies on Node 22 legs; skips itself on Node 24+). |
| `mcp-register.test.ts` | `mcp --register`: create/merge (E59 `blender` entry byte-equal, E60 `enabled`/`env` kept), `--root` realpath (E61), unsafe targets byte-identical + exit 1 (E63; symlink cases skip without privilege on Windows), notes + project-root warning (E64). |
| `packaging.test.ts` | `npm pack` file list (dist bundles, launcher, skill, no tests/AGENTS), bundles self-contained, `npm install` of the tarball into a temp prefix → `.bin/pi-blender status` exit 0 from a plain shell with no tsx (E67). |
| `probe.test.ts` | JSPI probe classification with injected spawn results (native / flag / unavailable), `resolveHostEntry`, `hostArgv`. |
| `provision.test.ts` | Provisioning: pin, cache root, tar guard, download bounds, integrity, atomic commit, override, repair, reporting (E1–E9, E11, E13–E18, X1–X3). |
| `real-binary.test.ts` | L1-real: real `pi-blender mcp` against the real pinned runtime (E10, E12, E26–E44, E50, E51, P1–P3). `describeReal`-gated. |
| `real-lifecycle.test.ts` | L1-real: launcher → server → host process tree: isolation, cancel, timeout, boot repair, crash recovery, idle, shutdown, SIGKILL of launcher (X4–X24). `describeReal`-gated; socket-guard self-test always runs. |
| `security.test.ts` | MCP-layer hardening: path confinement (absolute, `..`, symlink), size limits, env knobs only lower (E45, E46, E49, E52). |
| `skills.test.ts` | `blender` skill: frontmatter `name: blender`, description names headless Blender / 3D modelling / GLB export, body covers registration, limits, `sessionReset`, `inputs`, GLB-first, tools, CLI commands exist (E65). |
| `supervisor.test.ts` | Supervisor vs a scripted fake host: sessionReset, queue bounds, serial execution, cancel, timeout scope, boot failure + repair, crash, JSPI gate, idle, lazy start (E25, E53, X8–X20). |
| `workspace.test.ts` | Confinement, input staging, all-or-nothing output commit (E47, E48 + edge cases). |
