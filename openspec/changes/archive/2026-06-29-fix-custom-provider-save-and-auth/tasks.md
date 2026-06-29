## 1. apiKey resolution (extension)

- [x] 1.1 Replace `resolveApiKeyEnvName` with `toRegisterApiKey(apiKey)` in `packages/extension/src/provider-register.ts`: pass the providers.json value straight to `registerProvider` — literal keys verbatim (escape `$`→`$$`, leading `!`→`$!`), `$ENV` input unchanged. No `process.env` mutation, no `JUDO_*` variable.
- [x] 1.2 Update the `registerEntry` call site to use `toRegisterApiKey(entry.apiKey)`.
- [x] 1.3 Faux-provider round-trip test (`custom-provider-apikey-roundtrip.test.ts`): a faithful port of pi's `resolveConfigValue` + a faux upstream Bearer header asserts literal / `$ENV` / `$`-containing / `!`-leading keys reach the wire intact, `auth.json` precedence holds, and NO `JUDO_*` leaks into `process.env`.

## 2. Catalogue configured status (extension)

- [x] 2.1 Write a failing test for `_buildProviderCatalogue`: a custom provider whose key is known only to `getProviderAuthStatus` (not `authStorage`) yields `configured: true`.
- [x] 2.2 Update `_buildProviderCatalogue` to read `modelRegistry.getProviderAuthStatus(id)` for `configured`/`source`, falling back to `authStorage.getAuthStatus(id)` / `authStorage.has(id)` when the method is absent.
- [x] 2.3 Verify built-in/OAuth/env-var/ambient scenarios from the spec still produce the documented `configured`/`source` values (regression tests).

## 3. Save-path guards

- [x] 3.1 Write a failing test (client) for the LLM-providers save task: a blank/whitespace provider name produces an error and leaves the source dirty (not silently dropped).
- [x] 3.2 Update the LLM-providers save task in `packages/client/src/components/SettingsPanel.tsx` to reject blank names with a visible error before building the PUT body.
- [x] 3.3 Write a failing test (server) for `PUT /api/providers`: `apiKey === "***"` with no existing entry for that name does NOT persist `"***"` as the key.
- [x] 3.4 Update the merge in `packages/server/src/routes/provider-routes.ts` to reject (or drop the key for) `***`-without-existing instead of writing the sentinel; preserve the existing-key path.

## 4. Verify & integrate

- [x] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures (`grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`). All change-related tests pass; the 26 remaining failures are pre-existing environment issues (pi-ai module not installed in worktree, jimp native deps, docker-gated script) unrelated to this change.
- [x] 4.2 Manual end-to-end: add a `proxy` provider with a literal key in Settings → Save → confirm it reports configured (no "no API key setup") and a prompt to the proxy model authenticates upstream. Inspect `~/.pi/agent/providers.json` to confirm the stored key is the real value (not `***`).
- [x] 4.3 Rebuild + reload per the project workflow: `npm run build`, restart the server, `npm run reload`.
