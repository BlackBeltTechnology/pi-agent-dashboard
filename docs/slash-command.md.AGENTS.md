# slash-command.md — index

Bridge routes typed `/foo` chat text to pi handlers. `parseSendPrompt` + `bridge.ts::sessionPrompt` 11-step order. Step 9 = ONE in-process call `pi.sendUserMessage({expandPromptTemplates:true,deliverAs})`, ungated (pi 1.0.0 lockstep floor); every session kind. Paths B/C/D retired; server tombstone for `dispatch_extension_command`. Keeper sidecar unchanged (durable pi-stdin owner). See change: retire-slash-dispatch-via-expand-prompt-templates, update-pi-core-1-0-adopt-apis.
