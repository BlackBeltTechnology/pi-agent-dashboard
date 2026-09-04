# Test Plan — add-automation-folder-scope-contribution

Stage: proposal   Generated: 2026-07-24

All scenarios route to **L1 vitest** (`packages/automation-plugin/src/server/__tests__/`
or `src/__tests__/`): a pure in-process server change — no rendered UI, no multi-OS
runtime, no latency budget. Exemplars: collector → `action-registry.test.ts`; watcher →
`automation-watcher.test.ts`; engine wiring/`listScopes`/arm → `engine.test.ts`;
fake-`ctx.consumeAll` wiring → `flows-run-finalizes-on-forwarded-completion.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Contribution axis collection | EP | L1 | automated | entries `[{key:"automation.folderscope.a", value:{base:"/repo"}}]` | `collectFolderScopeBases(entries)` | returns `["/repo"]` (path.resolve'd); base is unioned into `folderScopeBases()` |
| E2 | Opt-in validation — bad shapes | EP+BVA | L1 | automated | values `{base:""}`, `{base:"  "}`, `{base:42}`, `["x"]`, `null`, `{}` (no base) | `collectFolderScopeBases(entries)` | every entry ignored → returns `[]`; exactly one warn per bad key |
| E3 | Valid + invalid mix isolates | EP | L1 | automated | `[{k1:{base:"/a"}},{k2:{base:""}},{k3:{base:"/b"}}]` | `collectFolderScopeBases(entries)` | returns `["/a","/b"]`; k2 warned; valid survivors collected |
| E4 | Dedup by resolved path | BVA | L1 | automated | entries `{base:"/a"}` and `{base:"/a/"}` + a live session cwd `/a` | `folderScopeBases()` | exactly one `/a` folder scope (Set dedupe by resolved path) |
| E5 | path.resolve throws is guarded | BVA | L1 | automated | value `{base:"\u0000/bad"}` (path.resolve throws) | `collectFolderScopeBases(entries)` | ignored via try/catch, no throw propagates; warned once |
| E6 | Warn once per key across reads | state | L1 | automated | one malformed entry `{badkey:{}}` | call collector 3× (simulating repeated `listScopes()` reads) | warn emitted **exactly once** for `badkey`, not 3× |
| E7 | Contributed base == home dropped | decision-table | L1 | automated | contributed base resolves to `homeDir`; global scanning enabled | `folderScopeBases()` / union | home base absent from the folder set; its automation arms under `global` only, never as `folder` |

### Frontend-quirk

_None — no rendered-UI or WS-driven surface in this change._

### Performance

_None — no latency/throughput budget. Hot-path warn-spam is guarded by E6 (warn-once), asserted as an edge-case, not a perf threshold._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unwatchable contributed dir degrades | fault-injection (throw) | L1 | automated | contributed base whose `fs.watch` on `<base>/.pi/automation` throws (EACCES) | `attachWatchers()` | `attach` returns false, warned once (`failedOnce`), scan + arm of that scope still succeed — watch failure is non-fatal |
| X2 | Contributed base with no automation dir | fault-injection (ENOENT) | L1 | automated | contributed base lacking `.pi/automation` | `engine.refresh()` scan | scanner yields zero automations, no crash; watcher attach fails silently; other scopes unaffected |

### State-transition (boot anchor + non-goal boundary)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| I1 | Zero-session boot arm | state-transition | L1 | automated | tmp repo with enabled `.pi/automation/intake/automation.yaml`; `consumeAll` → `{base: tmpRepo}`; **no** session cwds | engine init → `engine.start()` → `refresh()` + initial `attachWatchers()` | `intake` is scanned + armed (`scheduler.armAll` includes it) AND a watcher is attached to `<tmpRepo>/.pi/automation` |
| I2 | Idempotent union with session cwd | decision-table | L1 | automated | contributed base == a live session cwd | `folderScopeBases()` → `listScopes()` → refresh + attach | exactly one folder scope and one watcher for that base (no duplicate scan/arm/watch) |
| I3 | Nav-pin never arms | EP | L1 | automated | a pinned (navigation) directory present in config; **not** published as `automation.folderscope.*` | `folderScopeBases()` | pinned path absent from the scope set → not scanned, armed, or watched |
| S1 | Post-boot zero-session live-add not armed | state-transition | L1 | automated | `ctx.provide("automation.folderscope.x", {base})` called **after** `engine.start()`; zero sessions; no watched-file change | no re-arm trigger fires | base is **not** armed (documented boundary) — asserts the non-goal, not a defect |

---

## Coverage summary

- Requirements covered: 3/3 (contribution axis; opt-in validation; boot-anchor/no-retract/live-add-out-of-scope)
- Scenarios by class: edge 7 · perf 0 · frontend 0 · error 2 · state-transition 4
- Scenarios by level: L1 13 · L2 0 · L3 0
- Scenarios by disposition: automated 13 · manual-only 0

## New infra needed

- none — all scenarios extend existing `automation-plugin` vitest suites (collector → `action-registry.test.ts` pattern; watcher → `automation-watcher.test.ts`; engine wiring → `engine.test.ts`).
