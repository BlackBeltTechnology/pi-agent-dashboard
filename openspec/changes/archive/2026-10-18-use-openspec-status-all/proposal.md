## Why

The server re-implements OpenSpec's artifact status rules locally. `deriveArtifactStatus` is hardcoded to the four `spec-driven` artifacts, because the only CLI-authoritative path was one `openspec status --change <name>` spawn per change (the spawn storm). OpenSpec 1.11 ships `openspec status --all --json`, which returns every change's schema-aware status in ONE spawn:

| Measurement | macOS | Windows 11 VM |
|---|---|---|
| `status --all`, 102 changes | 1.25 s | ~2.9 s |
| Force refresh today | ~25 s | ~38 s |

Switching makes custom schemas work. It is also the prerequisite for a project workflow schema (`add-pi-spec-driven-schema`), whose extra artifacts the hardcoded derivation would mis-report.

## What Changes

- **One spawn per directory.** The gated poll and force refresh (including its error-recovery branch) spawn **one** `openspec status --all --json` per cwd, with a 30 s timeout. Today the gated path runs `openspec list` + local derivation and force refresh runs `1 + N` spawns. The no-`changes/`-dir short-circuit (no spawn) stays.
- **Local task counting.** `completedTasks`/`totalTasks`/`status` are computed in the poll worker with OpenSpec's own task-line rule and its file selection:
  - `apply.tracks` from a project-local schema, else artifact `tasks`;
  - every existing output is counted;
  - top-level `tasks.md` is the fallback.

  Measured 104/104 exact parity with `openspec list`. `openspec list` is no longer spawned on the `--all` path.
- **Envelope validation.** stdout and stderr are read regardless of exit code and classified:

  | Output | Result |
  |---|---|
  | Old CLI ("unknown option --all") | fallback path (checked first) |
  | No JSON, a top-level error `status`, `root: null`, or `root.source: "implicit"` | whole-call failure, handled exactly like today's failed CLI call (`initialized:false`, `cli-failed`, retried next tick) |
  | A single broken change (exit 1, full JSON) | per-change `error` (control characters stripped, message ≤ 500 chars on one line, code ≤ 64) instead of a blank directory |

  The force-refresh catch no longer falls back to the unbounded `pollOpenSpecAsync` fan-out.

- **Error surfaces.** New `OpenSpecChange.error?: { code, message }`:
  - the board card shows an error badge;
  - A broken attached change is blocked on every OpenSpec action surface (`deriveOpenSpecActions` consumers and `MobileActionMenu`): every rendered `PLANNING` candidate (Continue/Fast-forward) uses the surface's existing blocked rendering, and the OPENSPEC subcard shows a focusable error badge with the message.
- **Watcher and gate.** The recursive watcher stays on `<cwd>/openspec/changes/` (main specs are not watched). New watchers cover `openspec/config.yaml` and `openspec/schemas/**`. The filter also reacts to:
  - change-dir creation;
  - `.openspec.yaml`;
  - schema-declared outputs, matched against `artifactPaths.<id>.resolvedOutputPath` so not-yet-created outputs count;

  while keeping the legacy name filter for not-yet-known change dirs. The gate tracks the same set. Its `stat` probe runs in the poll worker (yielding async stats when the worker is off), and TOCTOU is preserved per change plus a cwd-level pre-call stamp.
- **Stable order.** `artifacts` use canonical order `proposal, design, specs, tasks`, then extra ids in CLI order, on both paths. Today the force path used CLI order. `changes` are sorted newest-first by tracked-file mtime, approximating `openspec list`.
- **Fallback.** A CLI that rejects `--all` ("unknown option") keeps today's path: `list` + local derivation, the per-change gate and TOCTOU. Detection is cached per installed package version, and the first detecting poll continues on the fallback immediately. The four legacy requirements stay, scoped to the fallback.
- **Unchanged.** Design/specs promote-only evidence overrides (R1/R2/R3), concurrency cap, jitter, worker-pool lifecycle.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `server-openspec-polling`:
  - `status --all` source;
  - envelope validation;
  - local task counting;
  - cwd-level gate and TOCTOU (worker-side);
  - watcher on `openspec/`;
  - fallback detection;
  - parity test;
  - legacy gate / TOCTOU / derivation / parity requirements scoped to the fallback;
  - per-turn attribution and the per-turn budget gain `dirPollGate` and `dirPollCli`.
- `openspec-readiness`: wording moves from `openspec list` to "the OpenSpec status call" (semantics unchanged).
- `openspec-detection`: design evidence post-processes the status-call output (`--all` or fallback). The inherited "regardless of the CLI's verdict" scenario is aligned with "never promote `blocked`".
- `openspec-board`: error badge on proposal cards.
- `openspec-frontend-actions`: a change with an error blocks its rendered `PLANNING` actions on every surface; the subcard badge carries the reason; streaming and attach-combo rules keep holding.

## Dependencies

- Blocked by: none.
- Blocks:
  - `add-pi-spec-driven-schema`: its schema adds artifacts the hardcoded derivation cannot see;
  - transitively, `add-openspec-change-dependencies`.

## Impact

- Shared:
  - `packages/shared/src/openspec-poller.ts`: build-from-`--all`, task counting, canonical order, change sort; `pollOpenSpecAsync` no longer used by the server;
  - `packages/shared/package.json`: add `yaml` (already 2.9.0 in the repo) for project-local `apply.tracks`;
  - `packages/shared/src/platform/openspec.ts`: `OPENSPEC_STATUS_ALL` recipe, stdout-on-failure handling;
  - `packages/shared/src/platform/runner.ts` (read-only use of the failed-exec stdout);
  - `packages/shared/src/types.ts` (`OpenSpecChange.error`).
- Server:
  - `packages/server/src/directory-service.ts`: poll paths, the force-refresh catch at `refreshOpenSpec`, `dirPollGate` turn;
  - `packages/server/src/openspec/`:
    - `openspec-poll-worker.ts` (probe + build requests);
    - `openspec-poll-worker-pool.ts`;
    - `openspec-poll-fs-helpers.ts` (`perChangeArtifactPaths`);
    - `openspec-change-watcher.ts` (`matchesOpenSpecArtifact`, extra `openspec/` + `schemas/` watchers);
    - `readiness.ts` comments.
- Client: board card badge (`OpenSpecBoardView.tsx`); `openspec-actions.ts` (`deriveOpenSpecActions`, new literal-reason field), consumed by `SessionOpenSpecActions.tsx` and `ComposerSessionActions.tsx`; `MobileActionMenu.tsx`; the OPENSPEC subcard error badge.
- Docs: `docs/architecture.md` "OpenSpec polling cost model" (DocScribe).
- Protocol: `openspec_update` gains one optional field; artifact order unchanged.

## Discipline Skills

- `performance-optimization`: spawn/latency budget on the poll path. Acceptance bar: before/after numbers on macOS and the Windows VM, including no-op-tick worker stat cost.
- `observability-instrumentation`: keep `DEBUG=pi-dashboard:openspec-poll` per-tick lines meaningful (spawn count, `--all` wall time, per-change error count, fallback state).
- `security-hardening`: CLI error text is broadcast to every paired (possibly remote) browser. It is capped and single-lined, and no stderr is forwarded.
- `systematic-debugging`: only if the parity test diverges; root-cause before adjusting the counting rule.
