# DOX — packages/team-app/src/skills

One row per file. See change: add-team-skill-access.

| File | Purpose |
|------|---------|
| `SkillForm.tsx` | Add / edit / view one catalog skill. Add: source radio cards (installed picker with search; names already in the catalog disabled = `sk.inCatalog`; pick prefills name+path; save gated on pick, or absolute path + name). Edit: static name + path, users/targets radios + check-lists, config entries read-only (info callout, no save), impact preview (`POST /skills/:name/impact`) on every users/targets change ≠ entry, confirm dialog when `endSessions > 0` (Cancel focused, focus returns to Save), server errors → field errors + focused summary (`skill_exists`/`fields.name` → `sk.err.name`, `fields.path` → `sk.err.path`). Single-user mode: no users inputs, `sk.usersSingle` hint. Non-admin redirected to grid. See change: add-team-skill-access. |
| `SkillsPanel.tsx` | Admin skills list: one `.skill-row` per entry — name link → `/skills/:name`, source chip (`config`=purple, `managed`=blue), invalid rows (`name_mismatch` → `sk.invalidName`, `shadowed_by_config` → `sk.shadowed`, else path invalid) + consequence hint + usage line `{p} persona · {l} élő munkamenet`; users cell (single-user: `sk.notApplicable`), targets chips; managed rows get edit/remove menu, config rows a lock + sr-only `sk.readonly`; `managedLoadError` → warning banner; empty catalog → dashed card + CTA. Remove confirm states persona + live-session counts. Non-admin redirected to grid. Routes mounted in `TeamApp.tsx`. See change: add-team-skill-access. |
