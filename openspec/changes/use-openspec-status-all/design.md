## Context

Poll pipeline today (`docs/architecture.md` → "OpenSpec polling cost model"):
1. mtime gate;
2. `openspec list` on the main thread, through the semaphore. Main-thread list-signal stats run at `packages/server/src/directory-service.ts:909-915`;
3. worker `deriveArtifactStatus`, hardcoded to `proposal/design/specs/tasks` with R1/R2/R3 and specs promote rules (`packages/shared/src/openspec-poller.ts:181-195`). Per-change stats run in the worker at `packages/server/src/openspec/openspec-poll-worker.ts:93,113`;
4. `buildOpenSpecData` → serialize → broadcast.

Force refresh spawns `openspec status --change X` for every change. On error, `refreshOpenSpec` falls back to `pollOpenSpecAsync` (`directory-service.ts:1170-1176`), which runs `list` plus an unbounded per-change fan-out that bypasses the semaphore. A failed CLI call blanks the cache to `initialized:false` (`directory-service.ts:918-933`).

Spike measurements (OpenSpec 1.11.0, this repo, 102–107 active changes):

| Command | macOS (Intel) | Windows 11 VM (2 vCPU, nested) |
|---|---|---|
| `openspec list --json` | 0.71 s | ~1.2 s |
| `openspec status --change X --json` | 0.70 s | ~1.1 s |
| `openspec status --all --json` | 1.25–1.33 s; 409 changes: 2.72 s (≈4.8 ms marginal per change) | ~2.9 s |
| local task count (OpenSpec rule), all changes | ~15 ms | — |

### CLI facts (verified in `node_modules/@fission-ai/openspec/dist`)

- **Status entry shape.** `formatChangeStatus` (`core/artifact-graph/instruction-loader.js:212-280`) emits `changeName, schemaName, planningHome, changeRoot, artifactPaths{<id>:{outputPath,resolvedOutputPath,existingOutputPaths}}, isPlanningComplete, isComplete, applyRequires, nextSteps, actionContext, artifacts[{id,outputPath,status,requires}]`.
  - It carries no `apply.tracks` and no task counts.
  - `existingOutputPaths` lists existing files only.
- **Ordering.**
  - Within a change, artifacts come in schema graph build order (`instruction-loader.js` `getBuildOrder`); for `spec-driven` that is `proposal, specs, design, tasks`.
  - `--all` sorts changes by name (`commands/workflow/status.js:63`).
  - `list` sorts them newest-first by `lastModified` (`core/list.js:80,111-112`).
- **Broken change.** The entry is `{changeName, status:[{severity:"error",code:"change_error",message}]}`; the process exits 1 with the rest of the JSON complete.
- **Whole-call failure** (`cli/index.js:40-47,590-598`; `commands/workflow/status.js:13-30`). Output is `{changes:[], root:null, status:[{severity:"error",…}]}`, exit 1.
- **Task progress** (`utils/task-progress.js:55-100`). OpenSpec counts across the matched files of the tracked artifact. When nothing resolves, it falls back to the top-level `tasks.md`; this also applies to broken changes, which `openspec list` still lists and counts.

## Goals / Non-Goals

**Goals:**
- One CLI spawn per cwd per gated tick and per force refresh. No respawn and no fan-out on failure.
- Schema-agnostic artifact status (custom schemas, extra artifacts), with canonical artifact order and `list`-compatible change order.
- A single broken change never blanks the directory, and a whole-call failure is never mistaken for "no changes".
- Watcher and gate see every artifact the schema declares, plus edits to metadata, config and schemas. No filesystem work moves onto the main thread, and the main specs are not watched.
- Older CLIs keep working through a specified fallback.

**Non-Goals:**
- Removing the design/specs promote-only overrides (R1/R2/R3); that belongs to `add-pi-spec-driven-schema`.
- Changing the stepper's four segments, the semaphore, jitter, or the worker-pool lifecycle.
- Session ↔ change attachment detection (`openspec-activity-detector.ts`).

## Decisions

### D1. `status --all` is the single status source on both paths

```mermaid
sequenceDiagram
  participant M as Main thread
  participant W as Poll worker
  participant CLI as openspec status --all
  M->>M: dirPollPre: openspec/changes exists? (else missing-changes-dir, no spawn); emit pending if cold
  M->>W: probe(tracked paths)  [in-process async stats when useWorker=false/unhealthy]
  W-->>M: effective mtimes per change + cwd-level
  M->>M: dirPollGate: compare with cache; unchanged -> reuse; else spawn
  M->>CLI: spawn under semaphore (30 s timeout)
  CLI-->>M: stdout + stderr (any exit code)
  M->>W: dirPollCli: build(stdout, stderr, pre-mtimes)
  W-->>M: fallback/envelope class, post-mtimes + racy set, counts, sorted data, serialized
  M->>M: dirPollPost: stamp non-racy (cwd stamp = pre-call), prune deleted, broadcast
```

