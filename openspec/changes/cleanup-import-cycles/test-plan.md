# Test Plan — cleanup-import-cycles

Stage: design   Generated: 2026-08-06

## ⚠ Clarifications needed (1)

- [ ] **C1** — Blocks **E8**. D3 routes the four pseudo-tab kinds
  (`diff`/`url`/`live-server`/`terminal`) around `CappedViewer`, which today
  size-gates them (`CappedViewer.tsx:48-58` probes `/api/file`, renders
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
| E4 | D2 `formatCost` extracted, not conflated | EP | L1 | automated | `0`, `0.005`, `1.5`, `1234.567` | call extracted `formatCost` | 2-decimal output (`toFixed(2)`) identical to `FlowAgentCard.tsx:27` today; **must not** adopt `SessionSidebar.tsx:42`'s different 4-decimal `formatCost` |
| E5 | D3 split is total and disjoint | exhaustiveness | L1 | automated | both registry halves | `Object.keys(a)` ∪ `Object.keys(b)` | union === all 16 `ViewerKind` members; intersection empty; each half's `Record` total over its own subset |
| E6 | D3 kinds land in the right half | decision-table | L1 | automated | all 16 `ViewerKind` members | look each up | the 12 `fileKind()`-returnable kinds resolve from half (a) and are **absent** from (b); `diff`/`terminal`/`url`/`live-server` resolve from (b) and are **absent** from (a) |
| E7 | D3 size gate preserved for real files | BVA | L1 | automated | `size` = `MAX_PREVIEW_BYTES-1`, `= MAX_PREVIEW_BYTES`, `= MAX_PREVIEW_BYTES+1`, for a non-`monaco` file-kind viewer | mount `CappedViewer` | first two render the viewer; third renders `TooLargePreview`. `monaco` bypasses at all three |
| E8 | D3 oversized pseudo-tab | BVA | L3 | automated | a `diff:` tab whose content exceeds `MAX_PREVIEW_BYTES` | open the tab | [NEEDS CLARIFICATION: observable — see C1] |
| E9 | D4a `isExternalHref` extracted, semantics preserved | EP | L1 | automated | `https://example.com/x`; a same-origin absolute URL; `#anchor`; `undefined` | call from its new leaf module | `true` only for the cross-origin URL; `false` for same-origin, fragment-only, `undefined` — identical to pre-extraction |
| E10 | `isolatedModules` respected | static | ci | automated | all five extracted leaf modules | `tsc --noEmit` | exit 0; every type re-export uses `export type` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | D3 diff tab still renders | state-transition | L3 | automated | a session with a diff | open a `diff:` tab in the editor pane | `DiffPanel` body renders; no blank pane, no `<undefined/>` React throw, no console error |
| F2 | D3 other pseudo-tabs still render | decision-table | L3 | automated | a `url:` tab, a `live:` tab, a `term:` tab | open each | each converges to its own body (url viewer / live-server viewer / terminal keep-alive layer); none renders the file-kind path |
| F3 | D4b linkification survives at every context builder | decision-table | L1 | automated | four `ToolContext` shapes: `App.tsx:1126`, `main.tsx:112` (cwd-less), a bare `chat-embed` context, and no context at all | render `MarkdownContent` with markdown containing a file mention | a `FileLink` is produced for the first three (chat-embed via its attached default); plain text when no context — matching today |
| F4 | D4b `hostManaged` dual-mode preserved | state-transition | L1 | automated | a `FileLink` inside a `FilePreviewProvider`, and one outside it | click to open a preview | inside: `hostManaged` true, exactly one overlay rendered by `FilePreviewHost`, leaf renders none. Outside: leaf-local overlay renders. Zero double-mounts |
| F5 | D4b preview survives message churn | state-convergence | L3 | automated | open file preview in chat, then stream new messages | message list re-renders / remounts | overlay stays open on the same target — the `fix-file-preview-survives-message-churn` invariant is unbroken by the inversion |
| F6 | D4a external-link hardening preserved | decision-table | L1 | automated | external URL, same-origin URL, fragment-only, loopback URL | render markdown containing each | external gets `target="_blank" rel="noopener noreferrer"`; fragment + same-origin stay in-document; loopback click opens the split live-server viewer |
| F7 | D2 flow agent surfaces still render | regression | L1 | automated | a flow agent with a non-zero cost | render `FlowAgentCard` and `FlowAgentDetail` | both mount; cost renders with 2 decimals in each; no circular-import `undefined` component |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D3 `DiffFilePreview` missing-file path intact | fault-injection (abort) | L1 | automated | `GET /api/file` returns 404 / non-file | open diff "Preview" mode | `data-testid="diff-preview-not-found"` renders; panel does not crash — unchanged by the registry split |
| X2 | D3 an unregistered kind cannot ship | static | ci | automated | add a member to `ViewerKind` registered in neither half | `tsc --noEmit` | compile error (both halves' `Record`s are total over their subsets) — not a runtime `undefined` lookup |
| X3 | Production bundle builds and boots | integration | ci | automated | full repo after all cuts | `npm run build`, then load the built app | build exits 0; app boots with no module-evaluation `undefined` binding error in console |
| X4 | `ToolContext` public surface not broken | static | L1 | automated | a `chat-embed` consumer building a `ToolContext` without `fileLink` | typecheck + render | compiles (field optional); linkification still works via the attached default; `chat-embed/index.ts:52` doc-comment no longer lists the non-existent `editors` field |

### Manual

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | No visual regression on the touched surfaces | visual/subjective | — | manual-only | markdown-heavy chat transcript, file-preview overlay, the 4 pseudo-tab kinds, flow agent card/detail | human compares against `develop` | [judgment: renders look unchanged — no automatable observable] |

---

## Coverage summary

- Requirements covered: 10/10 (D1, D2, D3, D4a, D4b, terminal gate, no-behaviour-change, `hostManaged`, `isolatedModules`, bundle build)
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
