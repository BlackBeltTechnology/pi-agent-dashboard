# slash-command.md — index

Bridge routes typed `/foo` chat text to pi handlers. `parseSendPrompt` + `bridge.ts::sessionPrompt` 11-step order. Step 9 = ONE in-process call `pi.sendUserMessage({expandPromptTemplates:true,deliverAs})`, gate running pi >= 0.84.2; every session kind. Paths B/C/D retired; server tombstone for `dispatch_extension_command`. Keeper sidecar unchanged (durable pi-stdin owner). See change: retire-slash-dispatch-via-expand-prompt-templates.
