# SKILL.md — rebuild-package-diagrams index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/SKILL.md. Render `reverse-spec-for-rebuild` package → ER (Mermaid), use cases (BPMN 2.0), browsable `catalog.html`. Agent judges; deterministic script gates.

Trigger: "ER diagram from the entities", "draw the data model", "use cases as BPMN", "browsable HTML of the rebuild package", "ER diagram az entitásokból", "üzleti folyamat BPMN-ben".

## Inputs
- `PKG` = dir with `model.md`, `rules.md`, `quirks.md`, `gaps.md`, `capabilities/<cap>/spec.md`. Output `PKG/diagrams/`. Source never edited.
- `D = node <skill>/scripts/diagrams.mjs`; subcommands: `extract-model`, `render-er`, `check-trace`, `check-use-cases`, `build-site`. Node ≥ 20, no deps; exit 2 = bad usage.
- Libs: `scripts/lib.mjs`, `scripts/site.mjs`, `templates/catalog.{html,css,js}`.
- Optional peers: `mmdc` (PNG/SVG), `bpmn-package-explorer` (BPMN layout/validation/viewer).

## ER procedure
1. `$D extract-model PKG/model.md > PKG/diagrams/model.json`.
2. Classify entities per `references/er-mapping.md`: domain | config | ui | test | technical. Only domain on main diagram. Write `PKG/diagrams/er-scope.md` (entity · class · reason).
3. Cluster domain entities into 4–8 groups (≤ ~15 each; capabilities = first cut).
4. Author `PKG/diagrams/er/<cluster>.json` + `overview.json` (≤ ~25 hubs, no attributes). Schema `references/er-mapping.md`. Keys `PK`/`FK`/`UK`. Relations: `cardinality`, `label`, `confidence`, `evidence`. Evidence = verbatim substring of endpoint `Relationships:` or exact field name on endpoint.
5. `$D render-er <x>.json model.json > <x>.mmd`. Exit 1 = fix JSON, never check. Non-`confirmed` relations render dashed.
6. `mmdc -i x.mmd -o x.png -b white -s 2`.

## BPMN procedure
1. Use-case inventory per `references/bpmn-mapping.md`: requirement = use case when actor (role, ERP, timer) triggers multi-step outcome with decision/failure path. Pure data/render/config excluded.
2. `PKG/diagrams/use-cases.json`: `[{id, name, actor, trigger, requirements: ["spec:<cap>#<Requirement>"], refs: ["BR-…"], entities, bpmn?: "bpmn/<uc>/<uc>.bpmn"}]`. Run `$D check-use-cases PKG` (dangling reqs/refs, unknown entities, missing bpmn, duplicate ids). Ask user if >~8 candidates.
3. Per use case: semantics-only `.bpmn` (no DI) in `PKG/diagrams/bpmn/<uc>/`. WHEN → start/gateway; THEN → tasks; failures → error branches; actors → `roles` in `package.yaml` (no lanes).
4. Every non-start/end node: `<bpmn:documentation>` with `BR-NNN`, `QUIRK-NNN`, `GAP-NNN`, `spec:<cap>#<Requirement>` (exact heading).
5. `$D check-trace <file.bpmn> PKG`.
6. With `bpmn-package-explorer`: envelope check, auto-layout + layout guard, viewer. Envelope: allow-listed elements, `incoming`/`outgoing` on flow nodes, `callActivity` not inline subprocess.
7. Quirks drawn as-is; name suffixed `(quirk)`. `GAP-` node → keep, do not guess branch.

## One-command render
- `scripts/render.sh PKG [APP]`: `check-use-cases` → `check-architecture --app APP` + `arch` (if `diagrams/architecture.json`) → `ifml` + `check-ifml` + `ifml-diff` (must print "no differences") (if `ui/screens/`) → `build-site` → `PKG/diagrams/catalog.html`. Ends `RENDER OK`.
- Env: `BPMN_JS_DIR` (default sibling bpmn-package-explorer assets), `MERMAID_JS`, `IFML_JS_DIR` (vendored `assets/ifml-js/`, ifml-js 0.3.0, keep watermark), `MAX_NODES`, `MAX_EDGES`, `STRICT_SIZE=1`, `USAGE_JOB`, `LOCAL=1`.

