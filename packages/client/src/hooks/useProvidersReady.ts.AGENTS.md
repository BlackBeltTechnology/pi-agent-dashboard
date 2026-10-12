# useProvidersReady.ts — index

Polls `/api/providers` + `/api/provider-auth/status`, returns `ProvidersReadyState` (`loading`, `ready`, `count`). Refetches on window focus + `provider-auth-event`. Exports `useProvidersReady` + `PROVIDER_AUTH_EVENT` (the shared event-name constant — import it at dispatch sites, do not retype the literal). Dispatcher half: `ProviderAuthSection.handleChanged` + the `SettingsPanel` `/api/providers` PUT success branch dispatch it; see change: dispatch-provider-auth-event.

Additive `anthropicAuthenticated: boolean | null` from `/api/provider-auth/status` (`id==="anthropic"`); `null` when the read failed or was non-array. Feeds `usePeerAutoInstallReset` (reset only on true→false between successful reads) and Landing's peer-state gate. See change: streamline-first-run.
