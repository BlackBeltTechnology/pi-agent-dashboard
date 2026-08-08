# Test Plan — cleanup-import-cycles

Stage: design   Generated: 2026-08-06

## ⚠ Clarifications needed (1)

- [ ] **C1** — Blocks **E8**. D3 routes the four pseudo-tab kinds
  (`diff`/`url`/`live-server`/`terminal`) around `CappedViewer`, which today
  size-gates them (`CappedViewer.tsx:35-51` probes `/api/file`, renders
  `TooLargePreview` above `MAX_PREVIEW_BYTES`). After the split they lose that
  gate. What SHALL an oversized pseudo-tab do — render unconditionally, or keep a
  gate relocated into `DiffViewer`/`DiffPanel`? Implementation must first
  establish what `/api/file?path=diff:<rel>` returns today (likely a miss → size
  0 → gate never fires, making the removal a no-op), then fix the observable.

> Resolve before E8 can be authored. All other rows are unblocked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Terminal gate: cycles → 0 | exhaustive | ci | automated | whole repo after all five cuts | `npx biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000` | `Found 0 warnings`; exit 0. Nonzero = fail (no partial credit) |
| E2 | D1 `isLoopback` extracted, semantics preserved | EP | L1 | automated | each member of `LOOPBACK_ADDRESSES`; a non-loopback `203.0.113.1`; `undefined` | call `isLoopback` from its new leaf module | `true` for every set member, `false` for `203.0.113.1` and `undefined` — identical to pre-extraction results |
| E3 | D1 guard + block-events unchanged | regression | L1 | automated | existing `localhost-guard.test.ts` + `tunnel-block-events.test.ts` suites, import paths updated | run both suites | all assertions pass unchanged; no re-export edge left behind in `localhost-guard.ts` |
| E4 | D2 `formatCost` extracted, not conflated | BVA (the $1 boundary) | L1 | automated | `0`, `0.005`, `0.999`, `1`, `1.5`, `1234.567` | call extracted `formatCost` | **hybrid precision, exactly as `FlowAgentCard.tsx:27-29` today: `n >= 1 ? toFixed(2) : toFixed(4)`.** So `$0.0000`, `$0.0050`, `$0.9990`, `$1.00`, `$1.50`, `$1234.57`. An always-2-decimal implementation is a **sub-dollar rendering regression**, not a simplification |
| E5 | D3 split is total and disjoint | exhaustiveness | L1 | automated | both registry halves + the `OPEN_PATH_VIEWERS` / `PSEUDO_TAB_VIEWERS` const arrays from the `viewer-kinds.ts` leaf | `Object.keys(a)` ∪ `Object.keys(b)`, compared against the const arrays | union === all **18** members (14 + 4); intersection empty; each half's `Record` total over its own subset. **`ViewerKind` is a type with no runtime representation and `packages/shared` is out of scope, so the test enumerates the const arrays — the four `_AssertNever` checks in `viewer-kinds.ts` (`_Uncovered`, `_NoExtraOpen`, `_NoExtraPseudo`, `_NoOverlap`) are what prove those arrays exactly cover and partition the union.** Assert `Object.keys(half) === [...array]` so a registry gap fails at runtime and an array/union drift fails at `tsc`. The checks MUST use `_AssertNever<T extends never>`; the `const _x: T[] = []` form is vacuous and proves nothing |
| E6 | D3 kinds land in the right half | decision-table | L1 | automated | all **18** `ViewerKind` members | look each up | the **14** `fileKind()`-returnable kinds resolve from half (a) and are **absent** from (b); the 4 pseudo-tab kinds (`diff`/`terminal`/`url`/`live-server`) resolve from (b) and are **absent** from (a). Half (a) MUST include `binary-warn` and `monaco` — both are `fileKind()`-returnable and are the two most likely to be dropped |
| E7 | D3 size gate preserved for real files | BVA | L1 | automated | `size` = `MAX_PREVIEW_BYTES-1`, `= MAX_PREVIEW_BYTES`, `= MAX_PREVIEW_BYTES+1`, for a non-`monaco` file-kind viewer | mount `CappedViewer` | first two render the viewer; third renders `TooLargePreview`. `monaco` bypasses at all three |
| E8 | D3 oversized pseudo-tab | BVA | L3 | automated | a `diff:` tab whose content exceeds `MAX_PREVIEW_BYTES` | open the tab | [NEEDS CLARIFICATION: observable — see C1] |
| E9 | D4a `isExternalHref` extracted, semantics preserved | EP | L1 | automated | `https://example.com/x`; a same-origin absolute URL; `#anchor`; `undefined` | call from its new leaf module | `true` only for the cross-origin URL; `false` for same-origin, fragment-only, `undefined` — identical to pre-extraction |
| E10 | `isolatedModules` respected | static | ci | automated | all five extracted leaf modules | `tsc --noEmit` | exit 0; every type re-export uses `export type` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | D3 diff tab still renders | state-transition | L3 | automated | a session with a diff | open a `diff:` tab in the editor pane | `DiffPanel` body renders; no blank pane, no `<undefined/>` React throw, no console error |
| F2 | D3 other pseudo-tabs still render | decision-table | L3 | automated | a `url:` tab, a `live:` tab, a `term:` tab | open each | each converges to its own body (url viewer / live-server viewer / terminal keep-alive layer); none renders the file-kind path |
| F3 | D4b linkification survives at every **real** context builder | decision-table | L1 | automated | the contexts returned by the extracted `makeToolContext(...)` builder in **both** its production configurations (`App.tsx:1126`-style with `cwd`, and `main.tsx:112`-style cwd-less) — called directly, **not** re-declared as fixtures; plus a bare embedder `ToolContext` rendered through `ChatView`; plus no context at all | render `MarkdownContent` with markdown containing a file mention, in a `p`, an `li`, **and an inline `code` span** | a `FileLink` is produced for the first three (embedder via `ChatView`'s merged default) at all three markdown positions; plain text when no context — matching today. **The builder must be the extracted shared function that production actually calls** — a hand-declared fixture object verifies only that `MarkdownContent` honours the field, not that production attaches it, and stays green through the exact regression this row exists to catch |
| F4 | D4b `hostManaged` dual-mode preserved | state-transition | L1 | automated | a `FileLink` inside a `FilePreviewProvider`, and one outside it | click to open a preview | inside: `hostManaged` true, exactly one overlay rendered by `FilePreviewHost`, leaf renders none. Outside: leaf-local overlay renders. Zero double-mounts |
| F5 | D4b preview survives message churn | state-convergence | L3 | automated | open file preview in chat, then stream new messages | message list re-renders / remounts | overlay stays open on the same target — the `fix-file-preview-survives-message-churn` invariant is unbroken by the inversion |
| F6 | D4a external-link hardening preserved | decision-table | L1 | automated | external URL, same-origin URL, fragment-only, loopback URL | render markdown containing each | external gets `target="_blank" rel="noopener noreferrer"`; fragment + same-origin stay in-document; loopback click opens the split live-server viewer |
| F7 | D2 flow agent surfaces still render | regression | L1 | automated | a flow agent with cost `>= 1` and one with cost `< 1` | render `FlowAgentCard` and `FlowAgentDetail` | both mount; cost renders identically in each, at 2 decimals for `>= 1` and 4 decimals for `< 1` (per E4); no circular-import `undefined` component |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D3 `DiffFilePreview` missing-file path intact | fault-injection (abort) | L1 | automated | `GET /api/file` returns 404 / non-file | open diff "Preview" mode | `data-testid="diff-preview-not-found"` renders; panel does not crash — unchanged by the registry split |
| X2 | D3 an unregistered kind cannot ship | static | ci | automated | four mutations, each checked separately: (a) a `ViewerKind` member in neither const array, (b) a spurious member in `OPEN_PATH_VIEWERS`, (c) a member in BOTH arrays, (d) a `ViewerKind` member missing from a half's `Record` | `tsc --noEmit` | compile error for every one — (a) via `_Uncovered`, (b) via `_NoExtraOpen`, (c) via `_NoOverlap`, (d) via that half's total `Record`; never a runtime `undefined` lookup. **Verify the checks actually fail closed** rather than assuming: the `const _x: T[] = []` form compiles for all four mutations and is worthless. Also assert **no new `as`/`as never` cast** at the `CappedViewer` call sites |
| X3 | Production bundle builds and boots | integration | ci | automated | full repo after all cuts | `npm run build`, then **load the built bundle in the harness browser** | build exits 0; app boots with no module-evaluation `undefined` binding error in console. **`vite build` alone does NOT satisfy this row** — it compiles without executing, so it cannot observe an eval-order defect. If the boot step is not wired, X3 is a compile gate only and F1/F2 become the sole eval-order oracle |
| X4 | `ToolContext` public surface not broken | static | L1 | automated | an embedder building a `ToolContext` without `fileLink`, rendered through `ChatView` | typecheck + render | compiles (field optional); linkification still works via `ChatView`'s merged default — **not** via `chat-embed/index.ts`, which is a type-only re-export barrel and can attach nothing; `chat-embed/index.ts:39-40` doc-comment no longer lists the non-existent `editors` field |

### Manual

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | No visual regression on the touched surfaces | visual/subjective | — | manual-only | markdown-heavy chat transcript, file-preview overlay, the 4 pseudo-tab kinds, flow agent card/detail | human compares against `develop` | [judgment: renders look unchanged — no automatable observable] |

---

## Coverage summary

- Requirements covered: 10/10 (D1, D2, D3, D4a, D4b, terminal gate, no-behaviour-change, `hostManaged`, `isolatedModules`, bundle build)
- **L3 is REQUIRED for this change, not opt-in.** F1/F2/F5 are the only rows that
  execute the built UI, and per design D6 they are the sole oracle capable of
  catching a D3 mis-route or a D4b silent drop. `npm run test:e2e` must be run
  and green before merge; a green default CI is insufficient.
- **⚠ The E2E run MUST be rebuilt from local code.** `npm run test:e2e` is
  `playwright test` against the `docker/` all-in-one harness, which by default
  uses a **cached image** — i.e. the *pre-change* client bundle. Run against a
  harness rebuilt from the working tree (`docker/test-up.sh`; see the
  `run-dashboard-e2e-local-changes` skill). Against a stale image F1, F2, F5 and
  X3 all pass **vacuously**, testing code this change never touched — which
  would leave every eval-order and linkification failure mode unguarded while
  reporting green.
- Scenarios by class: edge 10 · perf 0 · frontend 7 · error 4 · manual 1
- Scenarios by level: L1 12 · L2 0 · L3 4 · ci 5 · — 1
- Scenarios by disposition: automated 21 · manual-only 1

**No performance scenarios, deliberately.** The change states no latency,
throughput, or bundle-size requirement, and the design explicitly dropped the
code-split rationale when `lazy()` was shown ineffective. Inventing a threshold
here would fabricate a requirement rather than test one.

**No L2 (qa VM smoke) scenarios.** Nothing in this change touches install,
spawn, or multi-OS process behaviour — it is entirely in-bundle module structure.

## New infra needed

None. Every level already has a harness and a close exemplar:
`packages/server/src/__tests__/localhost-guard.test.ts` (E2/E3),
`packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx` (F7),
`packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx`
(E5/E6/E7), `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx`
(F3/F4), `tests/e2e/editor-pane.spec.ts` (F1/F2/E8),
`tests/e2e/file-preview-survives-churn.spec.ts` (F5).
