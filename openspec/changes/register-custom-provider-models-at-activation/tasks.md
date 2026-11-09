# Tasks

## 1. Discovery cache

- [ ] 1.1 Add a per-provider discovery-cache module in `packages/extension/src/` per design D3 (`~/.pi/dashboard/custom-provider-models/<encoded-name>.json`, mode 0600, tmp-with-pid + rename; read total over missing/malformed → no entry; usable = same baseUrl + same key fingerprint over the `$ENV`-resolved key + non-empty models). Verify with unit tests: round-trip, malformed file, baseUrl/fingerprint mismatch, two providers written concurrently both survive, written file never contains the apiKey string.
- [ ] 1.2 Route every live discovery through one record-on-success helper: switch `registerEntry` from `discoverModels` to `tryDiscoverModels` (failure still registers `[]` ∪ native models as today) and call the helper there, in the startup `--model` discovery, and in the `reloadProvidersNow` forced-refresh path. Verify with unit tests: failed/empty fetch leaves an existing entry untouched; cache-sourced (`prediscovered`) registration does not write; a forced refresh updates the entry.
- [ ] 1.3 Give `tryDiscoverModels` an optional `signal` combined with its 10 s timeout via `AbortSignal.any`. Verify with a unit test that an aborted signal resolves `null` promptly.

## 2. Startup registration

- [ ] 2.1 In `activate()`: register every provider with a usable cache entry via `registerEntry(…, cached)` synchronously; keep the background `registerEntry` for EVERY provider (cached too) on `reloadChain`; derive the startup target from argv per design D2 (`--provider <p>` wins; else `--model` text before the first `/`; case-insensitive; bare id → none) and, when it is a custom provider lacking a usable entry, start one live discovery for `<p>` under a 5 s signal (joined to `reloadChain`), register + record on success, log `startup discovery for "<p>" failed` on null/empty. Store the startup promise for `awaitStartupProviderModels(pi)`. Verify with unit tests: cache hit registers models synchronously and still schedules background discovery; argv parsing table (`--model proxy/cc/x`, `--provider proxy --model cc/x`, `--model PROXY/cc/x`, bare id, built-in); no `--model` → nothing awaited; startup promise never rejects; uncached `--model` provider awaited once and bounded at 5 s with auth still registered and a logged failure.
- [ ] 2.2 End the bridge default export (`packages/extension/src/bridge.ts:120-156`) with `return await awaitStartupProviderModels(pi)` inside the existing try, leaving the synchronous body, its order, the inert early return and the re-entry guard unchanged. Verify `packages/extension/src/__tests__/bridge-reentry-guard.test.ts`, `model-resolve.test.ts` and `enrich-model-metadata.test.ts` pass unchanged.

## 3. Automated scenarios (test-plan.md)

- [ ] 3.1 L1 cached provider registered without network, input cache file for proxy listing cc/a and cc/b · trigger activate then await awaitStartupProviderModels · observable registerProvider with both models before any fetch and zero startup fetches (test-plan #E1); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.2 L1 background discovery for cached providers, input cache cc/a,cc/b and stub returning cc/a,cc/c · trigger background registerEntry settles · observable second registerProvider with cc/a,cc/c and cache rewritten (test-plan #E2); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.3 L1 startup target parsing table, input argv rows --model proxy/cc/x, --provider proxy --model cc/x, --model PROXY/cc/x, bare id, built-in, none · trigger derive target · observable proxy, proxy, proxy, none, none, none with one live discovery only for the first three (test-plan #E3); exemplar packages/extension/src/__tests__/model-resolve.test.ts
- [ ] 3.4 L1 cache usability table, input matching, baseUrl differs, resolved env key differs, empty models · trigger activate with --model proxy/cc/x · observable only matching skips the fetch (test-plan #E4); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.5 L1 failed or empty discovery never writes, input cache cc/a,cc/b and stub HTTP 500 then empty data · trigger background registerEntry · observable cache byte-identical and fallback registration still made (test-plan #E5); exemplar packages/extension/src/__tests__/provider-register-native-models.test.ts
- [ ] 3.6 L1 cache-sourced registration never writes, input cache cc/a and hanging stub · trigger registerEntry with cached models · observable cache file unchanged (test-plan #E6); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.7 L1 forced refresh records to cache, input cache cc/a and stub cc/a,cc/b · trigger reloadProviders with force proxy · observable cache lists cc/a,cc/b (test-plan #E7); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.8 L1 no credentials in cache, input literal key sk-SECRET-123 and an env-referenced key · trigger successful discovery write · observable file text lacks both secrets and has a 16-hex keyFingerprint (test-plan #E8); exemplar packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts
- [ ] 3.9 L1 concurrent writers keep entries, input results for proxy and local · trigger interleaved writes · observable both per-provider files parse with mode 0600 (test-plan #E9); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.10 L1 malformed cache tolerated, input proxy cache file with invalid JSON · trigger activate · observable no throw and proxy treated as uncached (test-plan #E10); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.11 L1 bridge default export keeps its synchronous body, input recordingPi · trigger call default export without await · observable same synchronous registrations immediately and a returned Promise (test-plan #E11); exemplar packages/extension/src/__tests__/bridge-reentry-guard.test.ts
- [ ] 3.12 L1 warm cache adds no latency, input three cached providers and a 10 s stub · trigger await startup · observable resolves under 50 ms with fake timers (test-plan #P1); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.13 L1 uncached --model provider bounded, input --model down/x and a never-answering stub · trigger await startup · observable resolves at 5000 ms within one timer tick (test-plan #P2); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.14 L1 unrelated slow provider ignored, input no --model and uncached hanging down · trigger await startup · observable resolves under 50 ms (test-plan #P3); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.15 L1 startup failure logged not fatal, input --model down/x and aborting stub · trigger await startup · observable promise resolves, log names down, auth pre-registration recorded (test-plan #X1); exemplar packages/extension/src/__tests__/provider-register-reload.test.ts
- [ ] 3.16 L1 rejection cannot discard queued registrations, input one cached provider whose registerEntry throws · trigger await default-export promise · observable promise resolves and other cached registrations recorded (test-plan #X2); exemplar packages/extension/src/__tests__/bridge-reentry-guard.test.ts
- [ ] 3.17 L2 real pi resolves a custom --model at cold start, input local /v1/models stub answering after 1 s, temp HOME providers.json, empty cache · trigger pi -p --model stub/faux-1 · observable no Model not found, no early exit 1, cache file written (test-plan #X3); exemplar qa/tests/10-faux-model.sh
- [ ] 3.18 L2 real pi with unreachable uncached --model provider, input providers.json dead on a closed port, empty cache · trigger pi -p --model dead/x · observable exits within 15 s with Model not found (test-plan #X4); exemplar qa/tests/10-faux-model.sh

## 4. Manual verification

- [ ] 4.1 Run the notes-to-issues automation with @coding on proxy/cc/claude-sonnet-5-5 and confirm the session registers and flow steps run (test-plan: manual-only)

## 5. Verification and docs

- [ ] 5.1 Manual check: `pi --model proxy/cc/claude-sonnet-5-5 -p "say OK"` succeeds with a warm cache and after deleting `~/.pi/dashboard/custom-provider-models/`; rerun the `notes-to-issues` automation and confirm its session registers.
- [ ] 5.2 Update `packages/extension/src/provider-register.ts.AGENTS.md`, `packages/extension/src/AGENTS.md` (cache module row) and the bridge default-export note.

## Workflow follow-up

- Then plan `fail-automation-run-on-spawn-failure` (scaffolded) for fast run failure on any other pre-register crash.
