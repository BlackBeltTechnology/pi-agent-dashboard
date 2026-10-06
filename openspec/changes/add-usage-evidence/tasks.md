## 1. Tests first (red)
- [ ] 1.1 `usage.test.ts` fixtures: a legacy-code-page JSON source (job `encoding`), a UTF-16 LE BOM source, a CSV source; app writing `audit("save")`, `"error,fix,align"`
- [ ] 1.2 draft: decoding both encodings, type token split, counts, code candidates with cites
- [ ] 1.3 gate refusals: cite without literal, unknown action/UC, bad kind, duplicate; `--complete` lists unmapped types
- [ ] 1.4 aggregation: per customer × type/action/use case, active days, monthly series, pseudonymized users, logging-coverage-aware never-used findings
- [ ] 1.5 privacy gate: fails on a leaked user name / ordernum; passes on clean output
- [ ] 1.6 build-site: shared catalog has mapping and no counts; `--local` embeds usage

## 2. Implementation
- [ ] 2.1 `scripts/usage.mjs`: `decodeSnapshot`, `usageDraft`, `checkUsage`, `aggregate`, `leakCheck`
- [ ] 2.2 `diagrams.mjs usage-draft`, `check-usage`, `usage`, `check-usage-output`
- [ ] 2.3 catalog Usage view + badges (local only)
- [ ] 2.4 `render.sh` with `LOCAL=1`: **gate step** `check-usage --complete --app`, aggregate to `_local/usage/`, **gate step** `check-usage-output` (stop on leak)

## 3. Prompt + docs
- [ ] 3.1 `prompts/usage-mapper.md` (+ agent def, routing row, wiring test)
- [ ] 3.2 SKILL.md (both), `references/usage.md`, AGENTS.md rows

## 4. Pilot (Plantifier) — gate steps
- [ ] 4.1 job `ui-extract/jobs/plantifier-usage.json` (Delta-Dot): 7 customers → `*_db.json` (2.10.6), `log` {type,user,time,object} typeSplit ",", `lllogs` {table+modType as type, time}, `encoding: windows-1250`
- [ ] 4.2 mapper subagent over the ~40 distinct types; **gate** `check-usage --complete --app` exit 0
- [ ] 4.3 **gate** `check-usage-output` clean; **gate** shared `catalog.html` contains no count/user (grep); **gate** `generic-skills.test.ts` green
- [ ] 4.4 **gate** `run-pilot.sh` → `PILOT OK`; `_local/` still git-excluded
- [ ] 4.5 Browser (local catalog): Usage view, PLB heat matrix; no page errors
