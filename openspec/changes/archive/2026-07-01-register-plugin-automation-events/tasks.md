## 1. Cross-plugin service seam

- [x] 1.1 Add `provide(name, value)` + `consume<T>(name)` to `ServerPluginContext` interface + `ServerContextDeps` in `dashboard-plugin-runtime/src/server/server-context.ts`
- [x] 1.2 Back the seam with one host-owned `Map` constructed in `server.ts` and injected into `createServerPluginContext`
- [x] 1.3 Unit test: provider value observed by consumer; absent name returns `undefined` (no throw)
- [x] 1.4 Verify loader topological order guarantees provider `registerPlugin` before a `dependsOn` consumer (covered by `dependency-graph.test.ts` "orders deps before dependents" + shared-registry seam test)

## 2. Action registry (automation plugin, server)

- [x] 2.1 Add `ActionRegistry` + `ActionDescriptor` (`id`, `source`, `label`, `description`, `available(cwd)`, `payloadSchema`, server-side `buildPrompt`) in `packages/automation-plugin/src/server/action-registry.ts`
- [x] 2.2 Register built-ins `core.prompt` + `core.skill`; map their `buildPrompt` to the existing seed-prompt path
- [x] 2.3 Enforce per-source cap (≤12): reject + log warning beyond cap, keep first 12
- [x] 2.4 `provide("automation.action-registry", registry)` from automation `registerPlugin` (synchronous, before dependents load)
- [x] 2.5 Unit tests: registration, namespacing, cap enforcement, built-ins present

## 3. automation.yaml schema generalization

- [x] 3.1 Widen `AutomationAction` (shared types) to `{ kind: string; payload?: Record<string, unknown> }`; add `ActionDescriptor`/`ActionPayloadField` client types
- [x] 3.2 Generalize `validateAction` in `automation-schema.ts`: accept any registered id, keep `prompt`/`skill`, validate plugin `kind` against `knownActionIds`, isolate unknown-id failures (normalize at dispatch)
- [x] 3.3 Parse optional `action.payload` map; carry through `AutomationConfig`
- [x] 3.4 Unit tests: plugin action + payload, unknown-id isolation, non-mapping payload rejected

## 4. Registry unification (route + engine)

- [x] 4.1 Add `/api/plugins/automation/actions` route serving `descriptorsForCwd(cwd)` from the live shared registry (availability + enum options); wired via `listActions` hook
- [x] 4.2 Route engine `startRunFor` seed-prompt through the registered action's `buildPrompt(payload, automation)` keyed by normalized `action.kind`
- [x] 4.3 Unit tests: registry `descriptorsForCwd` gating (action-registry.test) + engine `buildRunPrompt` delegates to registered action (engine.test)

## 5. Dialog — inline accordion picker (Direction A)

- [x] 5.1 Add `listActions(cwd)` to `packages/automation-plugin/src/client/api.ts`
- [x] 5.2 Replace the `prompt|skill` segmented control in `CreateAutomationDialog.tsx` with the grouped accordion picker (group-by-source, search filter, disabled-with-reason, zero-results)
- [x] 5.3 Render the schema-driven payload form from the selected action's `payloadSchema` (string/multiline/text/enum); empty schema → no form
- [~] 5.4 Accessibility: aria-expanded groups, aria-pressed items, aria-label search, disabled-with-reason title; full focus-ring/44px/contrast polish deferred
- [x] 5.5 Persist selected `kind` + `payload` into the create/update POST body

## 6. Flows plugin registers actions

- [x] 6.1 Add `dependsOn: ["automation"]` to flows `package.json` manifest
- [x] 6.2 In flows `registerPlugin`, `consume("automation.action-registry")`; no-op + log when absent
- [x] 6.3 Register `flows.run` (flow enum from disk discovery + task multiline), `flows.resume`, `flows.cancel` with `available(cwd) = hasFlows(cwd)`
- [x] 6.4 Wire `flows.run` seed-prompt (`/<ns>:<name> <task>`) into the run path
- [x] 6.5 Unit tests: per-cwd discovery, availability gating, enum options, seed-prompt, registry-absent graceful path

## 7. Integration + docs

- [x] 7.1 Layered coverage of the vertical: registry descriptors+gating (action-registry.test), schema accepts flows.run+payload (automation-schema.test), engine seeds via registered buildPrompt (engine.test), flows registers+discovers+seeds (automation-actions.test), dialog renders payload + writes kind+payload (CreateAutomationDialog.test). Live spawn→fire→flow-run is the manual smoke step.
- [x] 7.2 Backward-compat: `automation-schema.test` "parses a valid schedule + prompt automation" still asserts `action == {kind:"prompt", prompt}`; engine `buildRunPrompt` legacy fallback retained
- [x] 7.3 Add file-index rows for new/changed files in the matching `docs/file-index-*.md` splits (delegated per Documentation Update Protocol)
