# slash-dispatch.ts — index

Extension slash-command dispatch (routing-step 9). Exports `tryDispatchExtensionCommand`, `FeedbackSink`, `DispatchConnection`. Three paths: B `pi.dispatchCommand` direct; C headless RPC `dispatch_extension_command` to server; D tmux/WT error feedback. Guarantees exactly one `started` + one terminal event. Non-extension text returns `false` (caller falls through).
