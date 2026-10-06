# Usage evidence

Real use from the application's own logs. Code: `scripts/usage.mjs`. Mapping log types to code
and UI is a gated subagent step; aggregation and the privacy gate are deterministic. Customer data
stays local.

## Job (project-owned)

`{sources: [{customer, file, encoding?, format: json|csv, table?, columns: {type: col | [cols],
user?, time?, object?}, kind: event|change}], codeDirs?}` — `file` relative to the job; JSON
sources hold `table` as an array of rows, CSV sources a header row; a type built from several
columns is joined with `:`. Decoding: UTF-16 by BOM, else UTF-8, else `encoding` (default
windows-1252). Times: epoch ms, epoch s, or ISO strings.

## Steps

1. `usage-draft PKG APP JOB out.json` — distinct types, `token` (last word, `error,fix,align` →
   `align`), counts per customer, `candidates` (app code lines with the token in quotes, up to 10).
2. Mapper (`reverse-spec-for-rebuild` `prompts/usage-mapper.md`, agent `rsfr-usage-mapper`) writes
   `diagrams/usage/mapping.json`: `types: [{type, cite, kind: user|auto|repair, actions, useCases}]`,
   `unmapped: [{type, reason}]`. Shared: no customer values.
3. Gate `check-usage PKG APP JOB [--complete]`: cite line contains the token; actions and use cases
   exist; kind valid; no duplicate type (mapped or unmapped); `--complete`: every type in any source
   is mapped or unmapped. `build-site` gates the record structurally.
4. `usage PKG JOB OUT` (OUT = `PKG/_local/usage`, git-excluded): per customer events, users
   (`user~k` by activity), counts by type / kind / action / use case (explicit + via merged use-case
   UI actions), months, span; findings: sources, most used use cases and actions, kinds, logged
   but never seen per customer, **not logged** actions (no evidence either way — never "unused").
5. Privacy gate `check-usage-output OUT JOB`: fails naming the file (never the value) when any
   user value or string leaf of an object column (≥ 3 chars) appears in an output file.

## Catalog

**Usage** view: shared build = log type → kind, actions, use cases, cite; local build (`--local`,
reads `_local/usage/usage.json`) adds sources, customer × use-case heat table, most used actions,
not-logged count.
