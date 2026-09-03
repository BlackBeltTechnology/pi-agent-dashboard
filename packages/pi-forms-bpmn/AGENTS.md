# DOX — packages/pi-forms-bpmn

pi package bundling two orthogonal, single-responsibility skills (NOT merged).
Distribution cohesion only; each skill stays focused. npm-workspace member of the
pi-agent-dashboard monorepo. The canvas-render recipe is NOT bundled here — it
lives in the dashboard `extension` package's `canvas-webapp` skill (see Notes).

## Files

| File | Purpose |
|------|---------|
| `package.json` | pi-package manifest. name `@blackbelt-technology/pi-dashboard-forms-bpmn`; `pi.skills` lists the 2 skill dirs (openforms-mui, bpmn-package-explorer); guarded `postinstall`→`scripts/ensure-openforms-deps.mjs`; `files` whitelist keeps tarball small (node_modules/canvas-dist excluded). Node ≥20.12. |
| `.gitignore` | Excludes working-copy artifacts: `**/node_modules`, `**/canvas-dist`, `**/dist`, `*.log`. |
| `.pi/skills/bpmn-package-explorer/SKILL.md` | Skill root. Generate/validate/view vendor-neutral BPMN 2.0 packages (`.bpmn`+`.dmn`+`.form`+`package.yaml`) from prose. Buildless+offline, Node ≥20.12; layout guard aborts on corrupt output. CLIs `scripts/{generate,serve,view}-cli.mjs`. |
| `.pi/skills/bpmn-package-explorer/assets/VENDORED.md` | Pinned vendor manifest. bpmn-js@18.24.0 + dmn-js@17.10.1 (bpmn.io License) whole-file hash-compared; `assets/lib/bpmn-pipeline.mjs` + `yaml.mjs` (esbuild 0.24.0) inputs hash-recorded. Node floor 20.12. No version ranges. |
| `.pi/skills/bpmn-package-explorer/references/authoring-envelope.md` | Generation contract. Semantics-only vendor-neutral BPMN, no `bpmndi:`/`dc:`/`di:`/engine namespaces; allow-listed constructs only; `<bpmn:incoming>`/`<bpmn:outgoing>` mandatory. Rejected → substitutions (subProcess→callActivity, pools→participant, laneSet→roles, messageFlow rejected). Regenerate refused; file = source of truth. |
| `.pi/skills/bpmn-package-explorer/references/identifiers.md` | Deterministic ids `<Prefix>_<slug(deburr(name))>` via element-type prefix table (`Start`,`End`,`Task`,`Activity`,`Gateway`…); unnamed non-bindable → ordinals. Duplicate name / post-deburr collision = hard error. Ids opaque after authoring; reconciliation matches on `name`, not id. |
| `.pi/skills/bpmn-package-explorer/references/layout-envelope.md` | Measured envelope. 8 fixtures (`node scripts/fixtures.mjs`): linear/gateway/boundary/loop/long-chain pass; subProcess (G1+G3), pools, lanes fail. Guard invariants P1-P3 presence, G1-G5 geometry; strict vs advisory modes. |
| `.pi/skills/bpmn-package-explorer/references/licensing.md` | Licensing. bpmn.io License (`assets/LICENSE.bpmn-io.txt`): watermark to https://bpmn.io unmodified + fully visible (lower-right reserved) = acceptance criterion. OpenForms Apache 2.0 attribution on render; MIT/ISC pipeline deps. |
| `.pi/skills/bpmn-package-explorer/references/package-manifest.md` | `package.yaml` contract: `entry` + 4 binding kinds (`decision`→businessRuleTask, `form`→userTask, `process`→callActivity, `participant`→file-scoped); relative paths, symlink-escape rejected, duplicate keys error. Dangling=error, orphan=warning. Reconciliation matches on `name`; never rewrites non-interactively. |
| `.pi/skills/openforms-mui/SKILL.md` | Skill root. React+MUI runtime interpreting OpenForms `FormSchemaJSON` (github.com/henriquefps/open-forms, Apache 2.0): 14 field types, CNF logic, calculated fields, validation. No codegen. Single-instance resolution required (`resolve.dedupe`). `npm run diagnose`/`preview` from `tools/`. |
| `.pi/skills/openforms-mui/references/a11y.md` | A11y: no serious/critical axe violations across 14 types. Error summary receives focus; truthful required marking; reveals announced (WCAG 4.1.3). Matrix table→cards < `md`; repeater `useFieldArray` min/maxItems; signature `role="img"` + keyboard Clear; 48px touch floor. |
| `.pi/skills/openforms-mui/references/field-widget-map.md` | 14 types → MUI widget → exact value shape (`header`/`paragraph` no key, `number` empty `null`, `checkbox` `string[]`, `signature`/`file` base64). Payload keys on applicability: hidden omitted, disabled included. `onFieldChange` = complete state, not payload. `optionsType:"api"` disabled. |
| `.pi/skills/openforms-mui/references/hu-locale.md` | Opt-in `locale="hu"` Hungarian UI dictionary (`tools/src/i18n/hu.ts`); en default. `HU_DATE_DISPLAY_FORMAT` `YYYY. MM. DD.`; `formatHuf` → `1 234 567 Ft`; opt-in `HU_MASKS` (tax id 10 digits, postal 4, phone `+36 ## ### ####`). |
| `.pi/skills/openforms-mui/references/logic.md` | CNF `andGroups`: AND between groups, OR within; empty `andGroups` = not satisfied (hides target). Rules replace static value. `contains` = case-insensitive substring; unknown operator → `equals`. Calculated fields: recursive-descent parser, never eval. `explainRules(schema, answers)` drives debug panel. |
| `.pi/skills/openforms-mui/references/schema.md` | FormSchemaJSON per `tools/src/schema/types.ts`: Page→Section→Row→Column→Field; 14-type union on `type`; `Condition`/`ConditionGroup`/`ConditionalRule`/`CrossFieldRule` shapes. `normalizeSchema` idempotent; diagnostics codes (`duplicate-key`, `empty-and-groups`, `unparseable-formula`…). Legacy `visibilityCondition`/`expression` migrated. |
| `.pi/skills/openforms-mui/references/theme-bridge.md` | Theme bridge. No literal colours/spacing in widgets (token-lint enforced); inherit host `ThemeProvider` or `themeFromTokens(ui-contract.tokens.json)` (DTCG color/radius/font/spacing), `defaultTheme()` fallback. tokens.css ↔ ui-contract.tokens.json ↔ `src/theme/from-tokens.ts` sync-tested. Roboto bundled. |
| `README.md` | Why-bundled-not-merged rationale; install (`pi install`/`-l`/`-e` + `pi config`); note that the canvas-render recipe lives in the dashboard `extension` package's `canvas-webapp` skill (not bundled here); requirements. |
| `NOTICE` | Third-party attribution. OpenForms Apache-2.0 (clean-room schema, no vendored source); bpmn.io License (MIT + watermark obligation, do NOT disable); runtime dep licenses. |
| `scripts/ensure-openforms-deps.mjs` | Guarded postinstall. Installs `.pi/skills/openforms-mui/tools` deps ONLY if `node_modules/.package-lock.json` missing (nested tools/ is not a workspace member, so root install skips it). No-op otherwise; never fails the whole install. |

