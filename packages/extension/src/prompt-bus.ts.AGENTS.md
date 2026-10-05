# prompt-bus.ts — index

Prompt dispatch bus — first-response-wins adapter routing + cross-adapter dismissal. Exports `PromptBus`, `PromptComponent`, `PromptClaim`, `PromptRequest`, `PromptResponse`, `PromptAdapter`, `PromptBusOptions`. Replaces ui-proxy race pattern / `emitPromptAndAwait`. Routes by priority; default 5min timeout.

`requestWithId(id, options)` — caller-chosen id (shares `submit` with `request`) so the path gate can `cancel(id)` its own prompt. See change: ask-agent-file-access-in-chat.
