# ModelProxySection.tsx — index

Settings panel section for model proxy. Exports `ModelProxySection`, `ModelProxyConfig`. Renders master toggle, default-model input, second-port input, API keys table with reveal-once `RevealBanner`, `NewKeyForm`, `KeyRow`. Calls `listApiKeys`/`createApiKey`/`revokeApiKey`/`deleteApiKey`/`refreshRegistry` from `lib/model-proxy-api`. Shows upstream `@blackbelt-technology/pi-model-proxy` coexistence warning when `upstreamExtensionDetected`.
