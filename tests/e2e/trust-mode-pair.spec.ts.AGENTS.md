# trust-mode-pair.spec.ts — index

L3 pair trust mode (F10, F11): pair refuses listed peer, legacy flip admits live; paired browser previews real in-container upstream under `/live/<id>/~c/<token>/`. → see `trust-mode-pair.spec.ts.AGENTS.md`
Harness note: the managed harness seeds OAuth with `auth.bypassUrls: ["/"]`, which exempts every path from the UNIVERSAL guard hook — so F10 probes `/api/paired-devices` (per-route guard), not `/api/sessions`; and the refused page shows the client's sign-in gate instead of the denied bar (`.or()` in the spec; bar pinned at L1 F8). `live-server-downloads.spec.ts` now routes the capability mint too.
