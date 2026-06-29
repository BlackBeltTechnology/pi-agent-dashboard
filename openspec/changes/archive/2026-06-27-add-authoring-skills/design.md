# Design — Authoring skills port

## Scan results: what was evaluated

`~/Documents` holds 35 unique skills (mirrored per AI tool). Cross-checked
against the monorepo:

| Skill | Status | Reason |
|---|---|---|
| `openspec-*` (12) | already shipped | bundled in extension + electron resources |
| `markdown-table-profiler` | **already shipped** | `document-converter/engine/markdown_table_profiler/profile.py` + `profileTables` CLI |
| `frontmatter-filler` | **already shipped** | `document-converter/engine/frontmatter_filler/fill.py` + `fillFrontmatter` CLI |
| `skill-creator` | **port** → authoring-toolkit | clean, single SKILL.md, no coupling |
| `session-to-guideline` | **port** → authoring-toolkit | pi-native; pi-standard JSONL path |
| `doc-summarizer` | **port** → document-converter | shares extraction stack |
| `system-architect` | **reject** | pasted blog prompt, not a skill; eng-disciplines covers it |
| `document-organizer`, `downloads-scanner`, `docling-graph`, `pdf-to-markdown-tax-docs`, `project-mail`, `wise-*`, `google-recorder-download`, `veo-generator`, `nano-banana-imagegen`, `bosch-system-architect`, `thefence-dapp-analyst` | leave | personal / infra-bound (Neo4j, Hungarian NAV, personal archive, named clients) |

## Placement decision

```
packages/authoring-toolkit/          NEW — meta authoring skills
└── .pi/skills/
    ├── skill-creator/               author/update skills
    └── session-to-guideline/        pi JSONL → how-we-did-it guide

packages/document-converter/.pi/skills/
├── document-converter/              (exists)
└── doc-summarizer/                  NEW — folded here (shares extraction stack)
```

Rationale: `document-converter` is about ingesting/producing documents;
`doc-summarizer` consumes documents → belongs with it. `skill-creator` +
`session-to-guideline` form a "produce/maintain authored artifacts" theme,
paralleling `eng-disciplines` bundling related disciplines.

## doc-summarizer: Option A (orchestrate-only) — chosen

Upstream `doc-summarizer` ships `extract_text.py`, `pdf_to_markdown.py`,
`chunk_text.py`. The first two **duplicate** docling extraction already
quarantined in `document-converter`'s Docker engine.

| | Option A (chosen) | Option B (rejected) |
|---|---|---|
| Extraction | reuse existing `dc.*` engine | copy host-side python |
| New engine code | none | `engine/doc_summarizer/` + `summarize` subcommand |
| Package invariant ("engine quarantined in Docker, TS is the only call surface") | preserved | violated (host-side python returns) |
| Surface area | smallest | duplicates shipped logic |

The ported SKILL describes: pick document → call engine extract → chunk →
fan out to subagents → synthesize. `chunk_text.py` (pure text, no extraction)
MAY be carried if needed; the two extractor scripts are NOT.

## Package wiring (verified against eng-disciplines / anti-slop)

A pure-skill package needs only `package.json`:

```jsonc
{
  "name": "@blackbelt-technology/pi-dashboard-authoring-toolkit",
  "version": "0.5.4",
  "type": "module",
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "…", "directory": "packages/authoring-toolkit" },
  "pi": { "skills": [".pi/skills/skill-creator", ".pi/skills/session-to-guideline"] },
  "files": [".pi/skills/", "README.md", "NOTICE"],
  "keywords": ["pi-package", "pi-skill", "pi-dashboard", "authoring", "skills", "session"]
}
```

No `extension.ts` (that is only for tool-providing packages like `mockup-loop`).
`document-converter` gets `.pi/skills/doc-summarizer` appended to its existing
`pi.skills[]`.

## bun → tsx adaptation

`session-to-guideline/scripts/{extract_session,list_sessions}.ts` are invoked in
the upstream SKILL as `bun scripts/…`. Repo convention is `npx tsx` (review +
quality scripts use it). Adapt the invocations and verify the scripts run under
tsx (no bun-only APIs: `Bun.file`, `Bun.spawn`, etc. — replace with `node:fs` /
`node:child_process` if present).

## Attribution

`skill-creator` is Anthropic-authored (MIT). Add a `NOTICE` to
`authoring-toolkit` crediting source + license, matching how `eng-disciplines`
credits Addy Osmani's agent-skills.
