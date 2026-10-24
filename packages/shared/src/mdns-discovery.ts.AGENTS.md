# mdns-discovery.ts — index

mDNS `_pi-dashboard._tcp` advertise + discover. Identity-derived names `pi-dashboard-<id12>-<port>`, TXT `fp`/`name`/`version`, `resolveAdvertisedAddresses`, fqdn-keyed `createBrowser` + 60 s sweep. → see `mdns-discovery.ts.AGENTS.md`

## harden-peer-address-identity

`BRIDGE_IFACE` also skips `bridgeN`/`vmnet`/`vboxnet` (best-effort noise reduction). `isLocalService(service, ownFingerprint?)`: a differing advert `fp` vetoes locality; a matching `fp` never creates it. `createBrowser({ownFingerprint})`, `discoverDashboard(timeout, {ownFingerprint})`. See change: harden-peer-address-identity.
