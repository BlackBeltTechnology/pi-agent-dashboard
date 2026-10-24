# Design

## Context

Identity is an Ed25519 fingerprint. `ensureServerIdentity` (`packages/server/src/auth/identity.ts:63`) persists the key at `~/.pi/dashboard/identity.key`. Addresses are hints from keyring `lastHosts`, mDNS adverts (`adv.host` plus `adv.addresses`) and manual entry. mDNS is unauthenticated (`packages/electron/src/lib/server-windows.ts:267` comment).

### Existing behaviour (baseline; symbols exist unless marked *new*)

- **Locality.** `isLocalService(service)` (`packages/shared/src/mdns-discovery.ts:418`) returns local when the advert host equals `os.hostname()` or **any** advertised address equals a local interface address. It is used for `DiscoveredServer.isLocal` (`mdns-discovery.ts:526`, `:662`). Electron's `advertsFor`/`raw` drop `isLocal` adverts (`packages/electron/src/lib/server-discovery.ts`, `createServerDiscovery`). A remote advert that lists one shared virtual-bridge address is therefore hidden from Electron entirely, and is treated as "local" by the bridge's localhost preference.
- **Candidates.** `discoveredRefs` (`server-windows.ts:266`) makes an `http` ref from every advert host and address. `buildCandidates` (`server-discovery.ts:110`) orders stored https, then stored http, then at most `DISCOVERY_CANDIDATE_CAP = 3` discovered refs (`server-discovery.ts:104`).
- **Proof.** `probe` (`server-windows.ts:253`) calls `deps.prove(origin)` → `proveServerIdentity` (`packages/shared/src/server-pinning.ts:182–219`), a credential-free nonce challenge. Any proven fingerprint ≠ pin becomes `mismatch`. The working-tree hotfix maps `proven === localFp` to `unreachable`.
- **Open.** `pickHost` (`server-windows.ts:278`) reports `identity_mismatch` when nothing proves the pin and any candidate mismatched. `loadVerified` (`server-windows.ts:373`) heals the keyring, exchanges the bearer at `serverOrigin(host.ref)` and creates the window. If the ref is a hostname, every later request re-resolves it.
- **Window.** `createWindow` (`server-windows.ts:401`) binds origin-dependent handlers at creation (navigation guard, `dom-ready` marker, `/api/*` response listener, `server-windows.ts:421–483`).
- **Re-verification has two paths:**
  - `reverify` (`server-windows.ts:590`), scheduled every 60 s, on focus and on resume (`:502–509`); a non-pin proof calls `blankAfterMismatch` (`:574`).
  - `recheck` (`server-windows.ts:546`), the rate-limited credential re-check after an API 401/403, which first re-proves identity.
- **Partition.** `partitionFor(fp)` (`server-discovery.ts:61–65`) gives one partition per fingerprint, so cookies for several origins (former literals) can coexist in it.
- **Pairing.** `PairingTarget` carries one `ref` (`packages/electron/src/lib/pairing-client.ts:70–80`); `pairAgain`/`connectDiscovered` pass a single host (`server-windows.ts:643–677`). `reportMismatch` (`pairing-client.ts:150`) fires on proven ≠ expected.
- **Server known-servers.** Add returns `409 identity_changed` when a pinned address proves G≠F (`packages/server/src/routes/known-servers-routes.ts:180–183`). `backfill` (`:325`) pins whatever an unpinned reachable entry proves. The probe checks health and only backfills unpinned entries (`:298–347`).

### Observed failure (2026-10-22)

`192.168.64.1` (`bridge102`, macOS Virtualization default) existed on both Macs and was advertised by MacBook 2. On the iMac, the `.local` name resolved to it, and `reverify` proved the iMac's own fingerprint `hljQKE…` → `identity mismatch while open`. The same address overlap also made `isLocalService` flag MacBook 2's advert as local.

## Goals / Non-Goals

These goals are scoped to `http` LAN routes. `https` routes keep today's behaviour (TLS name validation, then fingerprint challenge).

- **G1:** For any interface or address layout, if a probed candidate reaches the server that proves the pin, the server is opened and kept open there. No address belonging to this machine or to another machine causes a mismatch report or a lost window.
- **G2:** The main process sends the bearer (`/api/device-session` exchange) only to the address literal whose challenge proved the pin in the same selection. When any verification of a loaded origin does not prove the pin, the page is navigated away and every `pi_dash_device` cookie in the partition is removed (awaited) before anything else is loaded.
- **G3:** An identity-mismatch report is never caused by this machine's own dashboard. It is raised whenever a foreign (non-self) fingerprint answers and no candidate proves the pin.
- **Accepted residual (unchanged from today):** on plain `http`, an attacker who takes over an address can receive the bearer (between proof and exchange) or the cookie (until a re-verification proves a non-pin identity). This includes an attacker who serves `/api/` while making the identity challenge fail, which looks like a transport failure. Only a channel bound to the fingerprint (TLS with key pinning) closes this. That is out of scope and recorded in Non-Goals.
- **Bounded discovery:** candidates are probed in ordered batches until a proof or the 5 s deadline. An attacker flooding adverts with many higher-ranked literals can delay the working address past the deadline (flooding alone causes "not reachable", no mismatch and no credential leak; any `foreign` proof actually observed is still reported per D4).

