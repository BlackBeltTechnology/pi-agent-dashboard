# Fix npx managed-runtime gap and rejected-override visibility

## Why

A user on a Linux AppImage build reported that the dashboard "does not pick up the
node path" and that `npx` "still points to Node 22" after switching to Node 24.
Their Settings → Developer options table showed:

| row | result |
|---|---|
| `node` | not found |
| `npm` | not found |
| `npx` | `/home/t/.nvm/versions/node/v22.23.2/bin/npx` |

The reporter's environment is not accessible. **Neither defect below is claimed to be
the cause of that report** — see "Relationship to the report". Investigating it
surfaced two defects provable by inspection, which stand on their own merits.

### 1. `npx` cannot follow a managed Node runtime

`npxBinaryDef`'s chain omits `managedRuntimeStrategy` (`definitions.ts:263-272`).
`managedBinStrategy("npx")` probes `<managedDir>/node_modules/.bin/npx`;
`managedRuntimeStrategy` probes `<managedDir>/node/bin/npx`. Different directories —
so an installed managed Node runtime is visible to `node` and `npm` and invisible to
`npx`, which falls through to PATH. `managedRuntimeStrategy` already accepts `"npx"`
(`strategies.ts:286-289`), so this is a one-line wiring gap. Platform-independent.

### 2. A rejected override is invisible on rows that fail to resolve

The UI already handles the **resolved** case: `ToolsSection.tsx:238-241` computes
`invalidOverride` from `tried[]`, `:331-334` renders an inline amber warning, and
`:294-299` renders the full trail **including the offending path**. But `StatusBadge`
(`:457-473`) gates the amber indicator on `tool.ok && invalidOverride`, so on a
**not-found** row it falls through to a plain red-X — visually identical to a tool
that was never configured. A user whose override was rejected *and* whose fallback
also missed gets no collapsed-row signal and must expand the row to find out. That is
exactly the reporter's row state.

*This is a badge-gating defect, not a missing feature.* The payload
(`ToolListEntry extends Resolution`, `tried[]` via `/api/tools`), the inline warning,
and the trail render already ship and are NOT rebuilt here.

### Spec drift found while scoping

- The `npm strategy chain` scenario (`spec.md:109-112`) lists a `managedBin` step
  that exists in npm's chain on neither platform, and omits the win32-only
  `npmCliBesideNode` step.
- `spec.md:350` carries stale archived-change text asserting "This proposal does not
  modify the `npx` registration" alongside the pre-fix chain, which defect 1
  contradicts.

Both are documentation-only corrections with no code change.

## Relationship to the report

Defect 1 is **not** the reported symptom, despite matching its wording. Its mechanism
requires a managed Node runtime to be present; the report shows `node` = not found,
which means no managed runtime was visible to any family member in that snapshot. The
reporter's `npx` = v22 is fully explained by ordinary PATH fallback with no managed
runtime installed. **Fixing defect 1 will not change their `npx` row.**

What this change does for the report is defect 2: it makes a rejected override visible
on a not-found row, so the next such report arrives with the answer on screen instead
of costing a diagnostic round-trip.

## What Changes

- **FIX** the `npx` strategy chain to include `managedRuntime` between `bundled-node`
  and `managedBin` — matching **`node`'s** chain. (Not npm's: npm has no `managedBin`
  step. The chains are not being unified, only made managed-runtime-aware.)
- **FIX** `StatusBadge` so the rejected-override indicator renders on unresolved rows,
  with the rejected path in the tooltip. Scope: the gating condition and tooltip
  content only.
- **ALIGN** the drifted spec: the `npm` and `npx` chain scenarios, and the stale
  `spec.md:350` note.

## Not in scope

- **The Windows `npm` anchoring defect.** `npmCliBesideNodeStrategy`
  (`definitions.ts:614-627`) is documented as resolving node "via the global registry
  hook" but reads `process.execPath`, so it can select `npm-cli.js` from a different
  installation than the resolved `node`. Fixing it requires a peer-resolution seam
  that does not exist (`StrategyCtx` carries no registry), a production wiring
  decision (`registerDefaultTools` is called with no deps at `index.ts:36`, so a
  `StrategyDeps`-only seam would be inert in production), and a re-entrancy guard at
  the binding site. That is design work on the "same installation" invariant, which is
  the subject of `add-node-runtime-family-selection` — **moved there**.

- **Root-causing the reporter's `node`/`npm` not-found rows.** Note this is NOT a
  closed question: `whereStrategy` filters PATH hits through `isAppImageSelfHit`
  (`strategies.ts:478-481`), and the AppImage runtime prepends its squashfs mount to
  PATH, so Rule 2 (APPDIR-prefix) discarding a mount-resident `node` is a live
  candidate mechanism. What remains unexplained by any code path is `npm` failing
  while `npx` succeeds from the same nvm directory. Settling it needs the reporter's
  `tried[]` trail.

- **Unifying `tried[]` strategy names.** `managedRuntimeStrategy`,
  `managedBinStrategy`, and `npmCliBesideNodeStrategy` all report `name: "managed"`
  (`strategies.ts:292`, `:405`, `definitions.ts:615`), so after defect 1 lands an
  `npx` trail shows two indistinguishable `managed` rows while the spec scenarios use
  labels (`managedRuntime`, `managedBin`) that never appear in `tried[]`. This
  degrades the diagnostic surface in the same change that argues for better
  diagnosability — flagged as an open question rather than silently widened.

## Open questions

- Disambiguate `tried[]` strategy names now (making the trail match the spec's labels
  and keeping defect 2's diagnosability goal coherent), or defer? Deferring keeps this
  surgical but ships a knowingly ambiguous trail.

## Discipline Skills

- `systematic-debugging` — Task 1 pins each defect with a failing test first. Two
  earlier drafts of this proposal asserted defects that did not survive contact with
  the source (a UI surface that already shipped, and a `LazyRegistry` shape read from
  the wrong file); evidence-before-claim is the operative discipline.
- `review-code` — change spans `shared` + `client`.
- `observability-instrumentation` — defect 2 is a diagnosability gap on the exact row
  state users report from.
