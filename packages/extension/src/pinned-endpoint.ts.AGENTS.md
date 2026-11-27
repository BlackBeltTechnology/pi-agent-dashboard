# pinned-endpoint.ts — index

`canonicalEndpointKey(endpoint)` (lowercase host, no trailing dot, IPv6 brackets, scheme-default port) + `isPinnedEndpoint(endpoint,{configured,pins})`: exact canonical equality with configured endpoint or a pin-store `lastEndpoint`; NO sole-pin fallback (unlike `resolvePinForEndpoint`). Gate for the device bearer. See change: harden-bridge-inbound-and-discovery (D19).
