## 1. Tests first (TDD)

- [x] 1.1 In `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx`, add a failing case: `FlowAgentsToolRenderer` with `op:"list"` and a `result` string beginning with `«76 earlier lines hidden»\n{ …tail… }` (no `toolDetails`) → assert the card does NOT render "0 agents" and DOES render a truncated/expand indicator. Verify it fails against current code.
- [x] 1.2 Add a failing case: same truncated `result` but with a `toolDetails` prop carrying `{ count: 7, names: [...7...] }` (or a catalog array) → assert the card renders "7 agents" and the names from `toolDetails`.
- [x] 1.3 Add a regression case: a valid (untruncated) catalog array of N agents → still renders "N agents" and names (existing happy path unchanged).
- [x] 1.4 Add a case: genuine empty array `result === "[]"`, no `toolDetails` → renders "0 agents" (empty is legitimate, not the bug).

## 2. Implementation

- [x] 2.1 In `FlowAgentsToolRenderer.tsx`, extract a `deriveCatalog(result, toolDetails)` helper for the `op:"list"` branch implementing the fallback order from design Decision 3: (a) structured count/names from `toolDetails` when present; (b) valid-JSON parse of `result`; (c) truncation-marker guard; (d) empty only for genuine `[]`.
- [x] 2.2 Add the truncation-marker guard: match `/^«\d+ earlier lines hidden»\n/` on `result`; when matched and no `toolDetails`, return a `{ truncated: true }` sentinel instead of an empty catalog.
- [x] 2.3 Update the `op:"list"` JSX: render "N agents" + names when a count is known; render a "list · output truncated — expand" indicator (no "0 agents") when `truncated` and count unknown; keep "0 agents" only for the genuine-empty case.
- [x] 2.4 Add the `toolDetails` prop to the component's props type (optional, duck-typed `{ count?: number; names?: string[] } | unknown`); read it without assuming it exists (pi-flows does not emit it yet).

## 3. Verify

- [x] 3.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm all four new cases pass and no existing `authoring-renderers` tests regress (`grep -nE 'FAIL|✗' /tmp/pi-test.log`). — flows-plugin suite: 145/145 pass (10/10 in authoring-renderers); tsc --noEmit exit 0.
- [x] 3.2 Manual verification 2014 VERIFIED LIVE (superseded by flow-agents-readable-list): card never shows false "0 agents"; large catalog renders real count / expandable rows; "Show full output" reveals full JSON.
