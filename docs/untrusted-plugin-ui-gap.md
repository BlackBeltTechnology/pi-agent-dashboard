# Untrusted Plugin UI Gap: Descriptor Protocol vs React

Read-only gap analysis. Question: what can an untrusted third-party plugin NOT express using the descriptor protocol (`extension-ui-system`) instead of React?

## Threat model — why untrusted plugins exist

Untrusted third-party plugins cannot use the React plugin path. Same-realm JS = no security boundary.

- Dashboard client drives prompts, aborts, spawns, git branches, flows.
- Agent has shell access.
- Untrusted same-realm plugin ⇒ agent-fleet control ⇒ RCE on dev machine.
- Server tier worse: `packages/dashboard-plugin-runtime/src/server/loader.ts:442` does `await import(plugin.serverEntryPath)` with Fastify-bearing `ServerPluginContext` ⇒ direct RCE.
- Untrusted plugins MUST NOT use `client` or `server` manifest entries.

## Descriptor protocol = the safe path

- Spec `openspec/specs/extension-ui-system/spec.md`. 13 requirements, 306 lines.
- Phase 1 = management modals.
- Phase 2 = live decorations. Shipped via `add-extension-ui-decorations`.
- Phase 3 lifecycle in flight: `openspec/changes/add-extension-ui-module-lifecycle/`.
- Untrusted code runs in pi session process.
- Only JSON descriptors cross wire.
- Dashboard renders with own trusted React: `packages/client/src/components/extension-ui/` (`GenericExtensionDialog.tsx`, `AgentMetricSlot.tsx`, `BreadcrumbSlot.tsx`, `FooterSegmentSlot.tsx`, `GateSlot.tsx`, `ToastSlot.tsx`).
- Pattern = VS Code extension-host.

Caveat: descriptors do NOT sandbox plugin's own process. pi extension runs with pi session privileges, incl. shell. Bound via containerization, not this protocol.

## Method

- Source of truth = `payloadTier` field per slot in `packages/shared/src/dashboard-plugin/slot-types.ts`, const `SLOT_DEFINITIONS`.
- Tiers: `react-only`, `react-or-descriptor`, `descriptor-only`.
- Blocked-for-untrusted = every `react-only` slot.
- Cross-referenced against 32 real claims from 13 monorepo plugin manifests (`pi-dashboard-plugin.claims` in `packages/*/package.json`).

## Headline counts

| tier | slots | claims | share | untrusted status |
|---|---|---|---|---|
| `react-only` | 12 | 17 | 53% | blocked |
| `react-or-descriptor` | 4 | 15 | 47% | expressible |
| `descriptor-only` | 7 | 0 | — | available, unused by monorepo plugins |

- Zero monorepo dashboard plugins use descriptor slots.
- Descriptor path serves pi extensions (bridge-side, e.g. `pi-judo`), different population.
- Untested for dashboard-plugin work.

## Blocked `react-only` slots

| slot | claims | plugins | reason |
|---|---|---|---|
| `shell-overlay-route` | 6 | goal, automation, subagents, kb | full-screen wouter route, props `{params, onBack, session}`; `management-modal` is modal not routed page |
| `sidebar-folder-section` | 3 | goal, automation, kb | folder-scoped; descriptors session-scoped |
| `tool-renderer` | 3 | demo, flows | arbitrary tool input/output render; no template language |
| `worktree-card-section` | 1 | kb | worktree/folder-scoped |
| `session-card-action-bar` | 1 | goal | no action-bar decorator kind |
| `session-card-flows` | 1 | flows | no subcard decorator kind |
| `command-route` | 1 | cost-estimator | routed view |
| `automation-action-editor` | 1 | flows | custom editor component |
| `session-card-memory`, `workspace-action-bar`, `content-inline-footer`, `anchored-popover` | 0 | — | unused, still react-only |

## Covered by descriptors

- `settings-section` 11 claims (top slot overall) + `rjsf-form`.
- `session-card-badge` 2.
- `content-view` 1.
- `content-header-sticky` 1.
- Plus `management-modal` and 5 decorator kinds.

## Descriptor surface (what exists)

`management-modal`:

