# prompt-component-registry.ts — index

PromptBus component registry. Built-in types `generic-dialog` (inline) + `architect-prompt` (widget-bar). Exports `PromptComponentInfo`, `getPromptComponentInfo` (falls back to generic-dialog), `registerPromptComponent` (idempotent under HMR), `isWidgetBarPrompt`, `useHasWidgetBarPrompt(sessionId)` reactive suppression hook. Moved from `packages/client/src/lib/`.
