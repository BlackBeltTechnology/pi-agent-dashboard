## Context

The Generalized Extension UI System (`extension-ui-system`) shipped Phase 1 (`management-modal` with bespoke `UiField`-driven `form` view, archived 2026-04-26) and Phase 2 (live decorations, archived 2026-04-26). Phase 1's `form` view is sufficient for flat workspace-CRUD — text/number/boolean/select/code/datetime/textarea fields in optional `UiSection` groups — but cannot express:

- conditional fields (show field B only when field A === "x"),
- nested objects with their own validation,
- arrays of records (e.g. "list of git remotes, each with name + URL"),
- per-field validation richer than HTML5 `required` (regex, range, custom error messages),
- multi-step wizards.

The motivating consumer is **pi-judo**'s save/discard gate (currently uses TUI-only `ctx.ui.custom`). It needs a structured form with conditional sections that Phase 1 cannot express. The extension-ui-system parent design (`openspec/changes/extension-ui-system/design.md` §"RJSF: Phase 4, forms-only") already designated **`react-jsonschema-form` (RJSF)** as the escape hatch for "anything richer than `UiField`".

This change is OPTIONAL — Phase 1 + Phase 2 cover the majority of extension UI needs without RJSF. Extensions only opt into `rjsf-form` when their UI exceeds Phase 1's expressive ceiling.

**Relevant pre-conditions:**

- Phase 1 modal slot is shipped (`packages/client/src/components/extension-ui/GenericExtensionDialog.tsx`).
- `ExtensionUiModule.view: UiView` already discriminates on `view.kind`.
- `ui_management { action, event, params? }` is the established submit-bus message.

## Goals / Non-Goals

**Goals:**

- Add a `rjsf-form` view kind that renders a user-supplied `JSONSchema7` via RJSF.
- Ship a Tailwind-themed RJSF widget set (text/number/boolean/select/textarea/date/array/object).
- Lazy-load the RJSF bundle (~150–200 KB minified) — sessions without `rjsf-form` modules pay zero cost.
- Map RJSF submission to the existing `ui_management { action: "submit", event, params: <validated form data> }` channel — no new wire-protocol message.
- Validate via RJSF's bundled `ajv` validator. Refuse to submit on validation error; surface RJSF's per-field error messages inline.
- Define a pure-pi fallback contract — extensions opting into `rjsf-form` MUST declare `fallback: "ctx-ui" | "defaults" | "reject"` in the descriptor; the bridge enforces this when no dashboard is connected.

**Non-Goals:**

