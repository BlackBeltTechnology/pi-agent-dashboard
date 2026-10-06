## 1. Tests first (red)
- [x] 1.1 `usage.test.ts` fixtures: a legacy-code-page JSON source (job `encoding`), a UTF-16 LE BOM source, a CSV source; app writing `audit("save")`, `"error,fix,align"`
- [x] 1.2 draft: decoding both encodings, type token split, counts, code candidates with cites
- [x] 1.3 gate refusals: cite without literal, unknown action/UC, bad kind, duplicate; `--complete` lists unmapped types
- [x] 1.4 aggregation: per customer × type/action/use case, active days, monthly series, pseudonymized users, logging-coverage-aware never-used findings
- [x] 1.5 privacy gate: fails on a leaked user name / ordernum; passes on clean output
- [x] 1.6 build-site: shared catalog has mapping and no counts; `--local` embeds usage

## 2. Implementation
- [x] 2.1 `scripts/usage.mjs`: `decodeSnapshot`, `usageDraft`, `checkUsage`, `aggregate`, `leakCheck`
- [x] 2.2 `diagrams.mjs usage-draft`, `check-usage`, `usage`, `check-usage-output`
- [x] 2.3 catalog Usage view + badges (local only)
- [x] 2.4 `render.sh` with `LOCAL=1`: **gate step** `check-usage --complete --app`, aggregate to `_local/usage/`, **gate step** `check-usage-output` (stop on leak)

## 3. Prompt + docs
- [x] 3.1 `prompts/usage-mapper.md` (+ agent def, routing row, wiring test)
- [x] 3.2 SKILL.md (both), `references/usage.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [x] 4.1 job `ui-extract/jobs/plantifier-usage.json` (Delta-Dot): 7 customers → `*_db.json` (2.10.6), `log` {type,user,time,object} typeSplit ",", `lllogs` {table+modType as type, time}, `encoding: windows-1250`
- [x] 4.2 mapper subagent over the ~40 distinct types; **gate** `check-usage --complete --app` exit 0
- [x] 4.3 **gate** `check-usage-output` clean; **gate** shared `catalog.html` contains no count/user (grep); **gate** `generic-skills.test.ts` green
- [x] 4.4 **gate** `run-pilot.sh` → `PILOT OK`; `_local/` still git-excluded
- [x] 4.5 Browser (local catalog): Usage view, PLB heat matrix; no page errors

## Notes

- CLI shapes: `check-usage <pkg> <app> <job> [--complete]`, `check-usage-output <dir> <job>` (positional job).
- Type token = last word of a type (`error,fix,align` → `align`): what the cite line must spell; a type built from several columns is joined with `:`.
- Privacy gate refined during the pilot (test first): event types, numbers under 4 digits and the job's reviewed `publicValues` are not secrets; matching is on whole tokens. The first pilot run was stopped by the gate on schema vocabulary (`process`, `changeover`, phase names) — the gate never prints the value.
- A type mapped to several actions credits each (e.g. `save` → 4 save triggers); use-case counts are not double-counted per type.
- Plantifier: job `ui-extract/jobs/plantifier-usage.json` (7 customers × `log` + `lllogs`, 2.10.6 snapshots); 54 types, 33 mapped (user 14, auto 15, repair 4), 21 unmapped (20 generic table-change types + `Settings_set`, no active writer in 2.11.1). `check-usage --complete` PASS, `check-usage-output` clean, `PILOT OK`; shared catalog holds mapping only; local catalog Usage view checked in the browser, no page errors.
