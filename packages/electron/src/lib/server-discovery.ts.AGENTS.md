# server-discovery.ts — index

Pure helpers: `shortFingerprint` (`sha256:` + 16 chars), `isFingerprint`, `serverOrigin` (brackets IPv6), `partitionFor(fp, remembered)` (`persist:`? + `server-<32hex sha256>`), `resolveExpectedFingerprint`/`identityVerdict` (pin ?? advert; both+differ ⇒ mismatch), `buildCandidates` (stored https → stored http → discovered, cap 3), `pickVerifiedHost` (concurrent, 5 s deadline), `describeDiscovered` (drops local, labels clone of local fp). `createServerDiscovery` wraps shared `createBrowser` (app-lifetime). Re-exports `sanitizeDisplayName`. See change: add-electron-server-windows (D3, D6, D10).

## harden-peer-address-identity

`buildCandidates` no longer caps discovery; `pickVerifiedHost` runs ordered batches of 12 until a proof or the 5 s deadline. New `expandRef(ref, lookup)` (http hostname → ≤ 8 `LITERALS_PER_NAME_CAP` literals; https/IP/no lookup keep ref; stall > 2 s ⇒ none), `orderByLocality(literals, interfaces)` (on-link via interface netmask/cidr first, own last, nothing dropped). `ServerDiscovery.localFp()` (fp | `"none"` | `undefined`); `advertsFor(fp)` ignores `isLocal`, excludes only the own fp; browser gets `ownFingerprint`. See change: harden-peer-address-identity.
