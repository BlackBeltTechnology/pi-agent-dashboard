## Why

Specs say what the code can do, not what customers do. Many legacy apps keep their own audit or
change logs; a snapshot of them shows real use. Pilot evidence (Plantifier demo snapshots, audit
logs `log` and `lllogs`): `log` (user, time, type, object, before/after) and `lllogs` (table-level change log).
PLB: 13,687 log rows over 2017-10..2018-12 by 4 users (moveProcToTime 6,055, error/fix/align 1,778,
moveProcAfter 1,377, save 1,229, report 615, addOrderLine 351, …) and 254 lllogs rows; granit 351,
audi 92, protokon 91, ac 50 (+637 lllogs), ivanka 17, ctc 53 lllogs. Usage ranks use cases for the
rebuild scope (what is used daily vs never) and exposes hidden automation (the error/fix family
is the app repairing its own plan). Snapshots are cp1250 or UTF-16 LE JSON.

## What Changes

- Usage **job** (project-owned, no app knowledge in the skill):
  `{sources: [{customer, file, encoding?, format: json|csv, table, columns: {type, user, time, object?},
  typeSplit?: ",", kind: event|change}]}` — an application audit/event log or a table change log in
  a snapshot (decoded: UTF-16 by BOM, else UTF-8, else `encoding`).
- `diagrams.mjs usage-draft <pkg> <app> <job.json> <out.json>`: distinct event types (split by
  `typeSplit`) with counts per source, plus code candidates: app lines containing the type literal
  (cite).
- Record `diagrams/usage/mapping.json` (shared, no customer data):
  `types: [{type, cite: "file:line", actions: ["<SCR>#<ACT>"], useCases, kind: user|auto|repair}]`,
  `unmapped: [{type, reason}]`, written by `rsfr-usage-mapper` (`prompts/usage-mapper.md`).
- **Gate `check-usage <pkg> --app <app> --job <job> [--complete]`**:
  - cite line contains the type literal; actions/use cases resolve; kind valid; no duplicate type;
  - `--complete`: every type seen in any source is mapped or unmapped with a reason.
- Aggregation (deterministic, `usage <pkg> <job> <outDir>`): per customer × type / action / use case /
  screen counts, active days, monthly series, users pseudonymized (`user~k`); findings: actions with
  no logging ("not logged" — never "never used"), logged actions never seen, most-used use cases,
  share of `auto`/`repair` events; per-source span and size so short demo snapshots are visible.
- **Privacy gate `check-usage-output <dir> --job <job>`**: fails if any user value or any non-type
  string of the sources appears in the output (same leak check as masked object diagrams).
- Output to `PKG/_local/usage/` (git-excluded) and `_local/catalog.local.html` only. Shared catalog:
  mapping only (which actions log, no counts).
- Catalog (local): **Usage** view (customer × use case heat matrix, per-action counts, timeline),
  usage badge on use-case/screen/action pages.

## Capabilities

### Modified Capabilities
- `rebuild-package-diagrams`: usage mapping gate, aggregation, privacy gate, local catalog view.
- `reverse-spec-for-rebuild`: usage mapper prompt and step.

## Impact

`scripts/usage.mjs` (new), `diagrams.mjs`, `site.mjs`, `catalog.js`, `render.sh` (`LOCAL=1` only),
SKILL.md files, `agents/rsfr-usage-mapper.md`, tests. No dependency. Snapshots are never copied.

## Open questions

- Are the shipped `*_db.json` snapshots real customer data or demo seeds? PLB (14 months, real
  usernames) looks real; the others span days and may be test data — the report flags span and size
  per customer, and DeltaDot should confirm.
- Shared catalog could carry ranked aggregates (no names, no counts) — default: no, until approved.

## Discipline Skills

`security-hardening` (customer data, PII masking), `doubt-driven-review`.
