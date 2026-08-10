# message-history.ts — index

Exports `extractUserPromptHistory(messages)` — collects `role==="user"` prompts for ArrowUp recall; condenses `<skill>` envelopes to `/skill:name args` via `msg.skill.condensed` or `parseSkillBlock`; drops empty, collapses consecutive dupes, returns newest-first. See change: render-skill-invocations-collapsibly.
