---
name: openforms-mui
description: >-
  Author, render, preview and debug OpenForms FormSchemaJSON form definitions as
  idiomatic, themed, accessible MUI (React). Use when the user wants to design an
  OpenForms form, render an OpenForms schema with Material UI, convert an
  OpenForms JSON schema into a React MUI form, preview a form schema, or debug
  conditional-logic / calculated fields / cross-field validation in an OpenForms
  schema. This is the OpenForms *form-builder* schema (github.com/henriquefps/open-forms) —
  NOT the "open-form.dev" documents-as-code framework, which this skill does not cover.
---

# openforms-mui

Runtime interpreter that renders an OpenForms `FormSchemaJSON` as MUI. Walk the
schema on every render — **no code generation, no emitted per-form files**. The
component mirrors the upstream `OpenFormRenderer` API so migration is a
mechanical substitution.

## What this skill is (and is not)

- **Is:** a React + MUI runtime for the visual **form-builder** schema from
  `github.com/henriquefps/open-forms` (Apache 2.0). It implements all 14 field
  types, both conditional-logic systems, calculated fields, and validation.
- **Is not:** the `open-form.dev` "documents as code" framework. If a request is
  about `open-form.dev`, this skill does not apply.

## Where it lives

```
~/.pi/agent/skills/openforms-mui/
  SKILL.md
  references/            # load only the one you need
    schema.md            # FormSchemaJSON structure
    field-widget-map.md  # 14 types → MUI widget → value shape
    logic.md             # CNF andGroups, operators, formula grammar
    theme-bridge.md      # tokens → createTheme(); host theme provider
    a11y.md              # matrix / repeater / signature pitfalls
    hu-locale.md         # Hungarian conventions (opt-in via locale)
  tools/                 # the TypeScript library + preview harness
    src/                 # component, schema, logic, validation, theme, i18n
    preview/             # Vite three-panel harness + CLI
    tests/               # vitest suite
    mockups/             # approved token layer (tokens.css, ui-contract.tokens.json)
```

The skill is **user-global** — usable from any working directory, with no
assumption about any particular project or document archive.

## Using the component in a project

```tsx
import { OpenFormsMui } from "openforms-mui"; // resolves to tools/src/index.ts

<OpenFormsMui
  schema={schema}
  answers={initialAnswers}
  readOnly={false}
  locale="en"                 // "hu" enables the Hungarian UI dictionary
  onSubmit={(answers, meta) => {
    // answers: upstream-shaped, keyed by field key (applicable fields only)
    // meta.submissionContext: your supplementary data, segregated from answers
    // meta.diagnostics: non-blocking findings (e.g. disabled/calculated violations)
  }}
  onFieldChange={(all) => {/* COMPLETE state incl. retained hidden values — not the payload */}}
/>
```

### Single-instance resolution (required)

This is the **first** user-global skill to ship a `package.json` with installed
dependencies. A consuming project that imports the component out of this
directory must resolve React, `react-dom`, `@mui/material`, `@mui/x-date-pickers`,
`@emotion/react` and `@emotion/styled` to **one** instance — a second React
instance makes hooks throw an *invalid hook call*, and Emotion/MUI theme context
break because they rely on module-level singletons.

These packages are declared as **`peerDependencies`** (the consumer supplies
them) and additionally as **`devDependencies`** (so the preview harness runs
standalone). They are **never** plain `dependencies`.

Resolve to one instance at the bundler level:

- **Vite:** `resolve.dedupe: ["react", "react-dom", "@mui/material", "@emotion/react", "@emotion/styled"]`
- **Webpack:** `resolve.alias` each of the above to the consumer's copy, or use
  `resolve.dedupe`/a single `node_modules`.
- **A monorepo:** hoist these packages so one copy is shared.

The preview harness and the vitest config already dedupe; a regression test
(`tests/singleton.test.tsx`) pins single-instance resolution.

## Preview & diagnose (CLI)

From `tools/`:

```bash
npm run diagnose -- path/to/schema.json      # print findings; exit 1 on any error
npm run preview  -- path/to/schema.json       # three-panel Vite harness
npm run preview  -- path/to/schema.json --reference   # side-by-side upstream 1.0.7
```

