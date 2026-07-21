# provider-auth-handlers.ts — index

OAuth provider handlers for browser-based provider auth. Exports `AuthCodeHandler`, `DeviceCodeHandler`, `ProviderHandler`, `PKCEPair`, `generatePKCE`, `generateState`, `getProviderHandler`, `getAllHandlers`, built-in handlers `anthropicHandler`, `codexHandler`, `githubCopilotHandler`. Each handler encapsulates auth-URL build / code exchange / device-code polling.
