# DOX — packages/deck3d/src/parse

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `markdown.ts` | Markdown deck grammar: front-matter deck defaults, `# Title` slide split (zero-heading → one `slide`), subtitle paragraph, `-` bullets, ```mermaid block capture, `<!-- deck3d: {...} -->` inline overrides (win over deck.json). `MarkdownParseError` names the slide + JSON error. |
