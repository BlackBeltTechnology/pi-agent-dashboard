# model-id.ts — index

First-slash model-id parser. `parseModelId(label)` → `{provider, modelId}`: provider = before first `/`, modelId = whole remainder (may contain `/`); no leading provider (`""`, `"gpt-4"`, `"/x"`) → `provider === ""`. Mirrors goal-plugin `parseModelLabel`; converges model-proxy routes off truncating `split("/", 2)`. See change: fix-and-prefer-model-proxy-resolution.
