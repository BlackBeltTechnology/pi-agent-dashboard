---
name: kb-setup
description: >
  Set up, initialize, or configure the local markdown knowledge base for a
  project. Use when the user says "set up the knowledge base", "init the KB",
  "configure the markdown KB", "index my docs", "add a doc source to the KB",
  or wants the project's markdown searchable by `kb search`. Wraps `kb init`
  end-to-end: detect existing config → choose scope + sources → `kb init` →
  trust any remote source → `kb index` → smoke `kb search` to verify.
---

# kb-setup — bring up the project knowledge base

`@blackbelt-technology/pi-dashboard-kb` builds a zero-token, local SQLite/FTS5
index over this project's markdown so `kb-search` can retrieve before answering.
This SKILL does the one-time bring-up. Retrieval is **pull** (the agent calls
`kb`); nothing is auto-injected.

## When to Use

- User asks to set up / init / configure the knowledge base.
- No `.pi/dashboard/knowledge_base.json` exists yet and the project has docs.
- User wants to add a doc source (local dir, npm package docs, git handbook).

## Procedure

1. **Detect existing config.** Check `.pi/dashboard/knowledge_base.json`
   (project) and `~/.pi/dashboard/knowledge_base.json` (global). Run
   `kb config` to see the resolved layering. If a project config already exists
   and is healthy, skip to step 5 (smoke search) unless the user wants changes.
2. **Choose scope + sources.** Ask (if unclear) whether to write project or
   global config. Pick `sources[]`:
   - local doc dir: `{ "kind": "filesystem", "ref": "docs", "priority": 10 }`
     (higher priority = preferred when the same content appears in two roots)
   - AGENTS.md / CLAUDE.md: covered by `indexAgentsFiles: true` (default on)
   - source-tree `*.md`: covered by `includeSourceMarkdown: true` (default on)
   - remote sources (npm/git/https) require trust-on-first-use — defer unless
     the user explicitly asks; remote resolvers land in a later phase.
3. **Scaffold.** `kb init [--global] [--source <ref>]... [--dry-run]`.
   Review the `--dry-run` output with the user, then run for real. `kb init`
   refuses to clobber an existing config without `--force`, and gitignores the
   `dbPath`.
4. **Index.** `kb index` → reports files scanned / changed / chunks. First run
   is the cold index; later runs are incremental (mtime → sha256).
5. **Smoke search.** `kb search "<a real term from the docs>" --limit 5` and
   confirm ranked `{path, headingPath, score, snippet}` come back. If empty,
   check `kb config` shows the right `sources` and that the dir has `.md` files.
6. Point the user at the `kb-search` SKILL for everyday retrieval.

## Pitfalls

- Do NOT overwrite an existing config without confirming — use `--force` only
  after the user agrees.
- `dbPath` must be gitignored; `kb init` does this for project configs. For a
  custom `dbPath` outside the project, add the gitignore entry yourself.
- No `sources[]` → `kb index` exits 2. Always seed at least one filesystem source.

## Verification

- `kb config` prints `origin`, `dbAbsPath`, and the resolved `sources` list.
- `kb index` reports `N files … M chunks` and `store.counts()` JSON.
- `kb search "<term>"` returns ranked hits with snippets.
