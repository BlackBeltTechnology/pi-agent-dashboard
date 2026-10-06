## Why

`reverse-spec-for-rebuild` and `rebuild-package-diagrams` must work on any legacy app, but the
UI-extraction layer grew out of the Plantifier pilot and still carries it: the built-in adapter
`angularjs-hta` is a Plantifier profile (`html/ang.htm` views array, `conf/<cust>` layering,
`js/admin.js` DEFAULT, `orders.add` form views, `OpBar` toolbar, `_STR_` strings, font-awesome 4.5),
`screen-plan.mjs` hard-codes AngularJS (`ng-*`, `{{ }}`, `str()`, lodash case wrappers, `label.hu`,
`modalw` dialog classes, `lang="hu"`), `lib.mjs` defaults to windows-1250, `objects-from-db` tries
only UTF-8/windows-1250, `crud.mjs` aliases `CONF.db.tables.<key>`, and prompts/references/tests use
Plantifier examples. App knowledge belongs in a project-owned profile, not in the skill.

## What Changes

- **Generality gate** (`generic-skills.test.ts`): fails when a skill file outside `adapters/` and
  vendored `assets/` names a pilot app or customer, or uses an app convention
  (`CONF.`, `OpBar`, `_STR_`, `windows-1250`/`cp1250`), when a non-adapter script handles `ng-*`
  attributes, or when a built-in adapter carries app file paths. Regression gate from then on.
- **Adapter profiles**: an adapter may declare `parent: "<built-in>"`; the loader merges it over
  the base (`dialect` merged key-wise). Helpers passed to hooks gain `parseLiteralAt`, so a
  project profile needs no import into the skill.
- **Template dialect hook** `adapter.dialect` drives `screen-plan.mjs`: interpolation delimiters,
  control/drop/select tags, click/model/change/bind attributes, `condition`, `repeat`,
  `switchValues`, `exprText` (i18n calls, field label/key expressions), `decide` (conjuncts in field
  repeats), CSS `classes` (view, dialog parts, button), `language`. Without a dialect: plain HTML.
  `shell` optional, `shell.toolbarId` replaces the fixed `#header`.
- **Built-in `angularjs` adapter** (generic AngularJS 1.x): `$routeProvider.when` / ui-router
  `.state` routes, ng-* inventory patterns, `templateUrl` loads, native dialogs, AngularJS dialect,
  `{{ 'k' | translate }}` labels via `strings` when provided. `angularjs-hta` is removed; Plantifier
  becomes a project profile (in the Delta-Dot project, `parent: "angularjs"`).
- **Encoding is a parameter**: `adapter.encoding` (legacy code page, default `windows-1252`
  fallback only after UTF-16 BOM / valid UTF-8); `objects-from-db` job `encoding` (+ BOM detection).
- **CRUD aliases**: generic — `table X`, `collection X`, and the last segment of dotted identifiers
  in `Persistence` (replaces `CONF.db.tables.<key>`).
- `forms.mjs`: label language from `adapter.language` (default `en`), translations from the others.
- Prompts, references, SKILL.md, tests: neutral examples; pilot results stay in the pilot project.

## Capabilities

### Modified Capabilities
- `reverse-spec-for-rebuild`: adapter profiles + dialect, generic built-in adapter, encoding parameter.
- `rebuild-package-diagrams`: generic CRUD aliases, `objects-from-db` encoding.

## Impact

Breaking for callers of adapter name `angularjs-hta` (only the Plantifier pilot): pass the profile
path instead. Pilot output must stay byte-identical (177 files under `ui/`, `diagrams/crud-matrix`,
`behaviour`, `objects`). Rollback: revert the commit; the pilot keeps the copied profile.

## Discipline Skills

`code-simplification`, `doubt-driven-review` (adapter contract change).
