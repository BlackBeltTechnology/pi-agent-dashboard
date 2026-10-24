# runtime-plugin-remote-and-paired.spec.ts — index

L3. F13 bearer-only paired context loads `/plugin-assets` with no Authorization header (8.124); F14 remote origin (other loopback name) → `plugins-runtime-notice-remote-server`, 0 `/plugin-assets` requests (8.125). See change: decouple-plugins-from-core.

AF1–AF5 (UNEXECUTED until the harness phase): F14 topology (page `localhost`, API `127.0.0.1`) per-origin browser bearer slots — legacy key discarded (AF1), two tabs rotate concurrently 200+409 (AF2), rotation across reloads (AF3), expired row → 401 `bearer_expired` + slot removed (AF4, `expirePairedDevice`), ServerSelector A→B→A bearer isolation (AF5). See change: harden-auth-credentials.
