## 1. Shared edge derivation

- [x] 1.1 Inspect `FlowState.dagSteps` shape and the `FLOW_EVENT_MAP` passthrough to confirm whether running events carry `branches` / `on_complete` / `on_error`; record the finding (resolves the design Open Question) — **pi-flows `flow:flow-started` emits `branches` but NOT `on_complete`/`on_error`; loops derive from backward branches. Design + spec updated.**
- [x] 1.2 Add `deriveFlowEdges(steps)` returning `{ from, to, label?, kind, backward }[]` over the minimal step shape `{ id, type, blockedBy, branches?, onComplete?, onError? }`; fold the implicit-segment logic in and de-duplicate (prefer branch/route over sequential) — `packages/flows-plugin/src/client/flow-edges.ts`
- [x] 1.3 Unit-test the helper: four edge classes, backward flag, duplicate collapse, route-only-when-present, missing-endpoint skip, parity — `flow-edges.test.ts` (6 tests)

## 2. Live FlowGraph

- [x] 2.1 Extend `FlowGraphStep` to carry `branches` sourced from `dagSteps`; drop `loopTarget`/`flow-ref`
- [x] 2.2 Route `computeLayout` edge creation through `deriveFlowEdges`; emit labeled decision-branch edges; backward branches render as loop arcs (labeled); remove the old `loopTarget` loop logic
- [x] 2.3 Update `FlowGraph.test.ts` for branch edges + backward loop edge; drop `flow-ref` expectations

## 3. Static Mermaid snapshot

- [x] 3.1 Route `flowToMermaid` through `deriveFlowEdges`; emit implicit-segment and `on_complete`/`on_error` edges; backward edges dashed; remove `flow-ref` node shape; keep `return null` degrade
- [x] 3.2 Test: routing edge (route wins de-dup), implicit-segment edge, no `flow-ref` shape — `flow-yaml-parse.test.ts`

## 4. Flow agent tool-call icon

- [x] 4.1 Add `hideToolStatusIcon?: boolean` to `MinimalChatView`; thread into `ToolCallEntry` and pass `hideStatusIcon` to the `toolCallStep` primitive call
- [x] 4.2 Add `hideStatusIcon?: boolean` to `ToolCallStep` (default `false`) + `UiToolCallStepProps`; skip the leading `<Icon>` when set
- [x] 4.3 `FlowAgentDetail` passes `hideToolStatusIcon` to `MinimalChatView`
- [x] 4.4 Test: `hideStatusIcon` removes the leading glyph; default keeps it — `ToolCallStep.test.tsx`

## 5. Remove subflow (flow-ref) surface

- [x] 5.1 `packages/shared/src/types.ts`: drop `"flow-ref"` from `NodeKind`, remove `flowRefSteps` from `FlowState`, add `branches` to `dagSteps`, drop `flow-ref` from `ArchitectDagStep.stepType`
- [x] 5.2 `packages/flows-plugin`: remove `flow-ref` from `FlowGraph.tsx` (`FlowStepType`, `mapStepType`, both `flowStateToGraphSteps` paths), `flow-yaml-parse.ts` (`nodeShape`), and `flow-reducer.ts` (`stepTypeToNodeKind`); capture `branches` in the reducer's `dagSteps`
- [x] 5.3 Fold the `flow-ref`-free separator/implicit logic into the shared `deriveFlowEdges` helper (defined once)
- [x] 5.4 Update `FlowGraph.test.ts` and `flow-yaml-parse.test.ts` to drop `flow-ref` / subflow cases
- [x] 5.5 Reworded the lone remaining `flow-ref` doc comment so the gate (task 7.1) is clean

## 6. Subflow tab navigation

- [x] 6.1 Verified: `flowStates` is keyed by `flowName` and grows with multiple top-level flows per session — subflows were NOT its only producer
- [x] 6.2 N/A — tab bar retained (another producer exists)
- [x] 6.3 Tab bar KEPT; subflow-specific wording stripped from `FlowDashboard`; finding recorded in design.md

## 7. Verify

- [x] 7.1 `grep -rn "flow-ref\|flowRefSteps" packages/flows-plugin/src packages/shared/src` returns nothing functional; `tsc --noEmit` clean on all touched files (2 pre-existing unrelated errors in `plugin-config-write.test.ts`); affected suites green (flows-plugin 94, ToolCallStep 30, flow-edges 6)
- [x] 7.2 Manual: run the capabilities self-test flow — live graph shows fork/decision branch edges, no subflow node; `flow_write` snapshot matches; agent detail tool rows have no leading icon (deferred — requires a live pi-flows session)
