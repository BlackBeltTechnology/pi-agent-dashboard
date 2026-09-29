# bind-reachability.ts — index

Bind-vs-trust reachability: the ONE predicate + well-known-range table, imported by both client and server so they cannot drift. `unreachableTrustedEntries`, `collectTrustedEntries`, `resolveBindHost`/`pendingEffectiveHost`/`bindHostSource`, `wellKnownContainingRange`, `interfaceLabel`, `deriveInterfaceSuggestions`, `dedupeInterfaceOffers`. Advisory only — never gates a request. See change: warn-unreachable-trusted-networks.
