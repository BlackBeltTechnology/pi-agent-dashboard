# useProvidersReady.ts — index

Polls `/api/providers` + `/api/provider-auth/status`, returns `ProvidersReadyState` (`loading`, `ready`, `count`). Refetches on window focus + `provider-auth-event`. Exports `useProvidersReady` + `PROVIDER_AUTH_EVENT` (the shared event-name constant — import it at dispatch sites, do not retype the literal). Dispatcher half: `ProviderAuthSection.handleChanged` + the `SettingsPanel` `/api/providers` PUT success branch dispatch it; see change: dispatch-provider-auth-event.
