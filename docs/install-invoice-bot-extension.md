# Install invoice-bot as global pi extension

Installs `@blackbelt-technology/invoicebot` as global pi extension. Local package `../pi-invoice-bot`, sibling of pi-agent-dashboard.

## What it contributes

pi-package. Contributes pi extension + skills.

- Tools: `ib_query`, `ib_review`, `ib_setup`, `ib_rules`.
- Skills: `ib-decide`, `ib-intake`, `ib-handoff`, ...
- NOT dashboard plugin. Absent from `/api/health` `plugins[]`.

Manifest `pi` key loads two extension entries:

- `node_modules/@blackbelt-technology/pi-flows/extensions` — bundled engine.
- `./extensions/invoicebot`.
- `skills: ["./skills"]`.

## Procedure

1. Install bundled deps.

```bash
cd ../pi-invoice-bot && npm install
```

Local-path pi installs skip `npm install`. Needs bundled dep `file:../pi-flows` + `typebox`. Skip → `node_modules/@blackbelt-technology/pi-flows` missing → extension load fails.

2. Install extension via absolute path.

```bash
pi install /Users/robson/Project/pi-invoice-bot
```

Writes `~/.pi/agent/settings.json` (global). `-l` flag → project `.pi/settings.json` instead. Use absolute path. Relative path resolves against settings-file dir.

## Conflict — bundled pi-flows collides with global pi-flows

invoicebot re-loads bundled pi-flows extensions. Global `@blackbelt-technology/pi-flows` already installed → tool names collide: `ask_user`, `skill_read`, `flow_agents`, `flow_write`, `flow_results`.

Symptom:

```
Failed to load extension ... Tool "ask_user" conflicts with .../pi-flows/extensions/index.ts
```

Extension load aborts.

## Fix — filter bundled node_modules extensions

Convert settings.json package entry to object form. Filter out bundled node_modules extensions. Only `./extensions/invoicebot` loads. Reuses already-installed global pi-flows engine.

```json
{
  "source": "../../Project/pi-invoice-bot",
  "extensions": ["!node_modules/**"]
}
```

`!pattern` excludes. Filters layer on manifest, narrow only. Skills still load (`skills` key untouched).

## Verify

- New pi session registers `ib_*` tools.
- `pi list` shows `../../Project/pi-invoice-bot`.
- Loads per-session at session start. Existing sessions need `/reload`.
