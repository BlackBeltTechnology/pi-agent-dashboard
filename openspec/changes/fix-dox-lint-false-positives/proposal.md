# Fix `kb dox lint` false-positive orphans (path resolution + table scope)

## Why

`kb dox lint` over-reports drift, and its `--fix` path would **delete valid
documentation rows**. Running it on this repo today:

```text
total issues: 1226
  orphan            1069   ← 991 verified FALSE (files exist)
  missing (.md)      119   ← docs under other conventions, 0 real .ts/.tsx gaps
  over-threshold       8   ← real
  missing-companion   30   ← real
```

Two independent defects produce the noise:

### Defect A — row paths resolved against `cwd`, not the owning `AGENTS.md` (CRITICAL)

`packages/kb/src/dox.ts:263`:

```ts
const abs = isAbsolute(rp) ? rp : resolve(cwd, rp);
```

Rows are documented as **paths relative to their own `AGENTS.md`** (schema
`| \`<basename>\` |`). The lint resolves them relative to the **repo root**
instead. So `packages/automation-plugin/src/client/AGENTS.md` row `api.ts` is
checked at `<repo>/api.ts` → not found → reported orphan, though the file exists
at `packages/automation-plugin/src/client/api.ts`.

Measured: **991 of 992 basename orphans actually exist next to their
`AGENTS.md`.** Because `--fix` prunes every `orphan` row
(`dox.ts` `if (opts.fix && kind === "orphan") { fixed++; continue; }`), running
`kb dox lint --fix` today would **erase ~991 legitimate per-file rows** — the
entire source-tree DOX record.

### Defect B — any backtick-first-cell row treated as a DOX row (MINOR)

`packages/kb/src/dox.ts:259`:

```ts
const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
```

This matches **any** markdown table row whose first cell is backtick-wrapped,
regardless of surrounding heading. Non-DOX prose tables get parsed as file rows:

- Root `AGENTS.md` **Subagent Routing** table → `Explore`, `react-expert`, … (5)
- QA table glob → `qa/packer/*.pkr.hcl` (1)
- Other cross-cutting tables with path-ish cells

`kb dox init` always writes DOX tables under a `# DOX — <dir>` heading, so the
heading is a reliable scope marker the lint currently ignores.

## What Changes

1. **Resolve row paths relative to the owning `AGENTS.md` directory**, not `cwd`
   (fixes Defect A; removes the `--fix` data-loss hazard).
2. **Scope row parsing to tables under a `# DOX —` heading** — rows outside a DOX
   table are ignored, not linted (fixes Defect B).
3. Apply the same scoping in `doxInit` (`dox.ts:134`) so init/lint agree.
4. Add regression scenarios to the `kb dox lint` requirement.

Out of scope: over-threshold splitting and missing-companion detection (already
correct); the `.md`-under-other-conventions "missing" reports (separate
eligibility-rules question, tracked as a follow-up).

## Impact

- Affected spec: `markdown-knowledge-base` (MODIFIED: DOX tree health-check).
- Affected code: `packages/kb/src/dox.ts` (`doxLint`, `doxInit`, row parser).
- Behavior: `kb dox lint` on this repo drops from 1226 → ~38 real issues;
  `--fix` becomes safe to run.
- No API/flag changes; no migration.
