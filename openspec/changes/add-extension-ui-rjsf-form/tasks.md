## 1. Schema and shared types

- [ ] 1.1 Extend `UiView` discriminated union in `packages/shared/src/types.ts` to add the `"rjsf-form"` arm with `rjsfSchema: JSONSchema7`, `rjsfUiSchema?: UiSchema`, `rjsfFallback: "ctx-ui" | "defaults" | "reject"` (required), `dataEvent?: string`, `initialDataEvent?: string`. Re-export `JSONSchema7` from `json-schema` and `UiSchema` from `@rjsf/utils` (type-only import).
- [ ] 1.2 Add `json-schema` and `@rjsf/utils` (type-only) to `packages/shared/package.json` devDependencies; ensure no runtime `@rjsf/*` package leaks into the shared bundle.
- [ ] 1.3 Add a runtime validator helper `validateRjsfForm(view): { ok: true } | { ok: false, reason: string }` that flags external-URL `$ref` and missing `rjsfFallback`. Used by `event-wiring.ts` when caching modules.
- [ ] 1.4 Add unit tests in `packages/shared/src/__tests__/extension-ui-rjsf-types.test.ts`: well-formed descriptor passes; missing `rjsfFallback` is a TypeScript error (snapshot via `// @ts-expect-error` test); external-URL `$ref` is rejected by the validator helper; internal `#/...` refs pass.

## 2. Bridge: pure-pi fallback handling

- [ ] 2.1 In `packages/extension/src/bridge.ts` (or a new `packages/extension/src/rjsf-fallback.ts` helper), add `runRjsfFallback(ctx, module): Promise<unknown>` implementing the three strategies (`"ctx-ui"`, `"defaults"`, `"reject"`).
- [ ] 2.2 Wire the fallback into the slash-command handler so it runs ONLY when the bridge has no active dashboard connection AND the matched module's `view.kind === "rjsf-form"`.
- [ ] 2.3 Implement the `"ctx-ui"` decomposition: walk top-level `properties`; map `string` → `ctx.ui.input`, `boolean` → `ctx.ui.confirm`, `number`/`integer` → `ctx.ui.input` with numeric coercion + retry on parse failure, `string` with `enum` → `ctx.ui.select`. Skip non-primitive properties silently. Return the assembled object.
- [ ] 2.4 Implement the `"defaults"` strategy: synchronously return an object built from each top-level property's `default` (or `const`) value; omit properties without a default.
- [ ] 2.5 Implement the `"reject"` strategy: define and throw `NoDashboardError` with a message identifying the slash command. Export the error class from `packages/extension/src/index.ts` so extensions can catch it.
- [ ] 2.6 Add unit tests in `packages/extension/src/__tests__/rjsf-fallback.test.ts` covering one scenario per spec scenario (ctx-ui prompts in declared order, defaults synchronous, reject throws, ctx-ui skips non-primitives).

## 3. Client: lazy-loaded RJSF bundle

- [ ] 3.1 Add `@rjsf/core@^5` and `@rjsf/validator-ajv8@^5` to `packages/client/package.json` (NOT `packages/client` peer or shared). Confirm Vite tree-shakes the eager-import path away.
- [ ] 3.2 Create `packages/client/src/components/extension-ui/rjsf/RjsfFormView.tsx` as the lazy entry point. Inside, statically import `@rjsf/core` and `@rjsf/validator-ajv8` so Vite emits a single rjsf chunk. Export `RjsfFormView({ module, sessionId, onClose })`.
- [ ] 3.3 In `GenericExtensionDialog.tsx`, when `view.kind === "rjsf-form"`, dynamic-import `RjsfFormView` via `React.lazy(() => import("./rjsf/RjsfFormView"))` wrapped in `<Suspense>` with a small loading indicator. Other view kinds remain synchronous.
- [ ] 3.4 Confirm via `npm run build` that `dist/client/assets/` contains an `RjsfFormView-*.js` chunk separate from the main bundle. Add a CI sanity check (size guard, warn at >250 KB gzipped).

## 4. Client: Tailwind RJSF theme

