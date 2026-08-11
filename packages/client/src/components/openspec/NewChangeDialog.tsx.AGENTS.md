# NewChangeDialog.tsx — index

Dialog launching `/skill:openspec-new-change`. Exports `NewChangeDialog`, `formatNewChangePrompt(name, description)`. Two fields (name + description, both optional), Cmd/Ctrl+Enter sends. Uses `Dialog` from `pi-dashboard-client-utils/Dialog`. Mounts `<ComposerPanelSlot draft={description} onApplyText={setDescription}/>` under the description textarea (grammar plugin's `composer-panel` slot; the name input is NOT grammar-checked; no `sessionId`). See change: grammar-llm-only-with-explore.
