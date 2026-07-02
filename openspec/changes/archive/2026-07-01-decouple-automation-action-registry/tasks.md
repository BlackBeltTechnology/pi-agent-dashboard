## 1. Host primitive — consumeAll(prefix)

- [x] 1.1 Add `ConsumeAllFn` + `consumeAll` to `ServerPluginContext` interface + `ServerContextDeps` + `createServerPluginContext` wiring (`dashboard-plugin-runtime/src/server/server-context.ts`)
- [x] 1.2 Implement in `server.ts`: iterate `pluginServiceRegistry` keys, return `{key,value}` for `key.startsWith(prefix)`; in-process only
- [x] 1.3 Update runtime test deps literals with `consumeAll`
- [x] 1.4 Unit test: collects matching keys, order-independent, empty on no-match, never throws

## 2. Automation — collect-on-read (drop shared registry)

- [x] 2.1 Replace `createActionRegistryWithBuiltins` + `provide("automation.action-registry")` with a collect helper that `consumeAll("automation.action.")`, flattens (single or array), builds an id-indexed set, and applies guards (id shape, duplicate, exactly-one-dispatch, per-source cap ≤12) with logged warnings
- [x] 2.2 Self-publish built-ins: `provide("automation.action.core", [core.prompt, core.skill])` in automation `registerPlugin`
- [x] 2.3 Route `/actions` + engine dispatch read via the collect helper (per-cwd cache retained); `descriptorsForCwd` builds `ActionDescriptor[]` (eval available, resolve enum options, drop fns)
- [x] 2.4 Unit tests: collect from multiple publishers, order-independent, cap/duplicate/malformed rejection, core self-published, dispatch resolves by id

## 3. Flows — pure publisher

- [x] 3.1 Replace `wireFlowAutomationActions(consume,…)` with `provide("automation.action.flows", contribution)` in flows `registerPlugin`; delete duplicated `ACTION_REGISTRY_SERVICE` string
- [x] 3.2 Contribution declares `flows.run` (flow enum + task multiline, `buildEvent` → `flow:run`, malformed → null); no resume/cancel
- [x] 3.3 Unit tests: flows publishes without consuming; loads without automation present; run-only

## 4. Client — closed primitive set + fallback

- [x] 4.1 Document `ActionPayloadField.type` as a closed versioned union in shared types
- [x] 4.2 `ActionPayloadForm` renders known primitives; unknown `type` → plain text input (no crash), value still submitted under `action.payload`
- [x] 4.3 Unit test: known primitives render controls; unknown type renders text input + submits

## 5. Validation + docs

- [x] 5.1 Affected vitest suites green (runtime + automation-plugin + flows-plugin)
- [x] 5.2 `tsc --noEmit` clean for automation-plugin + flows-plugin
- [x] 5.3 File-index rows updated (delegated per Documentation Update Protocol)
