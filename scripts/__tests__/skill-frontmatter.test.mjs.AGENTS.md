# __tests__/skill-frontmatter.test.mjs — index

Vitest guard over every repo `**/SKILL.md` (skips node_modules/dist/worktrees). Parses `---`-fenced frontmatter with `yaml`, asserts non-empty `description`. Catches unquoted description with inner `: ` (nested-mapping YAML error) that silently drops the skill at pi startup. See change: fix-skill-frontmatter-yaml.