Alternatives considered:
- Make the local derivation schema-aware by reading `schema.yaml`. Rejected: it re-implements OpenSpec's graph a second time.
- Deep-import OpenSpec's `artifact-graph`. Rejected: it is not in the package `exports` map, so it is internal API.

### D2. Local task counting replaces `openspec list`; change order matches `list`

- **Line rule.** Copy OpenSpec's `TASK_LINE_PATTERN` (`/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/`). It counts every match, including fenced and indented lines.
- **File selection** mirrors `findTrackedTasksArtifact` and `resolveTaskFilesForChange` exactly:
  1. Determine `apply.tracks` by OpenSpec's resolution order (`resolver.js:114-196`): the project-local `openspec/schemas/<name>/schema.yaml`, then the user dir `$XDG_DATA_HOME/openspec/schemas/<name>/schema.yaml`, then the built-in (`spec-driven` tracks `tasks.md`). The first existing file wins for any name, so a project-local or user `spec-driven` shadows the built-in. Files are parsed with `yaml` (added to `packages/shared`; already 2.9.0 in the repo) and memoized by mtime.
  2. Pick the tracked artifact. If `apply.tracks` is set, it is the artifact whose `outputPath` equals it (none matching means no artifact). If absent, it is the artifact with id `tasks`.
  3. Sum the checkboxes across that artifact's `existingOutputPaths`.
  4. If nothing resolves, count the top-level `tasks.md`.
- **Not `parseTasksMarkdown`.** That is the task-editor parser; it matches column 0 only and miscounts 2 of 104 changes that have indented sub-tasks.
- **Change order.** The probe enumerates `changes/*` itself (excluding `archive/`), so every change has a probe mtime, including changes on a cold cache and changes created since the last poll. Sort `changes` by that effective mtime, newest first, ties broken by name. This approximates `list`'s order, which uses a recursive mtime over every file (`core/list.js:27-50`). The board re-sorts on the client anyway (`openspec-board-order.ts`).

### D3. Envelope validation

The recipe returns raw stdout, plus stderr for non-zero exits (taken from the failed-execution result; on exit 0 the runner only passes stdout to `parse`, `runner.ts:524-526`). It does NOT use a `tolerate` path, because that drops stderr (`platform/runner.ts:343-346,522`) and D6 needs stderr. JSON parsing and classification run in the worker build request, not in the runner's exit handler on the main thread; the payload is roughly 300–400 KB.

Classification order:
1. The D6 fallback test.
2. **Whole-call failure** when there is no JSON, a top-level `status[severity=error]`, `root === null`, or `root.source === "implicit"`. It is handled exactly like today's failed CLI call: cache blanked, `cli-failed`, and the next gated tick retries. Today's failure path clears `listResult` (`directory-service.ts:928-930`), so it also respawns once per tick per cwd: one retry per tick, not a storm. A transient failure (e.g. a cold-boot timeout under semaphore contention) self-heals on the next tick. The pending flap during a persistent outage (`emitPendingIfDiscovered`, `directory-service.ts:1344-1355`) is pre-existing and out of scope.
3. Otherwise, success.

Per-change error entries map to `error`. Entries with neither `artifacts` nor `status` map to `error` with code `unknown-entry`.

Sanitization before broadcast:
- control characters are stripped;
- `message` is one line of at most 500 characters;
- `code` is at most 64 characters.

Paths inside messages stay visible to paired clients, as cwd paths already are.

### D4. Tracked set and watchers

**Gate tracked set.** Stats run in the worker probe, or as yielding async stats in-process when the worker is off or unhealthy.
- cwd level: `openspec/` itself, `changes/`, `config.yaml`, and every directory and file under `schemas/`. Directory mtimes catch deletions and renames that a max-over-files misses.
- Per change:
  - the change dir and `.openspec.yaml`;
  - the legacy fixed set;
  - each path in `existingOutputPaths`, plus its parent dir;
  - for non-glob outputs, the `resolvedOutputPath` and its parent dir, so a not-yet-created output is detected when it appears;
  - for glob outputs, the static prefix dir.

CLI paths are relativized against `root.path` exactly as emitted (the CLI already canonicalizes it with `realpathSync.native`; a second JS `realpath` can disagree on Windows) and separator-normalized. The server canonicalizes its own `<cwd>/openspec/` once with `realpathSync.native` and maps CLI-relative paths onto it; a path that would escape is ignored. This covers server cwds that are aliases (macOS `/tmp` → `/private/tmp`, Windows subst/junctions, worktrees under symlinks). Symlinked subdirectories inside a change are not followed. Glob outputs track their static prefix plus every directory beneath it. Before the first successful result, or after a failure, the per-change set is the legacy fixed set for every enumerated change dir. The force path uses the same probe and build requests. In-process mode (worker off or unhealthy) does all file I/O as bounded async I/O.

