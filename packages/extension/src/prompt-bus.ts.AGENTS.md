# prompt-bus.ts — index

Prompt dispatch bus — first-response-wins adapter routing + cross-adapter dismissal. Exports `PromptBus`, `PromptComponent`, `PromptClaim`, `PromptRequest`, `PromptResponse`, `PromptAdapter`, `PromptBusOptions`. Replaces ui-proxy race pattern / `emitPromptAndAwait`. Routes by priority; default 5min timeout.
