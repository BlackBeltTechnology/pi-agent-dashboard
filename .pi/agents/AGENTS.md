# DOX — .pi/agents

Files in this directory. One row per file. Non-source area. Project-tier subagent
definitions; resolved by `pi-dashboard-subagents` tier 1 (`<cwd>/.pi/agents/<Name>.md`),
beating user/bundled/package tiers. Frontmatter schema: `description`, `model`,
`thinking`, `tools`, `inherit_context`, `prompt`. `tools:` MUST be YAML array form —
comma-string form is silently dropped and the agent inherits every parent tool.
`ctx_*` tools do not propagate into subagent sessions; `grep`/`find`/`ls` are not tools.

Note: `DoxTriage` ships from `packages/extension/agents/` (package tier), not here —
same convention as the pi-dashboard/browser/doctor skills. One source of truth.

| File | Purpose |
|------|---------|
| `Audit.md` | Deep security + performance audit of a specific diff. Model `@research`, inherit_context false. |
| `DocScribe.md` | Write docs/ prose for a completed change, in caveman style, per the repo's Documentation Update Protocol. Model `@compact`, inherit_context false. |
| `DocSummarize.md` | Summarize large or multiple documents (PDF/DOCX/PPTX/XLSX/HTML/CSV/TXT/MD). Model `@research`, inherit_context false. |
| `Explore.md` | Fast read-only codebase & docs exploration. Model `@fast`, inherit_context false. |
| `KbLookup.md` | Read-only knowledge-base lookup. Model `@fast`, inherit_context false. |
| `SessionGuideline.md` | Turn a pi session JSONL into a how-we-did-it playbook. Model `@research`, inherit_context false. |
| `Transcribe.md` | Batch audio/video transcription to SRT. Model `@fast`, inherit_context false. |
| `nodejs-expert.md` | Specializes in Node.js development, focusing on performance optimization, asynchronous programming, and best practices for building scalable server… Model `@coding`, inherit_context (global). |
| `react-expert.md` | React development expert with deep understanding of component architecture, hooks, state management, and performance optimization. Model `@coding`, inherit_context (global). |
| `tailwind-expert.md` | Expert in Tailwind CSS for efficient and responsive styling of web projects, utilizing utility-first approaches and responsive design principles. Model `@coding`, inherit_context (global). |
| `typescript-expert.md` | Expert in TypeScript specializing in type safety, async patterns, and modern ES features. Model `@coding`, inherit_context (global). |