## Subfolders

- `.pi/skills/openforms-mui/` — MOVED from `~/.pi/agent/skills`. OpenForms→MUI runtime; bundler-based Vite lib under `tools/` (own package.json, React/MUI peer+dev). Owns its SKILL.md + `references/`. Canvas section cross-references the dashboard extension's `canvas-webapp` skill.
- `.pi/skills/bpmn-package-explorer/` — MOVED from `~/.pi/agent/skills`. Buildless/offline BPMN+DMN package generator/viewer; vendored bpmn.io viewers + Node layout bundle; `scripts/` CLIs; `assets/` vendored bundles + licenses.

## Notes

- **Not merged, bundled.** openforms (needs bundler+React/MUI) and bpmn (deliberately buildless/offline) have opposite build philosophies; merging would break bpmn's offline guarantee. The package is the cohesion unit.
- **canvas-webapp not bundled here:** the canvas-render recipe lives ONLY in the dashboard `extension` package (its `canvas-webapp` skill), present in any dashboard session — the only context where the canvas exists. The two skills cross-reference it by name; no copy is kept here, so there is no name-shadowing. (It was briefly bundled at 0.7.0, then dropped once verified byte-identical to the extension copy.)
- After MOVE the two skills no longer auto-load from `~/.pi/agent/skills`; they load only when this package is installed (`pi install`). Register globally to keep them available everywhere.
