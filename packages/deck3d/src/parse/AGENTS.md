# DOX — packages/deck3d/src/parse

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `markdown.ts` | Markdown deck grammar: front-matter deck defaults, `# Title` slide split (zero-heading → one `slide`), subtitle paragraph, `-` bullets, ```mermaid block capture, `<!-- deck3d: {...} -->` inline overrides (win over deck.json). `MarkdownParseError` names the slide + JSON error. |
| `derive.ts` | `parseDeck`/`deriveDeckIR`: parsed markdown → `DeckIR`. Regenerates `defaults`+`slides`, preserves prior `overrides`, applies inline overrides (warn on clobber), emits orphan-override warnings, injects the mermaid `Harvester` (`HarvestOutcome` = diagram + warnings), computes `meta.derivedHash`. Adds the D2 built-kind table (`builtKindFor`, ordered, first match wins, bullet-less slides excluded) + `harvestData` (leading magnitude → value, a leading `(19|20)\d\d` year is a caption never a value, partial series ⇒ no `values`), honours `autoStyle` from front matter or `overrides.deck`, and warns that a `diagram.kind`/`data` override is ignored while the slide carries a supported mermaid block. See change: deck3d-cinematic-worlds. |
| `harvest/AGENTS.md` | Subfolder — headless-chromium mermaid harvest (semantics + layout → graph IR). |