**Non-Goals**
- Cryptographic channel binding (TLS key pinning).
- A complete virtual-interface list (the filter stays best-effort).
- Route grouping UI (`group-servers-by-identity`).
- Changing pin, TOFU or knock semantics.
- Extension-bridge locality: the extension's one-shot discovery passes no own fingerprint and keeps today's heuristic.

## Decisions

### D1: Bind proof to an address literal (http)
Each `http` hostname candidate is resolved with an injected `lookup` (`dns.promises.lookup({ all: true })`; `.local` goes through the OS resolver) to at most **8 literals per hostname**. Each literal is a candidate with the hostname's rank. Stored literals keep their rank. The bearer exchange, the window origin, keyring `heal` and both re-verification paths use the proving literal. Resolution and challenges share the existing 5 s deadline (`HOST_SELECTION_DEADLINE_MS`); a name unresolved by then is unreachable.
- *What it fixes:* name re-resolution between proof and use, which was the observed failure.
- *What it does not fix:* address takeover (see residual).
- *Trade-off:* server-window origin storage (localStorage) is per literal, so a DHCP change resets it. The partition stays per fingerprint.

### D2: Classify a foreign proof as `self` or `foreign`
`classifyProof(proven, { pin, localFp }) → ok | self | foreign | unverified` (*new*, in `packages/shared/src/server-pinning.ts`, so `group-servers-by-identity`'s client route checker can import it too).
- `self`: `proven === localFp`, where `localFp` is proven by challenging this machine's own local origin (`proveLocal`, `server-windows-main.ts`), never read from an advert.
- `foreign`: any other fingerprint, or an invalid signature.

While `localFp` is still unresolved (local server starting or unhealthy), a non-pin proof is classified `unverified`: it is treated like a transport failure (no mismatch, retry at the next trigger) until one local proof succeeds. When Electron runs in remote mode (no local server), there is no self, so `localFp` is resolved as "none" and a non-pin proof is `foreign`.

There is no "other-peer" class. mDNS adverts are unauthenticated, so an advert must never downgrade a foreign proof. `self` is safe to downgrade because `localFp` is proven against the local server.

### D3: A fingerprint mismatch vetoes locality; selection ignores locality
- `createBrowser(opts)` and `discoverDashboard(opts)` (`mdns-discovery.ts`) accept an optional `ownFingerprint(): string | undefined`. `isLocalService` keeps the existing hostname/address heuristic, but when the advert carries `fp`, `ownFingerprint()` is known and they **differ**, the advert is **not** local. A matching fingerprint never creates locality on its own, so a clone (same fp, another machine, no address overlap) is still listed as a clone (`openspec/specs/mdns-discovery/spec.md:78–84`), and the `.local`-is-remote localhost-preference scenario is unchanged.
- The server and Electron pass their own fingerprint. The extension's one-shot `discoverDashboard` passes none (it does not hold one), so it keeps today's heuristic. That is a narrowed scope, noted under Non-Goals.
- **Selection does not use locality at all:** Electron `advertsFor(fp)` returns every advert carrying `fp` regardless of `isLocal`, excluding only `fp === localFp`. An advert falsely claiming this machine's fingerprint can therefore hide only itself, never the pinned server's adverts.

### D4: One re-selection transition behind both re-verification paths
`reverify` and `recheck` share `reselect(ow, proof)` (*new*). An open window has a state: `live`, `parked` (*new*: blank, timers running, recoverable) or `blanked` (today's terminal mismatch state: timers stopped).
1. **Transport failure** (nothing proved): keep the page loaded with "not reachable" in the title, **and** run `pickHost` (step 3). The page is not navigated away unless a different host is picked (see the residual in Goals).
2. **Any non-ok proof** (`self` or `foreign`): navigate to `about:blank` and set the state to `parked`. Clear **all cookies of the partition** with `session.clearStorageData({ storages: ["cookies"] })`, which the code already uses on forget (`server-windows.ts:711–712`). A cookie carries no port or scheme, so per-cookie removal cannot target former literals reliably. The partition holds only this server's cookies, so nothing else is lost. Await it. If it fails, log it, stay `parked` with timers running, and load nothing in this cycle (the next trigger retries). Then run step 3.
3. `pickHost(entry)`:
   - **Picked a host other than the current origin:** `pickHost` returns the proving literal from this selection. A new explicit `replaceWindow(ow, literal)` reuses it without re-resolving, closes the old window and creates a fresh one through `loadVerified`, so origin-bound handlers (`server-windows.ts:421–483`) are rebuilt. The exchange-refused branch (re-pair offer) applies unchanged. Log `host moved`, and log a warning line if a `foreign` proof was seen; no dialog. Picking the current origin of a `live` window changes nothing.
   - **Not picked, and a `foreign` proof was seen anywhere:** set the state to `blanked`, report the identity mismatch once and stop the timers (today's "report once, then silence"). Reopening by the user replaces the window (existing).
   - **Not picked, only `self` or unreachable:** stay `parked` (or `live` after a transport failure) with "not reachable"; the next 60 s / focus / resume trigger runs `reselect` again. No dialog.
- `focusExisting` (`server-windows.ts:333–344`) treats `parked` like `blanked`: a user open replaces it.

### D5: Candidate ordering, no veto
- An own-interface literal (`os.networkInterfaces()`, non-internal, `%zone` stripped) is **demoted to last**, not dropped. If it proves the pin (a forwarded port), it still wins.
- Discovered literals are ordered **on-link first**: inside a local interface's prefix, computed from that interface's own `netmask` or `cidr` (IPv4 and IPv6, no fixed /64).
- `DISCOVERY_CANDIDATE_CAP = 3` (a hard cut) is replaced by **ordered batches**: discovered literals are challenged in batches of 12 in D5 order until one proves the pin or the 5 s deadline expires (at most 8 literals per hostname). This is bounded, not complete (see "Bounded discovery" under Goals).

### D6: Pairing tries alternative refs, as literals
`PairingTarget` gains `alternatives: HostRef[]` (*new*): the same advert's other literals, ordered by D5, at most 8. The pairing client also resolves an `http` hostname primary ref to literals with the same injected `lookup` (D1) before proving, so the origin fixed at `pairing-client.ts:121–123` and reused for knock and poll (`packages/shared/src/pairing-knock-client.ts:170–211`) is the proving literal. The pairing client proves each in order. `self` means try the next. `foreign` means a mismatch, with the current strict behaviour: no knock, report. The first literal proving the expected fingerprint (or the TOFU-confirmed one) is used for the knock, the poll and the saved host. When all are exhausted with only `self`/unreachable results, report `unreachable`.

### D7: Server-side known-servers
- **Add:** after the operator guard passes (a non-operator add is still refused without contacting the target), if `proven === serverIdentity.fingerprint`, return `409 self_address`. This takes precedence over every other post-challenge outcome, including `identity_changed`, and nothing is pinned.
- **Backfill:** never pins its own fingerprint.
- **Move suggestions:** the selector currently takes the first on-link advertised address (`packages/server/src/known-server-moves.ts:113–149`). It now walks the advert's eligible on-link addresses in order (at most 4 challenges) until one proves the pinned fingerprint, skipping any that prove self. It never suggests a self-proving address.
- The probe status set is unchanged (out of scope; pinned probes do not challenge today).
- The client maps `self_address` to "That address reaches this dashboard itself, not another machine."

### D8: mDNS advertising filter (hotfix, kept)
`BRIDGE_IFACE` adds `bridge\d`, `vmnet` and `vboxnet` (`mdns-discovery.ts:153`). `utun` stays advertised (unique Tailscale addresses; an existing test asserts this). The filter is noise reduction only. D2–D5 do not depend on it.

## Risks / Trade-offs

- **R1: DNS latency within the 5 s deadline.** Lookups are concurrent, at most 8 literals per hostname, and challenged in ordered batches of 12 until a proof or the deadline.
- **R2: Plain-http residual exposure.** Accepted and documented (see Goals). It is unchanged from today, and D4 step 2 narrows it by clearing every partition cookie on any non-ok proof.
- **R3: Overlap with `group-servers-by-identity`.** Its route states label any G≠F as "Different identity". This change requires a `self` route state instead. A coordination task is added to that change's `tasks.md` (task 0.1). Its `known-servers` add delta must keep `self_address` precedence. Sequencing: this change lands first, and `group-servers-by-identity` rebases.
- **R4: Blank-on-any-non-ok is stricter while the window is loaded.** A user may briefly see a blank "not reachable" window when the window moves. Accepted, because content from an unproven origin must not stay on screen.

## Verification approach

- **L1 seeded-generator tests** (no new dependency) over random interface tables and adverts: shared bridge IPs on both sides, a VPN subnet clashing with the LAN, IPv6-only, more than 3 addresses per advert, the working address last, and a stale literal. They assert:
  - G1: pin reachable ⇒ opened, no mismatch;
  - G2: the bearer only goes to the proving literal; any non-ok proof ⇒ blank plus all cookies removed before any load;
  - G3: no mismatch from self; foreign with no pin ⇒ mismatch.
- **L1 unit tests:** `classifyProof`, D5 ordering (prefix-based), `isLocalService` with `ownFingerprint`, both re-verification paths, the pairing alternatives walk, and `self_address` precedence.
- **L3 harness:** two dashboard containers sharing an extra bridge address; check advertisement content, mutual non-local discovery and the `self_address` add refusal.
