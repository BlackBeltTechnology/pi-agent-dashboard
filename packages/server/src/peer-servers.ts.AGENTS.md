# peer-servers.ts — index

mDNS browser events → `peerServers` map (keyed by `peerKey`), broadcast, move evaluation on up/update/sweep. `wirePeerServers` (self-exclusion: local + port + fingerprint-when-advertised), `buildSelfServer`. See change: stabilize-mdns-server-identity.
