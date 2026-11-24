# DOX — packages/google-plugin/src/shared

Pure code shared by server, client and tools. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/products.test.ts` | Catalogue order + D4 scopes, implication coverage, union consent scopes (no `include_granted_scopes`), built-in Drive limit, restricted products, `parseSelection` strictness. |
| `__tests__/retry-policy.test.ts` | GB15 retry decision: 3 attempts, 500/1000 ms + jitter, 30 s cap, `Retry-After` > 30 s → `rate_limited` at once. |
| `__tests__/backoff.test.ts` | Retry policy values: 3 attempts, 500/1000 ms + jitter, 30 s cap, `Retry-After` parsing, retryable methods. |
| `__tests__/shared.test.ts` | Operator switches (A1), client JSON (A4), domains (A5), return origins (B3), endpoints override, local-browser rule, flow-code allow-list. |
| `__tests__/workspace-path.test.ts` | Path guard: traversal, symlinked parent/final component, no overwrite, Windows forms, read confinement, size limit. |
| `__tests__/workspace-path-temp.test.ts` | #GC11: temp file lives in the target dir (observed via the `link` call), linked into place; a failed commit leaves no temp. |
| `api-hosts.ts` | `apiBase(product, endpoints)` — REST base per product API; under the loopback test override every API hangs off `<fake origin>/<calendar/v3 \| drive/v3 \| docs/v1 \| sheets/v4 \| slides/v1 \| tasks/v1 \| people/v1>`. |
| `backoff.ts` | Retry policy (D14 B15/C1/C2): 3 attempts, 500 ms ×2 + ≤ 25 % jitter, 30 s cap, `Retry-After` parsing (seconds / HTTP-date; junk → default), `isRetryable` (429 always; 5xx/network only GET/PUT/DELETE), `nextDelay` (`tooLong` → `rate_limited`). |
| `client-json.ts` | `validateClientJson` — Desktop (`installed`) OR Web (`web`), never both (`ambiguous_client`); codes `not_json`/`not_installed`/`bad_client_id`/`missing_secret`. `normalizeDomain` (trim, lowercase, strip `@`, needs a dot), `slugify`. |
| `default-clients.ts` | `BUILT_IN = {local:null, remote:null}` (ships empty until verification), `builtInFor(env, overridden)` (L3 seam: placeholder apps only when `PI_E2E_GOOGLE_BUILTIN=1` AND the loopback fake-Google override is active), `DISCLOSURE_VERSION`, `RETURN_PAGE_URL`, `createSwitchReader(env,warn)` — `PI_GOOGLE_DEFAULT_CLIENTS` / `PI_GOOGLE_REMOTE_RETURN` (`off`/`0`/`false` disable; unknown warned once), read live. |
| `endpoints.ts` | `resolveGoogleEndpoints` — `PI_E2E_GOOGLE_BASE_URL` honoured ONLY for loopback http; non-loopback ignored with one warning. |
| `flow-codes.ts` | `knownFlowCode` — allow-list of fixed sign-in failure codes for the log line / client table. |
| `google-errors.ts` | `mapGoogleError(product, status, body, level?)` — 403 from the machine reason only → `api_disabled` (service + numeric project + `gcloud services enable …`) / `scope_insufficient`, else `<product>_error`; `SERVICES` (label, error code, API host per product), `sanitize`. |
| `local.ts` | `isGenuinelyLocal(headers, remoteAddress)` — loopback peer AND no `x-forwarded-*`/`forwarded`/`via`/`x-real-ip`. |
| `products.ts` | Catalogue (single source): products, ordered levels, scopes, Google class, built-in availability. `scopesFor`/`requiredScopes`/`effectiveScopes`/`coversSelection`/`unionScopes`/`scopeParam`/`restrictedProducts`/`builtinRefused`/`parseSelection`. |
| `protocol.ts` | Lane names `google/lease`, `google/accounts`, service `google.connect`; `LeaseReply`, `LeaseRefusal`, `AccountStatus`. |
| `return-origin.ts` | `allowedReturnOrigin` — `https:` or loopback `http:` origins without userinfo (B3); mirrored by `site/oauth/return.html`. |
| `setup.ts` | `PROJECT_ID_RE`, `normalizeEmail`, `isEmail` (linear-time), `projectMismatch(expected, uploaded)` — wizard project vs uploaded JSON project (warning only, A6). Ported from gmail-plugin. |
| `workspace-path.ts` | Session-cwd path guard ported from gmail (no import edge): `confineToCwd`, `planSave` (validate a new target before any fetch: confined, real name, absent), `commitSave`/`saveInsideCwd` (creates parent dirs inside the cwd, temp file → hard link: never overwrites, no partial file), `readInsideCwd`, `PathRefusedError`. |
| `picker.ts` | `gdrive_pick` wire contract (design D9): `PICKER_KIND`, `pickerPluginMeta`, `PickerAnswer` + `parsePickerAnswer` (bounds the browser's JSON answer; garbage → nothing picked), `PICKER_TIMEOUT_MS` (5 min). |