**Watchers.**
- Keep the recursive watcher on `openspec/changes/`. The root is unchanged, so the main-spec tree (~741 dirs here) is not watched.
- Add a non-recursive watcher on `openspec/` for `config.yaml`.
- Add a recursive watcher on `openspec/schemas/` when it exists.

The watcher filter is the union of:
- creation or rename of a change dir;
- the legacy names and `.openspec.yaml` under any `changes/<x>/`, which keeps push-refresh working for brand-new changes;
- for known changes, a glob match against each `artifactPaths.<id>.resolvedOutputPath`;
- `config.yaml`;
- `schemas/**`.

### D5. TOCTOU around one call

- Pre-call mtimes come from the probe and post-call mtimes from the build request; both run in the worker.
- A change is racy when pre ≠ post. A racy change keeps its previous entry and stamp.
- The cwd-level stamp is the pre-call value. It does not advance if a cwd-level path changed during the call.
- A change in the result with no pre-call mtime (created between probe and spawn) is applied but left unstamped, so it is re-polled once on the next tick.
- Changes deleted during the call are pruned; pruning beats preservation.

### D6. Fallback detection

- **Detection.** A call that yields no JSON, with stderr or stdout matching `/unknown option ['"]?--all/i` (commander's wording), marks the CLI as unsupported. This test runs before envelope classification.
- **Cache key.** The result is cached per resolved CLI installation: `realpath` of the resolved binary or script (`tool-registry/definitions.ts:682-710`, incl. PATH/`where` symlinks to the shim), then walk up to the nearest `package.json` named `@fission-ai/openspec`, and key by its `version`. If none is found, the result is cached for the process lifetime and re-evaluated on every force refresh. The shim's mtime is never a key, because upgrades don't touch it (here its mtime is Jul 20 vs Aug 30 for `dist/`).
- **First detection.** The poll that first classifies the CLI as unsupported continues on the fallback path in the same poll, so an old CLI is never shown as `cli-failed` (e.g. cold-boot `refreshOpenSpec`, `session-bootstrap.ts:112`).
- **Unsupported path.** Today's path runs unchanged, governed by the four fallback-scoped requirements. The legacy force path already honours the semaphore.
- **Force-refresh catch.** The `refreshOpenSpec` catch no longer calls `pollOpenSpecAsync` (an unbounded fan-out that bypasses the semaphore). A failure is a whole-call failure, with no respawn. The server no longer uses `pollOpenSpecAsync` at all.

### D7. Canonical artifact order

On both paths the server emits `proposal, design, specs, tasks` (those present), followed by other ids in CLI order. Today the gated path already uses this order, but the force path broadcasts the CLI's `proposal, specs, design, tasks`. D7 removes that inconsistency; consumers such as `ArtifactLetters` render in array order.

## Risks / Trade-offs

- **Gated tick costs more on Windows** (~2.9 s vs ~1.2 s for `list`). Mitigation: it runs only when the gate trips, and off the main thread. Force refresh drops from ~38 s to ~2.9 s.
- **A no-op tick stats ~8–10 paths per change** (~1 000 stats per cwd at 107 changes). Mitigation: the stats run in the worker. Tasks measure this on macOS and on the Windows VM; any reduction of the tracked set needs a spec change first.
- **User-level (`XDG_DATA_HOME`) schemas are outside the gate and watchers.** Installing a missing schema there only clears the per-change error on the next tracked change or a force refresh. Accepted and documented.
- **Counting-rule drift** if OpenSpec changes `TASK_LINE_PATTERN` or its file selection. Mitigation: a parity test against `openspec list`, with a bounded pool, skipping only when the CLI is absent.
- **A schema-declared artifact that is not done keeps the change `PLANNING`** (`deriveChangeState`, `types.ts:1258-1267`), while the 4-segment stepper shows P/D/S as done. This is the correct semantics; explaining the extra artifact in the UI is scoped to `add-openspec-change-dependencies`.
- **Very large repos** (≈4.8 ms marginal per change on macOS). Mitigation: a 30 s timeout. Revisit above ~1000 active changes.
- **User-level (`XDG_DATA_HOME`) schemas are not read for `apply.tracks`.** Accepted: counting falls back to the `tasks` artifact or `tasks.md`, and the parity test excludes those changes.

## Migration Plan

No feature flag: support detection for `--all` is the switch. Rollback = revert. The data shape stays backward compatible: `error` is optional and the gated-path order is unchanged.

## Open Questions

_None._
