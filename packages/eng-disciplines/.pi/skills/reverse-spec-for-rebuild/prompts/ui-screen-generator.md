# UI screen generator (one screen or dialog)

Filled by `scripts/ui-extract/fill.mjs <this prompt> <job.json> <ID>`; `{SKILL}` is this skill's directory.

You characterize ONE screen/dialog of a legacy frontend into a UI-model record.
Read-only on the application. Write exactly one file: `{PKG}/ui/screens/{ID}.json`.

## Inputs

- Application root: `{APP}` (cites are relative to it)
- Rebuild package: `{PKG}` (rules.md, quirks.md, gaps.md, capabilities/*/spec.md)
- Record format: `{SKILL}/references/ui-model.md` — read it first and follow it exactly
- Inventory: `{PKG}/ui/_inventory.json` (rows with id, kind, name, file, line)
- Config-driven forms already projected: `{PKG}/ui/forms/*.json` (reference them, do not redo them)
- Target: id `{ID}`, kind `{KIND}`, template `{TEMPLATE}`, scope `{SCOPE}`
- Hints: {HINTS}

## Method

1. List the in-scope inventory rows:
   `python3 -c "import json;[print(r['id'],r['kind'],r['file'],r['line'],r['name']) for r in json.load(open('{PKG}/ui/_inventory.json'))['rows'] if <scope filter>]"`
2. Read the template and every handler they reach. For each user action, trace the handler
   call chain to its effects (validation, DB/collection writes, ERP/export, navigation,
   dialogs, notifications). Stop tracing at the data layer boundary and cite it.
3. Link existing package items instead of restating behaviour. For any code range run
   `node {SKILL}/scripts/ui-extract/refs-for.mjs {PKG} <file> <from> <to>` to see which BR/QUIRK/GAP cite it;
   use `grep -n "^### Requirement:" {PKG}/capabilities/*/spec.md` for requirement names.
   Never invent ids. If behaviour has no package item, describe it in the effect's `target`.
4. Every in-scope behavioural inventory row must be in some `covers` list or in `unmapped`
   with a reason (e.g. "column sort header, view-only", "debug alert").
   Every template control (input, select, button, clickable element) must also be linkable by
   `screen-plan.mjs`: a field's or action trigger's `cite` must be the exact line where the
   control's tag STARTS (a range like `x.htm:6-8`, or the later line holding `ng-model`, does
   not link it). Unbound inputs and radio groups read by id/class are fields too.
5. Run the gate and fix until your record is clean:
   `node {SKILL}/scripts/ui-extract/gate.mjs {APP} {PKG} 2>&1 | grep -E "^{ID}\.json|^PASS|^FAIL"`
   (other records may be in progress; only lines starting with `{ID}.json` are yours).

## Report

Reply with: gate result for your file, counts (actions, effects, dialogs, fields, covered
rows, unmapped rows), and anything you could not establish from the code.
