# tunnel-provider.ts — index

Tunnel ("Gateway") provider abstraction types. Exports `TunnelProvider` interface (`id`, `kind` child\|daemon, `supportsMode`, `detectBinary`, `isEnrolled`, `connect`, `disconnect`, `status`), `TunnelProviderId`/`TunnelKind`/`TunnelMode`/`EndpointKind`, `TunnelEndpoint`/`ProviderEndpoints`/`ProviderStatus`/`TunnelConnectOpts` (v2: `reservedName?`/`persistent?`), `PROVIDER_MODES`/`PROVIDER_KIND` matrices, `providerSupportsMode()`. zrok/ngrok public-only child; zerotier private-only daemon; tailscale both daemon. See change: add-tunnel-providers, support-zrok-v2.
