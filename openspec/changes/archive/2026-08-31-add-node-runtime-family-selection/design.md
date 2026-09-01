# Design — add-node-runtime-family-selection

Settled in the worktree implementation phase. Inputs: proposal "Section-0
outcomes", the cross-model adversarial review (`@propose-review-2`), and the
landed `unify-pi-runtime-identity` infrastructure.

## D1 — Peer-resolution seam: `StrategyDeps`, not `StrategyCtx`

The peer resolver is an OPTIONAL member of `StrategyDeps` (`resolvePeer`), never
`StrategyCtx`. Rationale:

- `strategies.ts` documents strategies as pure over `ctx`; `StrategyDeps` is the
  established injection seam (`exists`, `which`, `execPath`, `realpath`,
  `resolveModule`). A peer resolver is a dependency, not context.
- Optional + undefined-safe: every existing construction site keeps compiling;
  tests inject fakes; production binds once (D2).
- `npmCliBesideNodeStrategy` uses `deps.resolvePeer?.("node", "npm")` and falls back to
  `deps.execPath` — never a direct `process.execPath` read. Existence probes go
  through `deps.exists`.

## D2 — Binding site: `registerDefaultTools` inside `getDefaultRegistry()`

The production binding lives where the only non-test registry is built:
`index.ts` `getDefaultRegistry()` → `registerDefaultTools(defaultRegistry)`, now
passing a deps object whose `resolvePeer` closes over that registry instance.

- Re-evaluated per the proposal's note: the global-registry slot DOES have
  `resolve()`, but binding there is ambient and untestable per-caller; a
  factory-per-caller variant multiplies bindings. Binding at the default-registry
  construction gives exactly one production seam and lets tests construct the
  same way (`registerDefaultTools(reg, deps)` with injected deps) — the test in
  task 3b.2 asserts the production-shaped construction resolves through the peer.
- Re-entrancy guard: an in-flight `Set<toolName>` owned by the binding (module
  scope of `index.ts`, created with the deps). `resolvePeer("node")` during an
  in-flight `resolve("npm")` refuses (returns null → strategy falls back to
  `deps.execPath`) instead of re-looping. Preventive: `node`'s chain consults no
  peer today, and the registry cache is written only after the strategy loop
  (`registry.ts`), so a cache check alone cannot stop recursion. Accepted
  trade-off (review finding 10): cheap insurance, documented.

## D3 — Enumeration roots and entry probes (containment by construction)

Root types and their per-member entry-probe patterns (Unix / Windows):

| Root | Root dir | nodeEntry | npmEntry | npxEntry |
|---|---|---|---|---|
| bundled | `<resourcesPath>/node` | `bin/node` / `node.exe` | `bin/npm` / `npm.cmd` | `bin/npx` / `npx.cmd` |
| managed | `<managedDir>/node` | `bin/node` / `node.exe` | `bin/npm` / `npm.cmd` | `bin/npx` / `npx.cmd` |
| PATH | `dirname(which node)` | `<dir>/node` / `node.exe` | `<dir>/npm` / `npm.cmd` | `<dir>/npx` / `npx.cmd` |
| nvm | `~/.nvm/versions/node/vX.Y.Z` | `bin/node` / `node.exe` | same | same |
| fnm | `~/.fnm/node-versions/vX.Y.Z/installation` | `bin/node` / `node.exe` | same | same |
| volta | `~/.volta/tools/image/node/vX.Y.Z` | `bin/node` / `node.exe` | same | same |
| asdf | `~/.asdf/installs/nodejs/vX.Y.Z` | `bin/node` / `node.exe` | same | same |

- Each member is probed independently; a missing member leaves the entry absent
  (partial candidate surfaced, never discarded, never fabricated).
- The candidate root IS the table's root dir; entries are probed inside it, so
  "existing file inside the selected root" holds by construction. The validation
  gate (spec) rejects tampered/stale client-submitted paths.
- Windows note: nvm-windows/fnm/volta layouts put binaries at the version dir
  root; the `bin/` probe covers Unix layouts and both are probed where the
  manager is cross-platform (fnm, volta). asdf shims are NOT entries (shims are
  per-tool indirection); the real install dirs are.
- Root-set sharing (review finding 8): bundled/managed root helpers are the SAME
  functions the strategies use (`getManagedNodeBinDir`,
  bundled-resources helper); version-manager root globs live in ONE module
  (`node-installs/vm-roots.ts`) so the ladder's future vm enumeration and this
  module share a definition. Drift is guarded by the task-1.1 set test.

## D4 — Version sources (filesystem-only, optional)

| Root | Version source |
|---|---|
| nvm / fnm / volta / asdf | encoded in the version dir name (`v22.11.0`) |
| managed | `<managedDir>/node` metadata file written by the installer when present |
| bundled | metadata file beside the runtime when present |
| PATH | none — version absent |

No candidate ever spawns `node --version` (spec requirement). Absent version is
rendered as "unknown", never guessed.

## D5 — Migration (adopt a coherent trio) and the hand-set precedence

On first load of the picker surface: read the three override keys; resolve each
through the registry; if all three resolve into ONE candidate root, the picker
shows that installation as selected. Otherwise (no keys, partial, or
incoherent), the picker starts unset. Adoption writes nothing — it is display
only; persistence still happens on explicit selection.

Precedence on write (spec "hand-set member outranks the absent-member clear"):
a key counts as hand-set when its override exists AND its resolved path does NOT
belong to the currently selected candidate — reported pre-write, preserved
unless the user discards. The absent-member clear applies only to non-hand-set
keys.

## D6 — Coherence reporting

Mismatch = the resolvable members' paths resolve under more than one candidate
root. Legitimately absent member alone is not a mismatch. A hand-set member
whose root differs from the family's dominant root is named as the deviation.
The reporting consumes registry Resolutions (`tried[]` untouched — policy, not
lookup consolidation).

## D7 — Child-PATH consumer classes (post-ladder)

- **pi-session spawns** — governed by the landed ladder; the selection is its
  gated step-1 candidate (`readToolOverrideNode`). No change needed beyond the
  selection existing; spec reconciled.
- **dashboard-tooling spawns** (process-manager tool env builders, headless
  spawn) — prepend the SELECTED bin dir ahead of managed when a selection
  exists; unchanged otherwise; never mutate `process.env`.
- **managed-tree mutations** (pi-core-updater) — keep managed-first (landed
  requirement). EXCLUDED from selection.
- `prependManagedNodeToPath` gains a selection-aware wrapper (or parameter);
  the managed helper itself stays intact for the managed-tree consumer.
  Actual consumer list is verified at implementation time (review nit 12:
  server-launcher uses `buildSpawnEnv`, not this helper).

## D8 — Absorbed scope mapping (`fix-node-family-resolution-gaps` → here)

| Hotfix task | Lands here as |
|---|---|
| 1.1–1.8 (chain tests) | section 3a tests |
| 2.1–2.9 (badge tests) | section 3a tests |
| 4.1–4.3 (npx chain impl + reconcile) | section 3a impl |
| 5.1–5.3 (badge impl + i18n + path rule) | section 3a impl (i18n keys in en/zh-CN/hu) |
| 6.1–6.5 (spec alignment) | the absorbed `specs/tool-registry/spec.md` delta here; AGENTS.md rows at section 7 |
| 8.1 (manual badge check) | section 6 manual |
| 9.x (reporter close-out) | out of scope here — stays with the superseded change's reporter thread |

The hotfix change directory is removed at ship time (supersession).
