# prompt-component-registry.ts — index

Compatibility shim re-exporting prompt component registry from `@blackbelt-technology/dashboard-plugin-runtime`. Exports `getPromptComponentInfo`, `registerPromptComponent`, `isWidgetBarPrompt`, type `PromptComponentInfo`. Real registry moved to plugin runtime so plugins register component types without crossing shell boundary. See change: route-flow-asks-to-upper-slot.
