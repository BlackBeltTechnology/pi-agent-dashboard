# network-interfaces.ts — index

`buildNetworkInterfaceList(enumerate)` builds the `/api/network-interfaces` payload — one entry per ADDRESS (the listen-interface picker keys on `address`; dedupe belongs to the dropdown), each enriched with `label`/`pointToPoint`/`suggestions`. A throwing `os.networkInterfaces()` returns `{success:false}` instead of an unhandled throw. See change: warn-unreachable-trusted-networks.
