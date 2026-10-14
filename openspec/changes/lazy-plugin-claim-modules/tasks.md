## 0. Baseline

- [ ] 0.1 After `shrink-client-entry-lazy-islands` lands: `npm run build`; record entry gz, landing-graph total, and a per-plugin-claim raw-size table (source-map attribution) to drive D5.

## 1. Contract + generator (tests first)

- [ ] 1.1 Generator tests (`vite-plugin/__tests__`): claim with `module` emits `lazyClaim(() => import(...), "X")` and no static import of `X`; predicate/shouldRender/labelComponent stay static; `module` changes the registry hash.
- [ ] 1.2 Generator tests: missing module file, module lacking the export, and main entry also exporting the component each fail with a message naming plugin/slot/component/module.
- [ ] 1.3 `manifest-types.ts`: `module?: string` on `PluginClaim` (doc comment); `manifest-validator.ts` shape check (non-empty relative path).
- [ ] 1.4 Implement generator emission + validation (D2, D3).

## 2. Runtime

- [ ] 2.1 Tests: `lazyClaim` memoizes per (loader, name); consumer renders fallback then component; rejected load is contained by the claim's error boundary while sibling claims render.
- [ ] 2.2 `lazy-claim.tsx` + export from runtime `index.ts`.
- [ ] 2.3 `slot-consumers.tsx`: Suspense inside `slot-error-boundary` for every claim render path; per-slot fallback option (null default; skeleton for overlay routes / content views).

## 3. First-party adoption

- [ ] 3.1 From the 0.1 table, list the claims to make lazy (D5) in this file.
- [ ] 3.2 Per plugin: move each listed component into its own module, add `module` to the claim, remove it from the client barrel; run that plugin's tests.
- [ ] 3.3 Flows: `FlowDashboardClaim` (+ `FlowGraph`, dagre/d3/lodash) lazy; confirm `FlowSummary`'s use of `FlowGraph` is also behind a lazy claim or moved.
- [ ] 3.4 Ensure no plugin client entry statically imports a moved module (generator check 1.2 covers exports; add a build check for the "dynamic import will not move module" warning naming plugin paths).

## 4. Guard + measure

- [ ] 4.1 `mdi-chunk-size.test.ts`: dagre marker absent from the landing graph and present in a lazy chunk.
- [ ] 4.2 `npm run build`; entry gz and landing-graph total both drop vs 0.1; lower `INDEX_GZ_CAP_BYTES` to measured rounded up to 10 KiB with a measurement comment.
- [ ] 4.3 Full test suite green; manual check on throttled network: open Settings › each plugin page, automation board, flow dashboard, a flow-write tool row.

## 5. Docs

- [ ] 5.1 `dashboard-plugin-scaffold` skill: document `module`, the "don't also export from the main entry" rule, and the dashboard version floor.
- [ ] 5.2 DocScribe: plugin authoring doc section on lazy claims (caveman style), architecture note on the registry split.
- [ ] 5.3 AGENTS.md rows for touched runtime/generator/shared files and moved plugin modules — `See change: lazy-plugin-claim-modules`.
