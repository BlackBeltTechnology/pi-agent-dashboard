# paired-devices.ts — index

Paired-devices registry (D5). `PairedDeviceRegistry(path?)` persists `~/.pi/dashboard/paired-devices.json` (0600). Opaque bearer: only SHA-256 hash stored; plaintext returned once at `add(label)`. `verify(token)` constant-time, updates last-seen; `revoke(id)` = row delete; `list()`. Exports `PairedDevice`, `PairedDeviceView`, `defaultRegistryPath`. See change: add-server-keypair-pairing.
