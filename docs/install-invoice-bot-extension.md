# Install invoice-bot as global pi extension

Installs `@blackbelt-technology/invoicebot` as a global pi extension from a local
checkout of the `pi-invoice-bot` repository.

> Paths below are written as `<invoicebot-checkout>` — substitute the directory where
> you cloned the repository. Nothing here assumes a particular layout or user account.

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
cd <invoicebot-checkout> && npm install
```

Local-path pi installs skip `npm install`. Needs its bundled `pi-flows` dependency +
`typebox`. Skip → `node_modules/@blackbelt-technology/pi-flows` missing → extension
load fails.

2. Install the extension.

```bash
pi install <invoicebot-checkout>
```

Writes `~/.pi/agent/settings.json` (global). `-l` flag → project `.pi/settings.json`
instead. **Pass an absolute path**: a relative path resolves against the settings-file
directory, not your shell's working directory.

## Conflict — bundled pi-flows collides with global pi-flows

invoicebot re-loads bundled pi-flows extensions. Global
`@blackbelt-technology/pi-flows` already installed → tool names collide: `ask_user`,
`skill_read`, `flow_agents`, `flow_write`, `flow_results`.

Symptom:

```
Failed to load extension ... Tool "ask_user" conflicts with .../pi-flows/extensions/index.ts
```

Extension load aborts.

## Fix — filter bundled node_modules extensions

Convert the settings.json package entry to object form. Filter out bundled
node_modules extensions. Only `./extensions/invoicebot` loads. Reuses the
already-installed global pi-flows engine.

```json
{
  "source": "<invoicebot-checkout>",
  "extensions": ["!node_modules/**"]
}
```

`!pattern` excludes. Filters layer on the manifest, narrow only. Skills still load
(`skills` key untouched).

## Verify

- New pi session registers `ib_*` tools.
- `pi list` shows the checkout you installed.
- Loads per-session at session start. Existing sessions need `/reload`.
