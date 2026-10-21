## REMOVED Requirements

### Requirement: Existing `StatusBar` usage SHALL remain direct-import
**Reason**: The file it names (`packages/client/src/components/StatusBar.tsx`) moved to `components/shell/StatusBar.tsx`, which no longer imports `ModelSelector` because redesign-prompt-input retired its model row. This change deletes that component; its working-status label moves into the composer toolbar.
**Migration**: The rule's intent, first-party shell code importing shell-private components directly, still holds: the composer (`CommandInput`) imports `ModelSelector` directly and does not call `useUiPrimitive("ui:model-selector")`.
