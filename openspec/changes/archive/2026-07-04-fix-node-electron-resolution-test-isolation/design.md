## Context

`node-electron-resolution.test.ts` exercises the full `resolveExecutor("npm")` chain under a mocked "packaged Electron" layout. Path resolution (step 1) is properly isolated via injected `exists`/`which`. Argv assembly (step 2, `toArgv: nodeScriptToArgv`) is not: it reads live machine state through two seams the test cannot override.

```
resolveExecutor("npm")
   │
   ├─ step 1  resolve path ── injected exists/which ──▶ BUNDLED_NPM   ✅ isolated
   │
   └─ step 2  nodeScriptToArgv(BUNDLED_NPM)
                │
                ├─ resolveJsScript(BUNDLED_NPM) ── realpathSync ─▶ REAL DISK  ⚠️ leak A
                │      /Applications/PI-Dashboard.app installed → truthy scriptPath
                │
                └─ registry.resolve("node") fails under mock
                       └─ fallback: process.execPath ─▶ ~/.pi-dashboard/node/bin/node  ⚠️ leak B
```

Both leaks are machine-state, not repo-state, so worktrees/forks reproduce them. CI is green only because CI has neither the installed app (leak A) nor a managed node on `PATH` (leak B).

## Goals / Non-Goals

**Goals**
- Make `resolveExecutor` argv assembly deterministic under test — driven solely by injected deps.
- Keep all runtime behavior byte-identical on every platform, especially the Electron spawn path.

**Non-Goals**
- Do **not** change resolution ordering, strategy semantics, or the `process.execPath` runtime default.
- Do **not** fix the adjacent latent bug where `nodeScriptToArgv`'s execPath fallback under a *corrupted* Electron install could yield `[<Electron-binary>, script]` without `ELECTRON_RUN_AS_NODE=1`. That is a separate runtime concern; this change is test-isolation only. (Note it here so a future change owns it.)

## Decisions

### D1 — Injectable execPath fallback (default preserved)
Extend the `toArgv` context (`types.ts`) with an optional `execPath?: string`, threaded from `StrategyDeps`/registry construction, defaulting to `process.execPath`. `nodeScriptToArgv` uses `ctx.execPath ?? process.execPath`.

- Additive, backward-compatible: no caller passes it today → runtime identical.
- Electron already constructs resolvers with an explicit `processExecPath` (`ToolResolver`), so this aligns with the existing DI convention (`pick-node.ts` calls injected `processExecPath` the "sole allowed site").

### D2 — Route `resolveJsScript`'s realpath through the injected fs seam
`resolveJsScript` currently calls `realpathSync` unconditionally. Give it an injected `realpath`/`exists` seam (default real fs) so a fake `BUNDLED_*` path cannot dereference to a real on-disk script under test.

**D1+D2 are both required — not either/or.** D1 alone (or a test-side node mock) closes only leak B (the `process.execPath` fallback); leak A survives because `realpathSync` still dereferences the installed `/Applications/PI-Dashboard.app/.../npm` symlink to a real `npm-cli.js`, re-entering the node-wrap branch. The spec (`no realpathSync against the real filesystem` + scenario 1's no-real-path assertion) therefore mandates D1+D2 together. A test-side node mock may be added on top for extra determinism but does not substitute for D2.

### D3 — Electron-build safety (the explicit ask)
| Concern | Assessment |
|---|---|
| Runtime behavior under healthy packaged Electron | `bundledNodeStrategy("node")` resolves `<resourcesPath>/node/bin/node` → `registry.resolve("node")` succeeds → the touched execPath fallback never runs. **No change.** |
| execPath default | Preserved (`?? process.execPath`). Additive field. **No change.** |
| `no-electron-execpath-spawn` lint | Scans only `packages/electron/src/lib/**`; the edits live in `packages/shared/src/tool-registry/**`. **Not tripped.** Do not introduce a raw `process.execPath` under `electron/lib`. |
| Electron package/forge config | Untouched; no files under `packages/electron/` change. **No build-graph impact.** |

Conclusion: the fix cannot regress the Electron build or its runtime — it only adds an optional injection seam whose default equals today's behavior, on a code path healthy Electron never reaches.

## Risks / Trade-offs
- **Risk:** widening `StrategyDeps`/`toArgv` context ripples into other `toArgv` users (`pi`, `openspec`). Mitigate: field is optional with a real-`process.execPath` default; existing call sites compile unchanged.
- **Trade-off:** D2 adds an fs seam to `resolveJsScript`. Keep default = real `realpathSync` so production behavior is unchanged; the seam is exercised only by tests.

## Migration Plan
Pure internal refactor + test change. No config, no persisted format, no API surface. Ship in one PR; verify via the pre/post commands in `proposal.md` Verification.

## Open Questions
- None open on approach: D1+D2 is required (see D2) to satisfy the spec. Remaining choice is purely mechanical — whether the injected `execPath`/`realpath` seams live on the `toArgv` context, on `StrategyDeps`, or both. Settle during implementation.