The harness shows: the rendered MUI form (with a **Rendered form ↔ Schema
source** view switch), the live `answers` JSON with validation errors, and a
CNF rule-debug panel showing each condition's operand values and outcome. It
reloads on schema-file save (answers preserved) and inspects mobile/tablet/
desktop widths. `--reference` loads the pinned upstream vanilla renderer in an
isolated frame for fidelity checking — this is the only place upstream code is
loaded and it is **never** part of the shipped library.

## Rendering a form on the pi-dashboard canvas

The `npm run preview` harness is a **Vite dev server** — great for local
inspection, but it does **not** render on the pi-dashboard canvas. The dashboard
loads a loopback `canvas(kind:"url")` target inside a `sandbox="allow-scripts"`
iframe with **no `allow-same-origin`** (opaque origin), proxied under
`/live/<id>/`. Two things break there:

1. **Vite dev → blank.** Vite emits absolute asset paths (`/main.tsx`,
   `/@vite/client`) and the harness fetches `/__schema.json`; under the
   `/live/<id>/` prefix these resolve to the dashboard root → 404 → blank.
2. **Static build without CORS → blank.** In the opaque-origin iframe a
   `<script type="module">` is fetched in CORS mode with `Origin: null`, so the
   static server **must** send `Access-Control-Allow-Origin: *` or the module is
   blocked (a plain `python3 -m http.server` renders blank).

**Working recipe** (reusable assets live in `tools/`):

```bash
cd tools
# 1. Static build with RELATIVE base + statically-imported schema:
#    preview/canvas-app.tsx, preview/canvas-index.html, vite.canvas.config.ts
npx vite build --config vite.canvas.config.ts        # → canvas-dist/
cp canvas-dist/canvas-index.html canvas-dist/index.html   # proxy root serves it
# 2. Serve with CORS headers (canvas-serve.mjs sets Access-Control-Allow-Origin: *)
node canvas-serve.mjs 5181
```

Then `canvas(target:{kind:"url", url:"http://127.0.0.1:5181/"})`. To point the
canvas at a *different* schema, edit the static import in `preview/canvas-app.tsx`
(it imports `../demo-schema.json`) and rebuild. Self-verify before touching the
canvas by iframing your own server with `sandbox="allow-scripts"` and
screenshotting — that reproduces the exact dashboard sandbox. See the global
skill **`canvas-webapp`** (bundled with the pi-dashboard extension) for the full
rationale and pitfalls (IPv6-only Vite binds, `kill %1` not persisting across
tool calls).

## Guided schema authoring (natural language → FormSchemaJSON)

1. Read the description; enumerate the fields, their types, and any repetition,
   conditional visibility, requiredness, or cross-field constraints.
2. Choose types from `references/field-widget-map.md`. Model a repeating group as
   a **`repeater`**, a single-choice grid as a **`matrix`**, a derived number as a
   calculated `number` (`isCalculated` + `formulaExpression`).
3. Express conditions as CNF `andGroups` (AND between groups, OR within) per
   `references/logic.md`. Cross-form constraints go in root `crossFieldRules`.
4. Run `npm run diagnose -- schema.json`. **Resolve every `error` finding**
   before presenting the schema as complete (warnings/infos are advisory).
5. `npm run preview -- schema.json` and iterate.

## Iteration loop

Interpret → serve preview → run the automated accessibility check → correct
findings → repeat until **no serious or critical** violations remain. The
bundled a11y test (`tests/a11y.test.tsx`) runs axe over a schema covering all 14
field types; use it as the gate.

## Deferred scope (do not attempt)

- **Remote option loading** (`optionsType: "api"` / `optionsUrl`): unsupported.
  Such a field renders **disabled with an empty option list and a diagnostic** —
  that diagnostic is *expected*, not a bug to fix.
- **Upstream visual builder** (`builder.js`): not integrated. Schemas are
  authored by hand, by an agent, or exported from the upstream builder.

## Attribution & provenance

The schema contract originates from **OpenForms**
(`github.com/henriquefps/open-forms`), which is **Apache 2.0** licensed. This
skill is a **clean-room re-implementation** from the published schema reference
and observed semantics — **no upstream renderer or builder source is vendored**.
The pinned reference version is **1.0.7** (see `tools/src/provenance.ts`, the
single source of truth used by both this attribution and `--reference` mode).

Upstream publishes no npm package and its public repository is a single squashed
commit mirrored from a private repo, so no release cadence can be assumed. Our
TypeScript types and diagnostics pin the schema contract; `--reference` mode is
the mechanism for detecting upstream behavioural drift.
