## 1. Tests first (TDD — red before implementation)

- [ ] 1.1 Server test (`packages/server/src/__tests__/provider-test-route.test.ts` neighbour): `PUT /api/providers` runs `probeProvider` and stores `{ ok, status, error, modelCount, testedAt }` in the health cache.
- [ ] 1.2 Server test: `POST /api/providers/test` stores its result into the same cache.
- [ ] 1.3 Server test: the health read returns the cached result WITHOUT issuing a new probe (spy on `probeProvider` — not called on read).
- [ ] 1.4 Server test (security): the health read payload contains no API key / credential field.
- [ ] 1.5 Client tests: the four pill registers (connected+count / status / unreachable / not-tested) and the verbatim error line render from cached health; Test response updates the pill live.
- [ ] 1.6 Confirm 1.1–1.5 RED against unmodified source.

## 2. Server: probe-on-save + cache (specs: provider-connection-test)

- [ ] 2.1 Add a per-provider health cache `{ ok, status, error, modelCount, testedAt }` (in-memory module; no new persistence file unless provider metadata already uses one).
- [ ] 2.2 `PUT /api/providers`: after a successful save, run `probeProvider` and write the result to the cache (do not block the save response on the probe if it is slow — decide sync vs fire-and-forget in design; default: await so the pill is correct on next read).
- [ ] 2.3 `POST /api/providers/test`: write its result into the same cache before returning.
- [ ] 2.4 Expose cached health under the existing `/api/providers` auth posture (fold into the providers GET payload, or add `GET /api/providers/health`), credential-free.
- [ ] 2.5 Verify 1.1–1.4 GREEN.

## 3. Client: health pill + error line (specs: provider-connection-test)

- [ ] 3.1 Provider row renders the pill from cached health: green+count / yellow+status / red "Unreachable" / neutral "not tested".
- [ ] 3.2 On non-`ok` health, render the verbatim `error` string on a second monospace line beneath the pill.
- [ ] 3.3 Test button updates the pill + error line from its response without a reload.
- [ ] 3.4 Verify 1.5 GREEN.

## 4. Verify, review, rebuild

- [ ] 4.1 Full unit suite green; Biome clean on changed files (`--error-on-warnings`); tsc clean on touched files.
- [ ] 4.2 `security-hardening` pass: no credential/error leakage in the cached payload or logs; health read auth matches `/api/providers`.
- [ ] 4.3 `review-code` pass on the diff (server route + client settings) before commit.
- [ ] 4.4 Deploy per rebuild matrix — server → `POST /api/restart`; client → `npm run build` + `POST /api/restart`. Manual smoke: save a provider with a bad key → row shows yellow `401` + `invalid x-api-key`; fix key → Test → green `Connected · N models`.