- [ ] 4.1 Create directory `packages/client/src/components/extension-ui/rjsf-theme/` with widget components: `TextWidget.tsx`, `NumberWidget.tsx` (covers `number`/`integer`/`range`), `CheckboxWidget.tsx`, `SelectWidget.tsx`, `TextareaWidget.tsx`, `DateWidget.tsx`, `BaseInputTemplate.tsx`, `FieldTemplate.tsx`, `ObjectFieldTemplate.tsx`, `ArrayFieldTemplate.tsx`, `ErrorListTemplate.tsx`.
- [ ] 4.2 Compose them into a single `tailwindTheme: ThemeProps` object exported from `packages/client/src/components/extension-ui/rjsf-theme/index.ts`. Use existing `@/components/ui/*` (or equivalent Tailwind primitives) where possible to match dashboard styling.
- [ ] 4.3 In `RjsfFormView`, instantiate `withTheme(tailwindTheme)` once at module scope. Pass the resulting Form component the `view.rjsfSchema`, `view.rjsfUiSchema`, the AJV-8 validator, and the submit handler.
- [ ] 4.4 Add snapshot tests in `packages/client/src/components/extension-ui/rjsf-theme/__tests__/widgets.test.tsx` covering each widget rendered with a simple schema.
- [ ] 4.5 Add a static lint test asserting no file under `rjsf-theme/` uses `dangerouslySetInnerHTML` (mirror existing `no-direct-process-kill.test.ts` pattern).

## 5. Client: submit + reply lifecycle

- [ ] 5.1 In `RjsfFormView`, implement the submit handler: on AJV-validated submit, dispatch `ui_management { sessionId, action: "submit", event: view.dataEvent ?? `${module.id}:submit`, params: formData }` via the existing `usePluginSend` / `useWebSocketSend` hook. Disable the submit button while awaiting `_reply`.
- [ ] 5.2 Listen for the matched `ui_management` reply (via `_reply` round-trip on the bus or a dedicated `ui_management_reply` event — choose the path consistent with how Phase 1 actions surface reply errors). On `{ ok: false, error }`, render an inline error banner above the submit button and re-enable it. On `{ ok: true }`, call `onClose()`.
- [ ] 5.3 Add a 30-second timeout: if no reply arrives, surface a generic timeout banner and re-enable the submit button. Cancel the timeout on actual reply.
- [ ] 5.4 Wire `view.initialDataEvent` (when present): on mount, dispatch `ui_management { action: "list", event: view.initialDataEvent }`; pre-fill the form's `formData` with the first item from `session.uiDataMap[view.initialDataEvent]` once it arrives.
- [ ] 5.5 Add tests in `RjsfFormView.test.tsx`: invalid submit blocks dispatch; valid submit dispatches; `_reply({ ok: false })` surfaces banner; `_reply({ ok: true })` closes; timeout fires after 30s.

## 6. Client: wire into existing modal + slash-command path

- [ ] 6.1 Confirm the slash-command interception in `CommandInput.tsx` already routes `rjsf-form` modules through `GenericExtensionDialog` (it should — Phase 1 covers this; verify no `view.kind` allowlist excludes `rjsf-form`).
- [ ] 6.2 Confirm the server's `event-wiring.ts` caches `ui_modules_list` regardless of `view.kind` (it should — modules are stored verbatim). Add a regression test pushing an `rjsf-form` module through replay.
- [ ] 6.3 Verify `replayUiState(ws, sessionId)` replays `rjsf-form` modules to a re-subscribing browser without modification.

## 7. Documentation and integration

- [ ] 7.1 Update `docs/architecture.md` with a section on `rjsf-form` view types, the lazy-load contract, and the pure-pi fallback strategy choice.
- [ ] 7.2 Update `AGENTS.md` Key Files table to add `RjsfFormView.tsx`, the `rjsf-theme/` directory, `runRjsfFallback`, and `NoDashboardError`. Cross-reference change `add-extension-ui-rjsf-form`.
- [ ] 7.3 Add a usage example to `openspec/specs/extension-ui-system/spec.md` (Phase 4 section, ADDED via this change) showing a minimal `rjsf-form` descriptor with each `rjsfFallback` strategy.
- [ ] 7.4 Update `packages/shared/README.md` (if present) noting the new `JSONSchema7` / `UiSchema` re-exports.

## 8. Verification

- [ ] 8.1 Run `npm test` and ensure all new tests pass; run `npm run build` and confirm the rjsf chunk is split out.
- [ ] 8.2 Run `npm run reload:check` (type-check + reload all sessions) and verify nothing in the shared / extension layer regressed.
- [ ] 8.3 Manual smoke test: register a fixture extension with one `rjsf-form` module declaring each `rjsfFallback` strategy; verify dashboard render, validation gating, `_reply` error banner, and pure-pi fallback paths.
- [ ] 8.4 Run `openspec validate add-extension-ui-rjsf-form --strict` and resolve any reported issues.