## Catalog procedure
1. Prereqs: ER gated; `use-cases.json` passes; `.bpmn` laid out. Optional `PKG/diagrams/questions.json`: `[{id, text, severity (key|high|medium|low), status?, source?, claim?, note?, codeCite?, refs, group?}]`.
2. Optional `PKG/ui/screens/*.json` (actions: trigger, handler, `guards`, `refs`, `effects[{kind, step, target, cite, refs}]`, dialogs, navigation, `forms[{form}]`) and `PKG/ui/forms/*.json`. Use-case optional `screens: ["SCR-…"]`, `altFlows: [{label, bpmn}]`. Alt-flow nodes may use `ui: <screen>#<action>`.
3. Build: `$D build-site PKG PKG/diagrams/catalog.html --bpmn-js <bpmn-navigated-viewer.production.min.js> --bpmn-css <diagram-js.css> --bpmn-css <bpmn.css> --bpmn-css <bpmn-font/css/bpmn-embedded.css> --mermaid <mermaid.min.js>`. Assets: `bpmn-package-explorer/assets/bpmn-js/`; `mermaid.min.js` in mmdc install `…/@mermaid-js/mermaid-cli/node_modules/mermaid/dist/`. Missing lib → notice in place of diagram. ~5 MB offline.
4. Page: tabs (use cases, capabilities, rules, quirks, gaps, entities), search; multi-select merge view (`#sel=UC-01,UC-03&view=merge`); `shared` markers; related use cases by overlap; two-way links; open questions.
5. Serve over HTTP or open file.

## Pitfalls
- `persistent` flag = hint; in-memory aggregates can be core domain; config tables mention "table". Classify by reading.
- No FK from naming alone; `*_id` = evidence only if `Relationships:` or target identity supports. Unknown cardinality → weaker + `confidence: inferred`.
- Polymorphic links: one edge per real target, `inferred`, named in label.
- Mermaid `erDiagram` names must be identifiers; script maps others to `_`.
- `mmdc` "Could not find Chrome": `-p cfg.json` with `{"executablePath": "<Chrome>", "args": ["--no-sandbox"]}`.
- Cross-capability use case: `spec:` refs from each; do not merge on shared screen.
- `spec:` refs end at `;` or newline; `spec:cap#Name (note)` dangles.
- Unspecified algorithm → keep step, say so in documentation; never draw internals.
- `generate-cli.mjs`: pass package dir as **absolute** path (relative `.` → self-ref symlinks → 404). Writes `diagnostics.json`. `UNBOUND` warnings expected w/o forms/decisions.

## Verification
- Every `er/*.json` passes `render-er` (exit 0); `er-scope.md` lists each `model.json` entity once.
- Every `.bpmn` passes `check-trace`; `use-cases.json` passes `check-use-cases`.
- `catalog.html` opens offline; multi-select merge shows flows + ER + shared markers.

## Optional sections (see SKILL.md)
- Screen plans + style kit: `PKG/ui/style-kit.json`, `PKG/ui/plans/<screenId>.html`; catalog `#view=kit:`.
- Use-case UI links: `uc-link-draft`, `diagrams/uc-links/<UC>.json`, `check-uc-links --complete`.
- Variability: `variability-draft`, `check-variability PKG APP --complete`, `variability` → CSV/md/FeatureIDE.
- Usage: `usage-draft`, `check-usage ... --complete`, `usage` → local only, `check-usage-output` privacy gate.
- CRUD: `crud-draft`, `check-crud --complete`, `crud` → CSV/findings.
- Size: `--max-nodes` 30 / `--max-edges` 40; `check-size [--strict]`.
- Behaviour: `sequence-from-ui` + `check-sequences`; `check-states`; `objects-synth` / `objects-from-db` (`_local/`, masked) + `check-objects`.
- Architecture: `diagrams/architecture.json`; `check-architecture --app`; `arch` → `workspace.dsl` + `c4.md`.
- IFML: `ifml`, `check-ifml`, `build-site --ifml-js`; reverse `ifml-to-ui`, `ifml-diff` (`--apply` never deletes).