- `view.kind ∈ table|grid|form`.
- `UiField.kind ∈ text|number|boolean|select|code|datetime|textarea`.
- `UiAction` w/ `confirm`.
- `UiSection`.
- Data via `view.dataEvent` → `ui_data_list` cap 1000.
- Actions via `ui_management {action,event,params}`.

Decorators:

- `footer-segment {text,tooltip?,icon?}`.
- `agent-metric {agentId,text,tooltip?}`.
- `breadcrumb {steps[{id,label,status}],current?}`.
- `gate {flowId,available,reason?}`.
- `toast {level,message,durationMs?}`.

## Six structural gaps beyond slot list

1. **Session-scoped only.** Descriptors ride `sessionId`, cached `Session.uiModules`/`uiDataMap`/`uiDecorators`, replayed on subscribe. No live session ⇒ no UI. React plugins render settings/folder sections/boards with zero sessions.
2. **3 of 5 decorator kinds Flows-specific.** Hardcoded mounts: `agent-metric`→`FlowAgentCard.tsx`, `breadcrumb`→`FlowDashboard.tsx`, `gate`→`FlowLaunchDialog`. Non-Flows third party effectively has `footer-segment` + `toast` + `management-modal` + `rjsf-form` only.
3. **Closed field union.** No file upload, color picker, autocomplete/relation, markdown editor, chart, image, tree.
4. **No client-side interactivity.** Every action = `ui_management` round-trip to extension. No local validation, optimistic UI, drag-drop, client-side sort/filter.
5. **Whole-list data semantics.** `ui_data_list` replaces list, cap 1000. No append/patch, no streaming, no virtualization contract. Bridge caps 20 invalidations/sec.
6. **No i18n.** React plugins ship `catalog` (`PluginI18nCatalog`); descriptors carry raw strings. Icons limited to `@mdi/js` keys.

## Feasibility triage of 17 blocked claims

| bucket | claims | effort | path |
|---|---|---|---|
| add descriptor kind (routed page, action-bar, subcard) | ~9 | moderate | bounded enum additions |
| extend scope beyond session (folder/workspace/global) | 4 | architectural | new cache keys + probe channels |
| genuinely hard (`tool-renderer` arbitrary payloads, custom editors) | 4 | high | needs template/expression language |

## Verdict

- Descriptors cover "declare config + management console" plugin.
- Descriptors do NOT cover "own a page, decorate workspace, render my tool output" plugin = 53% of existing plugins.
- Parity not available today.

## Options

**(a) Accept bounded third-party UI.** Publish descriptors as untrusted contract; document ceiling; close ~9 feasible slot gaps over time. Safest, lowest effort, real ceiling.

**(b) Invest in scope + kinds.** Folder/workspace-scoped descriptors + routed-page kind; reaches ~13/17 parity; multi-change program; only path where untrusted and real plugin converge.

**(c) RECOMMENDED. Descriptors + sandboxed-iframe escape hatch.** `shell-overlay-route` tops blocked list at 6 claims and is most iframe-shaped: full-screen, self-contained, `onBack`. iframe = `sandbox` attr + separate origin + CSP + `postMessage` RPC, browser-enforced boundary. `tool-renderer` + folder sections stay first-party-only. Preserves "no untrusted JS in dashboard realm" invariant.

## Status

Analysis only. No code change. No OpenSpec change opened yet.

## See

- `openspec/specs/extension-ui-system/spec.md`
- `openspec/specs/dashboard-plugin-loader/spec.md`
- `openspec/specs/dashboard-shell-slots/spec.md`
- `openspec/changes/add-extension-ui-module-lifecycle/`
- `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` (§Future Work: external plugin discovery — deferred trust model, `requiredApi` SemVer pinning, node_modules discovery)
- `packages/shared/src/dashboard-plugin/slot-types.ts`
- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` (build-time static-import registry, client rebuild required)
- `packages/dashboard-plugin-runtime/src/server/loader.ts`
- `docs/architecture.md`

## Build implications

- Descriptor path needs NO client rebuild. Live probe on `session_start`/reconnect/`ui:invalidate`.
- React plugin path requires Vite regeneration of `packages/client/src/generated/plugin-registry.tsx`.
- Monorepo constraint binds React path only.
