# @blackbelt-technology/pi-dashboard-research-doc-skill

A pi skill-plugin that produces structured research/decision documents in
`docs/research/`.

The skill (`research-doc-synthesis`) fans out **parallel `@fast` web-search
subagents** across distinct angles, gathers codebase context, and synthesizes
the results into a stable document skeleton — then saves the doc, indexes it in
`docs/research/README.md`, and references it from the backing OpenSpec proposal.

## What it ships

| Path | Purpose |
|---|---|
| `.pi/skills/research-doc-synthesis/SKILL.md` | The skill: when-to-use, fan-out procedure, doc skeleton, pitfalls, verification. |

Discovered locally via pi's `.pi/skills/` discovery and shipped to consumers via
the `pi.skills` field in `package.json`.

## When to use it

Use when research backs an OpenSpec proposal and will outlive the change. Do not
use for single-change rationale (that goes in the change's `design.md`) or quick
one-off lookups (use `web_search` or the `librarian` skill inline). See the
SKILL.md for the full decision table.

## Convention

This skill implements the `AGENTS.md` ▸ OpenSpec Conventions rule: evergreen
research lives in `docs/research/`, indexed in `docs/research/README.md`, and
referenced from `proposal.md`.
