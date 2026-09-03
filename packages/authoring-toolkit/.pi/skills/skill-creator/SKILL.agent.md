# SKILL.md — index

Pull-only condensed map. Source: packages/authoring-toolkit/.pi/skills/skill-creator/SKILL.md. Trigger → principle → anatomy → creation step.

## Meta
- Skill name — `skill-creator`. Guide for creating effective skills (new or update existing) that extend Claude's capabilities.
- Trigger — user wants to create a skill / extend capabilities with specialized knowledge, workflows, tool integrations.

## About Skills
- Skills — modular self-contained packages; "onboarding guides" for domains. Provide: specialized workflows, tool integrations, domain expertise, bundled resources.

## Core Principles
- Concise is key — context window is public good; Claude already smart; add only missing context; concise examples > verbose explanations.
- Degrees of freedom — high (text instructions, heuristics) for non-fragile tasks; medium (pseudocode/scripts w/ params); low (specific scripts) for fragile/error-prone ops needing exact sequence.

## Anatomy of a Skill
- Layout — `skill-name/SKILL.md` (required: frontmatter `name`+`description` + markdown body) + optional `scripts/`, `references/`, `assets/`.
- scripts/ — executable code, deterministic, repeatedly rewritten. Token-efficient, run without loading into context. Example `scripts/rotate_pdf.py`.
- references/ — docs loaded into context as needed; schemas/API docs/policies. >10k words → include grep patterns in SKILL.md. Avoid duplication: info lives in SKILL.md OR references, prefer references for detail.
- assets/ — output files (templates, icons, fonts, boilerplate); not loaded into context.
- Do NOT include — README.md, INSTALLATION_GUIDE.md, QUICK_REFERENCE.md, CHANGELOG.md, etc. Clutter.

## Progressive Disclosure
- 3 levels — metadata (always, ~100 words) → SKILL.md body (on trigger, <5k words) → bundled resources (as needed, unlimited). Keep body <500 lines.
- Patterns — 1 high-level guide w/ reference links (load refs only when needed); 2 domain organization (per-domain files, e.g. bigquery-skill/reference/finance.md); 3 conditional details (link advanced content).
- Guidelines — references one level deep from SKILL.md; refs >100 lines → table of contents.

## Skill Creation Process
- Steps in order, skip only with clear reason — understand → plan → init → edit → package → iterate.
- Step 1 understand — concrete examples; ask functionality/use-cases/trigger phrases; avoid many questions at once.
- Step 2 plan — analyze each example → list reusable scripts/references/assets.
- Step 3 init — `scripts/init_skill.py <skill-name> --path <output-directory>`; creates template SKILL.md + scripts/references/assets w/ examples.
- Step 4 edit — write for another Claude instance; include beneficial non-obvious info. Consult references/workflows.md (multi-step) + references/output-patterns.md (output formats). Test scripts by running; delete unneeded examples. Imperative form. Frontmatter: only `name` + `description`; description = primary trigger, include what + all when-to-use (NOT in body). Quote description if contains `colon-space` (`Triggers: "..."`) — unquoted parses nested YAML, loader silently drops skill. Enforced: scripts/__tests__/skill-frontmatter.test.mjs.
- Step 5 package — `scripts/package_skill.py <path/to/skill-folder>` (optional output dir, e.g. ./dist). Validates: frontmatter, naming, directory structure, description quality, file organization. Creates `<name>.skill` (zip). Validation fails → errors, no package.
- Step 6 iterate — use on real tasks → notice struggles → update SKILL.md/resources → test again.
