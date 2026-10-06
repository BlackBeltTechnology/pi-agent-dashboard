# Frontend UI-model extraction

Optional phase for applications with a user interface. Turns the frontend into a gated UI
model inside the rebuild package (`PKG/ui/`), which `rebuild-package-diagrams` renders
(Screens/Forms tabs, IFML, screen plans, style kit, flows from code). Programs live in
`scripts/ui-extract/` — dependency-free Node >= 20, deterministic except step 4. Every
output cites `file:line` relative to the application root (`APP`).

`UX` below is `node <this skill dir>/scripts/ui-extract`. `<adapter>` is a built-in name
(`angularjs`) or a path to a project adapter / profile `.mjs`.

## Steps

| # | Command | Output | Kind |
|---|---|---|---|
| 1 Inventory | `UX/inventory.mjs APP <adapter> PKG/ui/_inventory.json` | every behavioural site (click, model binding, key handler, menu item, toolbar action, modal, native dialog, template/controller) with `file:line` | deterministic |
| 2 Effective config | `UX/config.mjs APP <adapter> <variant> PKG/ui/_effective/<v>.json` (once per customer variant) | configuration the app really runs with, merged by the app's own code | deterministic (adapter `effectiveConfig`) |
| 3 Forms | `UX/forms.mjs PKG/ui/_effective/<v>.json <adapter> <formKey> <FRM-id> PKG/ui/forms`; `UX/screen-form.mjs PKG <DLG-id>` | config-driven form records (`FRM-*.json`) + OpenForms `*.form`; template-defined dialog forms | deterministic |
| 4 Screen records | `UX/fill.mjs prompts/ui-screen-generator.md <job.json> <ID>` → one subagent per screen/dialog | `PKG/ui/screens/<ID>.json` (format: `references/ui-model.md`) | LLM, gated |
| 5 Gate | `UX/gate.mjs APP PKG` | exit 0 = PASS; 1 lists `<ID>.json: problem` | deterministic |
| 5b Style kit | `UX/style-kit.mjs APP <adapter> <kit-job.json> PKG/ui` | `style-kit.json` (colour/font tokens with uses + cites, font-size/radius scales, components) + `style-kit.css` | deterministic |
| 5c Screen plans | `UX/screen-plan.mjs APP <adapter> PKG <ID> [effective.json]` per screen/dialog | `PKG/ui/plans/<ID>.html`; exit 1 names every unlinked control | deterministic, gate |
| 6 Flows from code | `UX/flow.mjs PKG <flows-job.json> <UC> <dir>` → bpmn-package-explorer `generate-cli.mjs <dir>` (layout) → `diagrams.mjs check-trace` | BPMN per use case from the UI actions (guards → gateways, validations → rule tasks, effects → service tasks, `ui: <screen>#<action>` per node) | deterministic |
| 7 Compare | `UX/compare.mjs <prose.bpmn> <from-code.bpmn>` | refs in both / only prose / only code | deterministic |

Helper: `UX/refs-for.mjs PKG <file> [from] [to]` lists the BR/QUIRK/GAP ids citing a code
range — the generator links these ids, never invents new ones.

Jobs (project files, not shipped): screen job `{common: {APP, PKG, SKILL}, screens: [{ID, KIND, TEMPLATE, SCOPE, HINTS}]}`;
flows job `{flows: [{id, name, capability, actor, system, start, end, steps: [{screen, action, name, form?, skip?}]}]}`;
kit job `{components: {<name>: [<selector>, …]}}` — selectors must exist in the app CSS.

Then render with the `rebuild-package-diagrams` skill: `render.sh PKG APP`.

## Adapter contract (`scripts/ui-extract/adapters/<stack>.mjs`)

Required for steps 1-3: `id`, `vendor` (dir regex skipped), `sources` (`[{dir, re}]`),
`patterns` (`[{kind, scope: js|html|all, re}]`, named group `name`), `routes(files, read)`,
`keep(row)`. Optional for config-driven forms: `effectiveConfig(app, variant, helpers)`,
`formViews`, `typeMap` (stack type → `text|number|date|boolean|dropdown`).

Style kit + plans: `styleSources(app, readText)` (app-owned stylesheets in link order,
vendor excluded), `planViews` (template repeat source → form view). Optional: `shell`
(`{file, toolbarId}`: the page around every screen and the id of its toolbar element),
`planAssets` (third-party CSS needed for fidelity, e.g. an icon font),
`strings(app, conf, readText, helpers)` (UI string table for labels), `toolbar` (`{ref, assign}`
regexes with group 1 = toolbar key: `ref` finds keys in conditions/handlers, `assign` finds keys
a toolbar action enables; without it the plan keeps every toolbar control), `encoding` (legacy
code page for sources that are neither UTF-16 nor valid UTF-8; default `windows-1252`),
`labelLanguages` (`{appLabelKey: openFormsLanguage}` for form translations).