- Replacing the Phase 1 `UiField`-driven `form` view. `UiField` remains the recommended path for flat forms; `rjsf-form` is the escape hatch.
- Loading external React/JS bundles in the browser (out-of-scope per parent design §"Out-of-Scope Explicitly").
- Exposing RJSF outside `management-modal` view types in this phase (no `rjsf-form` in decorations / settings sections / etc.). Future phases MAY widen the surface.
- Custom widget extension API (extensions cannot ship their own widgets; the dashboard's bundled widget set is the only vocabulary).
- File-upload widgets (out-of-scope; the dashboard has no extension-controlled file-store endpoint yet).
- Live form mutation from extension side (no `ui_data_list`-style push to update form state mid-edit; the schema is fixed for a given modal open).

## Decisions

### 1. Library choice: `@rjsf/core` + `@rjsf/validator-ajv8`

**Decision:** Use `react-jsonschema-form` (`@rjsf/core@^5`) with the AJV-8 validator (`@rjsf/validator-ajv8`).

**Why:** RJSF is the de facto JSON-Schema-driven React form library (~3M weekly downloads). Mature, AJV-8 supports JSON Schema draft 7, supports `uiSchema` for layout/widget hints without polluting the data schema, and is themable via the `ThemeProps` pattern.

**Alternatives considered:**

- **Hand-roll a JSON Schema → React renderer.** Rejected: re-implements RJSF's edge cases (conditional schemas via `dependencies`/`oneOf`, array `additionalItems`, `$ref` resolution) — months of work for a feature that's the OPTIONAL escape hatch. RJSF is solved.
- **`uniforms` (https://uniforms.tools).** Rejected: smaller community, fewer Tailwind community examples, theme integration requires more boilerplate than RJSF's `ThemeProps`.
- **`formik` + ad-hoc schema renderer.** Rejected: formik does not natively consume JSON Schema; we'd still need RJSF-equivalent logic on top.

### 2. Bundling strategy: dynamic `import()` gated on session module presence

**Decision:** RJSF and its theme are imported via a top-level `await import()` inside `GenericExtensionDialog` lazily, on the first render where `view.kind === "rjsf-form"`. The compiled chunk is split out by Vite's default route-level code splitting.

**Why:** RJSF + AJV is ~150–200 KB minified gzipped. Loading eagerly would punish every dashboard user, including the (currently 100%) majority who never use `rjsf-form`. Dynamic import puts the cost on the first opener.

**Trade-off:** First-open latency for an `rjsf-form` modal is ~1 RTT to fetch the chunk, plus parse. Acceptable — modals already gate on user click.

**Alternatives considered:**

- **Eager import.** Rejected: penalizes 100% of users for a feature most don't use.
- **Manifest-driven prefetch on session register if any module declares `rjsf-form`.** Deferred: optimization for later if first-open latency is observed to be a problem in practice. Vite handles the lazy chunk fine without explicit prefetch.

### 3. Tailwind-themed widget set lives in `packages/client/src/components/extension-ui/rjsf-theme/`

**Decision:** Ship a small custom theme matching dashboard styling (`@/components/ui/*` Tailwind components reused where possible). Cover at minimum: `TextWidget`, `NumberWidget` / `RangeWidget`, `CheckboxWidget`, `SelectWidget`, `TextareaWidget`, `DateWidget` (HTML5 date input), `ArrayFieldTemplate`, `ObjectFieldTemplate`, `ErrorListTemplate`, `FieldTemplate`, `BaseInputTemplate`.

**Why:** RJSF's default theme uses raw HTML inputs without dashboard styling — visually jarring. The community Tailwind theme `@rjsf/tailwind-theme` exists but is less actively maintained and doesn't match our `@/components/ui/*` exact look. ~10–15 small widget components is a tractable cost; pinned by snapshot tests.

**Trade-off:** Maintenance burden — every RJSF major upgrade may require theme tweaks. Mitigation: pin to `^5` in deps; upgrade is a deliberate change.

**Alternatives considered:**

- **`@rjsf/tailwind-theme`.** Rejected for ownership and visual-fidelity reasons above; we MAY revisit if our theme grows to >25 widgets.
- **`@rjsf/mui-theme` + ad-hoc CSS overrides.** Rejected: MUI-on-Tailwind double-runtime is painful and MUI's bundle cost is high.
- **No theme; ship raw RJSF.** Rejected: visually inconsistent with the rest of the dashboard.

### 4. Submit semantics: schema validation gated; `ui_management { action: "submit", ... }`

**Decision:** RJSF's submit handler runs AJV validation. On valid: dispatch `ui_management { sessionId, action: "submit", event: view.dataEvent ?? `${module.id}:submit`, params: formData }`. On invalid: prevent dispatch; render RJSF's per-field error messages inline (default RJSF behavior, no bridge round-trip).

**Why:** Reuses the existing `ui_management` submit channel — no new wire-protocol message, no new server handler arm. Server forwards the message to the bridge unchanged; the extension receives `pi.events.emit(event, { params, action: "submit", _reply })` exactly as for any other Phase 1 action.

**`_reply` and async submit-feedback:** Extensions MAY reject the submit by calling `_reply({ ok: false, error: "..." })`. The dashboard MUST surface the error in the modal (we'll add an `errorBanner` slot to the dialog) without closing it. Successful `_reply({ ok: true })` closes the modal.

**Trade-off:** AJV validates against the schema only — extension-side cross-field rules (e.g. "URL must be reachable") still need an `_reply`-based echo. That's intentional; client-side AJV keeps the schema authoritative for client-validatable rules without doubling effort.

### 5. Pure-pi fallback contract: extension declares strategy

**Decision:** The descriptor MUST carry `view.fallback: "ctx-ui" | "defaults" | "reject"`. When the bridge has no dashboard connection AND the user invokes the slash command:

- `"ctx-ui"`: the bridge decomposes the schema into a sequence of `ctx.ui.input` / `ctx.ui.confirm` / `ctx.ui.select` calls, top-level properties only (best-effort; nested objects and arrays are NOT supported in TUI fallback). Returns the assembled object on `_reply`.
- `"defaults"`: synchronously returns the schema's `default`/`const` values without prompting. Used for "no-op fallback" cases — the extension wants the dashboard UI but tolerates a degenerate value in pure-pi.
- `"reject"`: throws `NoDashboardError` from the slash-command handler. Extension is responsible for either avoiding the command in pure-pi or catching the throw and degrading.

**Why:** The escape-hatch nature of `rjsf-form` means most schemas can't be losslessly walked through a TUI. Forcing the extension author to declare intent prevents surprise UX. `"defaults"` and `"reject"` are 1-line opt-outs; `"ctx-ui"` is best-effort for simple flat schemas.

**Alternatives considered:**

- **Auto-decompose with no opt-out.** Rejected: nested/array schemas degrade silently; surprise data loss.
- **Always reject in pure-pi.** Rejected: inflexible; some extensions WANT defaults.

### 6. Schema field on the descriptor

`UiView` for `rjsf-form` carries:

```ts
{
  kind: "rjsf-form",
  rjsfSchema: JSONSchema7,           // data schema; required
  rjsfUiSchema?: UiSchema,           // RJSF uiSchema; optional layout/widget hints
  rjsfFallback: "ctx-ui" | "defaults" | "reject",  // required; no default
  dataEvent?: string,                // submit event name (defaults to `${module.id}:submit`)
  initialDataEvent?: string,         // optional; if set, modal sends `ui_management { action: "list", event: initialDataEvent }` on mount and pre-fills form from first item
}
```

`rjsfFallback` is required (no default) so omission is a TypeScript error — extension authors must explicitly choose.

## Risks / Trade-offs

- **[Risk] RJSF major version churn.** RJSF 5→6 may require theme adjustments. → **Mitigation:** Pin to `^5`; document upgrade as a deliberate change with snapshot-test review.

- **[Risk] Bundle size grows beyond ~200 KB.** AJV strict-mode + RJSF + ajv-formats is the dominant cost. → **Mitigation:** Confirmed lazy-loaded behind dynamic import; unit-test the chunk-name presence in `dist/client/`. Add a CI guard on `dist/client/assets/extension-ui-rjsf-*.js` size (warn if >250 KB gzipped).

- **[Risk] AJV validation messages are user-hostile by default ("must NOT have additional properties").** → **Mitigation:** Configure `ajv-errors` to allow per-field `errorMessage` on the schema; document the convention in the descriptor docs. Extension authors can override messages cleanly.

- **[Risk] Pure-pi `"ctx-ui"` fallback diverges visually/behaviorally from the dashboard form.** → **Mitigation:** Document in the spec that `"ctx-ui"` is best-effort and only handles flat top-level properties of primitive types. Nested objects/arrays in TUI fallback are out of scope; extensions with rich schemas should choose `"defaults"` or `"reject"`.

- **[Risk] Schema with `$ref` to external URL.** RJSF can resolve `$ref`, but external URLs in extension-supplied schemas are an exfil/SSRF surface. → **Mitigation:** The dashboard's RJSF setup MUST use `customFormats` and a `localResolver` only — `$ref` to external URLs is rejected at parse time with an inline error; only `#/...` internal refs are honored.

- **[Risk] Extension XSS via custom error messages or schema description fields.** → **Mitigation:** All RJSF-rendered text passes through React's text-node escaping by default; we will NOT enable `dangerouslySetInnerHTML` anywhere in the theme. Snapshot test asserts no `dangerouslySetInnerHTML` in `rjsf-theme/` source.

- **[Trade-off] Extension authors targeting both TUI and dashboard write a `rjsfSchema` AND a `"ctx-ui"` fallback path.** Both paths must agree on field names. Mitigation: `"ctx-ui"` reads top-level `properties` keys directly from `rjsfSchema`, so name agreement is automatic for primitive-typed fields.

- **[Trade-off] Validation runs client-side only; extension still needs to revalidate on receive.** Standard for any client-validated form. Documented in the spec.

## Migration Plan

This change is purely additive:

1. **Phase 4.1 — Schema + bridge fallback** (`packages/shared`, `packages/extension`): extend `UiView` discriminator; add bridge handler for `"ctx-ui"` / `"defaults"` / `"reject"`. No breaking changes to Phase 1 modules.
2. **Phase 4.2 — Theme components** (`packages/client/src/components/extension-ui/rjsf-theme/`): add widget components with snapshot tests.
3. **Phase 4.3 — Dialog wiring** (`packages/client/src/components/extension-ui/GenericExtensionDialog.tsx`): add `view.kind === "rjsf-form"` branch; dynamic-import the RJSF bundle; surface validation errors and `_reply` errors.
4. **Phase 4.4 — Pure-pi fallback path** (`packages/extension/src/bridge.ts`): wire `NoDashboardError` for `"reject"` and decompose path for `"ctx-ui"`.
5. **Phase 4.5 — Optional pi-judo migration** (separate change in pi-judo repo): replace `ctx.ui.custom` save/discard gate with an `rjsf-form` module.

**Rollback:** revert the change. Phase 1 modules continue to work — the only path that uses RJSF is gated on `view.kind === "rjsf-form"`, which no shipping extension uses today.

## Open Questions

None. The design questions resolved during exploration:

1. **Should we ship a custom widget extension API?** **No.** Out-of-scope this phase. If the bundled widget set is insufficient, extensions can either upgrade their schema to use the existing widgets or wait for a follow-up `add-extension-ui-rjsf-custom-widgets` change.
2. **Should `rjsf-form` work outside `management-modal`?** **No this phase.** Decoration slots have stricter shape requirements; future phases may add `rjsf-form` to settings sections.
3. **Should the dashboard expose AJV `$data` (cross-field references)?** **Yes — RJSF's default config supports it.** No extra work; documented in the spec.
4. **How are async `_reply` errors surfaced?** **Inline error banner above submit button; modal stays open until user retries or cancels.** Same pattern as the Phase 1 confirm-dialog action error path.
