# pi-dashboard slash commands

Slash commands under the `/dashboard:*` namespace. Each file is a prompt
template resolved by the bridge's prompt-expander. The `:` ↔ `-` alias means
`/dashboard:session-list` resolves `dashboard-session-list.md`.

## Naming

`/dashboard:<resource>-<verb>[-<modifier>]` — singular resource, hyphen-joined
verb. Files are named `dashboard-<resource>-<verb>[-<modifier>].md`.

Resource families: `server`, `session`, `proposal`, `flow`, `git`, `peer`, `pin`.

## Two classes

- **LLM-free** (`executable: bash` frontmatter): the body runs as bash, output
  renders in chat, the LLM is never invoked. Read-only / zero-blast-radius ops
  whose inputs are simple identifiers. Chat shows an "ℹ ran locally" footer.
- **LLM-bound** (no `executable` frontmatter): the body expands into a user
  message the LLM interprets. Used for mutations needing judgment or free-form
  text (e.g. `session-tell`).

## Frontmatter

```yaml
---
executable: bash            # opt-in; only "bash" supported. Omit for LLM-bound.
excludeFromContext: true    # default true for executable: bash (no LLM context).
description: "one-liner"    # cosmetic.
---
<body>
```

## Resolution

The expander scans `<cwd>/.pi/skills/<skill>/commands/*.md` (one level) and
keys each file by basename. No install into `~/.pi/prompts/` is required.
See change: add-dashboard-slash-commands.

## Env available to executable: bash bodies

- `PI_DASHBOARD_PORT` — dashboard port (from `~/.pi/dashboard/config.json`, default 8000).
- `PI_DASHBOARD_BASE` — `http://localhost:$PI_DASHBOARD_PORT`.

Positional args bind as `$1`, `$2`, … (whitespace-split, quoting not honoured in v1).