**Template dialect** (`dialect`, read by `screen-plan.mjs`; without it the plan reads plain
HTML): `interpolation` (`[open, close]`), `controlTags` / `selectTags` / `dropTags`,
`controlAttrs` (make an element a control), `refAttrs` (scanned for toolbar keys),
`labelAttrs` (label fallback), `bindAttrs` (text bindings), `condition(attrs)`,
`repeat(attrs)`, `repeatList(expr)` (form-field repeat source), `repeatLabel(expr)`,
`switchValues(attrs)`, `switchType(field)`, `exprText(expr, env, ctx)` (`{text}` | `{ph}` |
undefined: i18n calls, field label/key expressions), `decide(conjunct, env)` (true/false/undefined
inside a field repeat), `classes` (`view`, `dialog`, `dialogHeader`, `dialogBody`,
`dialogFooter`, `button`), `language` (field-label language, page `lang`).

**Profiles.** An adapter file with `parent: "<built-in name or path>"` is merged over its parent
(`dialect` key-wise). Hooks receive helpers (`join`, `readText`, `lineAt`, `parseLiteralAt`), so a
profile needs no import from the skill. Built-in `angularjs`: AngularJS 1.x — ng-* inventory
patterns, `$routeProvider.when` / ui-router `.state` routes, `templateUrl` loads, `$uibModal`,
native dialogs, ng-* dialect with `{{ }}` and `'key' | translate`. App code is read statically
(`js-literal.mjs`), never executed. A new stack (React, Vue, Delphi DFM, Oracle Forms, APEX,
plain HTML…) needs only a new adapter; a new application only a profile. Keep the record format.

## Gate rules (`gate.mjs`)

Cites resolve to existing lines; template and form records exist; a handler name occurs in
its cited lines; BR/QUIRK/GAP/`spec:` refs resolve in the package; ids unique; `covers`
entries are real inventory rows; every behavioural inventory row in a record's `scope` is
covered or `unmapped` with a reason; a guard id may not also be a `validate` effect ref
(input validation is not a guard).

## Style kit rules

Colours become `--sk-c-<hex>` / `--sk-c-r-g-b-a` tokens, font stacks `--sk-font-<n>` plus
`--sk-font-base` (a `var()` of its token); font sizes and radii are reported as scales, not
tokenized. Layout rules stay as written (class names intact) so the original layout
survives; comments are blanked keeping line numbers; `@font-face` is dropped; invalid
declarations (no colon, e.g. a `//` "comment") are dropped as browsers do — one of them
otherwise breaks every later rule. A job component selector absent from the CSS throws.

## Screen-plan transform rules

- Keep the template's layout and control order inside the shell (toolbar + view slot) in a
  fixed 1366×768 frame (full-window layouts collapse otherwise).
- Repeats over a form view expand to one copy per field of that view (labels from the form
  record); only the switch branch matching the field's mapped type survives; `$first`,
  `$last` and field-type conjuncts are decided per field; other repeats render once,
  marked; option/choice lists are dropped; select widgets become stubs.
- Conditional content stays, marked with its condition; a condition whose only toolbar key
  the screen never enables is dropped. Framework attributes and bindings are stripped;
  bindings show as `‹placeholder›`, `str()` labels resolve through the string table;
  images inline as data URIs; existing HTML entities stay.
- Every control gets one number per source line and links to: an action (covers/trigger
  cite, or the toolbar key it enables), a screen field, a recorded `unmapped` reason, or
  the app shell (control found only in the shell file). Anything else is a gate error.
- Actions with no template control (context menu, keys, automatic, toolbar outside the
  shell) and every dialog (drawn with the app's own modal markup) are numbered too; the
  legend lists location + cite, label, target action, guards, effect steps.

## Pitfalls

- Sources may be UTF-16 (BOM) or a legacy code page (adapter `encoding`); always read through `lib.mjs` `readText`.
- Count only uncommented code: strip comments preserving line numbers before matching.
- Tracing stops at the data-layer boundary — say so in the effect `target`, do not guess.
- Browser checks of a regenerated plan/catalog: open a fresh URL; an in-place reload can
  show the previous document.
- Do not run a UX/design-system scorer on as-is plans: they document, they do not redesign.
