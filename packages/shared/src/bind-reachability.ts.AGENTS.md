# bind-reachability.ts — index

Bind-vs-trust reachability: the ONE predicate + well-known-range table, imported by both client and server so they cannot drift. `unreachableTrustedEntries`, `collectTrustedEntries`, `resolveBindHost`/`pendingEffectiveHost`/`bindHostSource`, `wellKnownContainingRange`, `interfaceLabel`, `deriveInterfaceSuggestions`, `dedupeInterfaceOffers`. Advisory only — never gates a request. See change: warn-unreachable-trusted-networks.

`isLoopbackOnlyEntry` also true for `::1` (`/128`) and `::ffff:127.x` (`/104`..`/128`); other IPv6 (`::/0`, `fe80::/10`) stays false. Feeds boot `pair` vs `legacy` decision. `collectTrustedEntries` doc: lists scored for reachability advisory; in `pair` mode they do not admit (knock eligibility only). See change: retire-trusted-networks-bypass.
