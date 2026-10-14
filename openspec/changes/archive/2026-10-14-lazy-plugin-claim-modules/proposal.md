## Why

After `shrink-client-entry-lazy-islands`, the largest remaining block in the client entry chunk is **plugin client code: ~560 KB raw / ~170 KB gz** (source-map attribution of `index-*.js`). The generated `packages/client/src/generated/plugin-registry.tsx` statically imports every claimed component from every plugin's single client entry, so heavy surfaces most sessions never open ship in the cold load:

- 18 `settings-section` claims (only rendered inside the Settings view),
- 7 `shell-overlay-route` boards/monitors (automation board, goals board, flow dashboard…),
- `content-view`, `editor-pane-tab`, `tool-renderer`, `custom-entry-renderer` surfaces,
- their transitive deps — e.g. `flows-plugin/FlowGraph.tsx` alone pulls `dagre-d3-es` + `d3-*` + `lodash-es` (~95 KB raw).

A plain `React.lazy(() => import("<plugin>"))` in the generator cannot fix this: the same plugin entry is also imported statically (predicates, badges, catalogs), so Rollup keeps everything eager and emits the "dynamic import will not move module into another chunk" warning — the exact trap `shrink-client-index-chunk` hit with `@mdi/js`. The split needs a **separate module per lazy claim**, which is a manifest-contract addition.

## What Changes

- **Manifest**: `PluginClaim` gains optional `module?: string` — package-relative path of a client module exporting `component`. Additive; existing manifests unchanged.
- **Generator** (`dashboard-plugin-runtime/src/vite-plugin`): for claims with `module`, emit `Component: lazyClaim(() => import("<spec>"), "<component>")` instead of a named static import; `predicate` / `shouldRender` / `labelComponent` / catalog stay static from the main entry. Validation: module exists, exports the component, and the main entry does **not** export it. `module` is included in the registry hash.
- **Runtime**: new `lazyClaim(loader, name)` helper (memoized `React.lazy`). Slot consumers wrap claim rendering in `<Suspense fallback={slotFallback}>` inside the existing `slot-error-boundary`.
- **First-party adoption**: move heavy claim components out of plugin barrel exports into lazy modules — all `settings-section` claims, `shell-overlay-route` boards, flow dashboard/graph, blackhole pipeline detail, MCP folder page, and other measured-heavy claims. Badges, chips, predicates and composer-inline claims stay eager.
- **Guard**: `mdi-chunk-size.test.ts` asserts a FlowGraph marker (dagre) is off the landing graph; `INDEX_GZ_CAP_BYTES` lowered again to the measured size rounded up to 10 KiB.
- **Docs**: `dashboard-plugin-scaffold` skill + plugin authoring docs describe `module` and when to use it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `dashboard-plugin-loader`: claims may name a lazily-loaded `module`; generator and slot consumers honour it; validation rules.

## Impact

- `packages/shared/src/dashboard-plugin/manifest-types.ts` (+ `manifest-validator.ts` shape check).
- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`, `slot-consumers.tsx`, `slot-error-boundary.tsx`, new `lazy-claim.tsx`, exports in `index.ts`.
- First-party plugin packages: `package.json#pi-dashboard-plugin.claims[].module`, client barrels stop exporting the moved components (flows, automation, goal, blackhole, kb, mcp-client, system-one, subagents, browser, gmail, quota, … — final list by measurement).
- `packages/client/src/__tests__/mdi-chunk-size.test.ts` (dagre marker, lower cap).
- `.pi/skills/dashboard-plugin-scaffold` + `docs/` plugin authoring (via DocScribe).
- **Compatibility**: additive optional field. Third-party plugins keep working without changes. An older dashboard ignores `module` (static import of `component` from the main entry would then fail if the plugin removed it from its barrel) → plugins that adopt `module` need a dashboard version floor; document it. Rollback: remove `module` from first-party manifests and restore barrel exports.
- UX: first open of a lazy surface waits on one chunk; fallback per slot (nothing / skeleton). Expected entry drop: −100 KB gz or more (measured in tasks).
- Sequenced after `shrink-client-entry-lazy-islands` (shares the size test and the Settings lazy boundary).

## Discipline Skills

- `performance-optimization` — measurement-driven claim selection; landing-graph total must drop.
- `doubt-driven-review` — public plugin-manifest contract change (irreversible once third-party plugins adopt it); stress-test the field shape and the validation rules first.
- `review-code` — before commit.
- No security / observability triggers: build-time codegen + client chunking; no new endpoint or untrusted input.
