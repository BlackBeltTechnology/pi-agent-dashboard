# prompt-expander.ts — index

Expand prompt templates from disk for dashboard slash commands (`pi.sendUserMessage` skips expansion). Exports `loadPromptTemplate`, `expandPromptTemplateFromDisk`, `LoadedPromptTemplate`, `PromptFrontmatter`. Resolves from `.pi/prompts/`, `.pi/skills/<skill>/SKILL.md`, `<skill>/commands/*.md`, pi.getCommands registry; `:` ↔ `-` alias resolution.
