## 1. Scaffold package

- [x] 1.1 Create `packages/hermes-memory-plugin/` with `package.json` mirroring `goal-plugin`: `name` `@blackbelt-technology/pi-dashboard-hermes-memory-plugin`, `type: module`, `exports` for `./client` + `./server`, `files: ["src/"]`, deps on `@blackbelt-technology/dashboard-plugin-runtime` + `@blackbelt-technology/pi-dashboard-shared`, `@mdi/js`/`@mdi/react`, peer `react`/`react-dom`/`wouter`.
- [x] 1.2 Add the `pi-dashboard-plugin` manifest: `id: "hermes-memory"`, `displayName: "Hermes Memory"`, `client`, `server`, `configSchema`, `claims: [{ slot: "settings-section", component: "HermesMemorySettings", tab: "general" }]`, `requires: { piExtensions: ["pi-hermes-memory"] }`.
- [x] 1.3 Register the package in the workspace (pnpm-workspace already globs `packages/*`) and regenerate the client plugin registry (`packages/client/src/generated/plugin-registry.tsx`) via its generator.
- [x] 1.4 Add a minimal `src/configSchema.json` (draft-07) documenting the plugin-level config (may be `{ enabled }` only; the hermes fields live in the external file, not dashboard config).

## 2. Shared schema + validation (TDD)

- [x] 2.1 Write `src/shared/__tests__/hermes-config.test.ts` asserting `DEFAULTS` matches the extension's `DEFAULT_CONFIG` values and the field set lists every `MemoryConfig` key.
- [x] 2.2 Write failing tests for `validateHermesConfig`: rejects unknown key, wrong type, out-of-range enum (`memoryMode`), negative/ non-integer numeric bound, and an uncompilable `correctionStrongPatterns` entry; accepts a full valid object. (spec: "Reject invalid config")
- [x] 2.3 Implement `src/shared/hermes-config.ts`: the `MemoryConfig` field descriptors (type + enum/bounds), `DEFAULTS`, `KNOWN_KEYS`, and `validateHermesConfig(body) → { ok, errors[] }` (unknown-key allowlist, type/enum/bound checks, regex compile check). Make 2.1–2.2 pass.
- [x] 2.4 Add a source-version pin comment referencing `pi-hermes-memory/src/types.ts` so the field set is re-checked on hermes upgrades (risk D-R1).

## 3. Server path resolution + IO (TDD)

- [x] 3.1 Write `src/server/__tests__/config-path.test.ts`: default agent root → `<home>/.pi/agent/hermes-memory-config.json`; `PI_CODING_AGENT_DIR=/tmp/agent` → `/tmp/agent/...`; `~`-expansion. (spec: "Resolve the hermes config file path")
- [x] 3.2 Implement `resolveHermesConfigPath(env)` replicating hermes `resolveAgentRoot()`; fixed filename, never from input.
- [x] 3.3 Write `src/server/__tests__/config-io.test.ts` against a temp dir: read-absent → `exists:false` + all defaults `isDefault:true`; read-present with one key → that field `isDefault:false`, others default; write creates parent dir + pretty JSON; write is atomic (tmp+rename, no partial file). (spec: "Read effective config", "Write the full resolved config")
- [x] 3.4 Implement `readEffectiveConfig(path)` → `{ filePath, exists, raw, fields }` and `writeResolvedConfig(path, obj)` (tmp-file + `fs.rename`, `mkdir -p` parent).

## 4. Server routes (TDD)

- [x] 4.1 Write `src/server/__tests__/routes.test.ts` (inject a Fastify instance): `GET` returns the effective shape; `PUT` valid → 200 + file written; `PUT` invalid (unknown key / bad enum / bad regex) → 400 + file unchanged. (spec: all route scenarios)
- [x] 4.2 Implement `src/server/index.ts` `registerPlugin(ctx)`: register `GET`/`PUT /api/plugins/hermes-memory/config` on `ctx.fastify`; PUT calls `validateHermesConfig` first, 400 on failure (no write), else `writeResolvedConfig`.
- [x] 4.3 Add structured logging (`logger.info` path + field count on read/write; `logger.warn`/`error` + reason on failure) — never log field values. (observability-instrumentation checkpoint)

## 5. Client settings surface

- [x] 5.1 Implement `src/client/hermes-api.ts`: `getConfig()` / `putConfig(full)` against `${apiBase}/api/plugins/hermes-memory/config`.
- [x] 5.2 Implement `src/client/HermesMemorySettings.tsx` promoting `mockups/hermes-settings.html`: 9 grouped accordions, per-field control + DEFAULT badge (from `isDefault`) + Reset, sticky save bar with change count, raw-JSON view, "applies to new sessions" notice. Map tokens 1:1 to `index.css` vars (no raw hex).
- [x] 5.3 On save, build the full resolved config from current field values and `putConfig`; reload reflects saved values. (spec: "Save persists via the write route")
- [x] 5.4 Export `HermesMemorySettings` from `src/client/index.tsx`.

## 6. UX-review deferrals (from mockups/ux-review.md)

- [x] 6.1 Inline client validation: number fields `min`/integer; each `correction*Patterns` line compiled with an error hint; disable Save while any field is invalid.
- [x] 6.2 Reveal `memoryPolicyCustomText` only when `memoryPolicyStyle === "custom"`.
- [x] 6.3 Add a `prefers-reduced-motion` guard on transitions.

## 7. Component tests

- [x] 7.1 Write `src/client/__tests__/HermesMemorySettings.test.tsx`: unset field shows default + DEFAULT badge; reset returns a changed field to default; save issues a PUT with the full config. (spec: "Settings form shows current value or default")
- [x] 7.2 Write `src/__tests__/manifest.test.ts`: manifest declares the `settings-section` claim and `requires.piExtensions: ["pi-hermes-memory"]` (activation gate — spec: "Activate only when the extension is installed").

## 8. Docs

- [x] 8.1 Add per-file rows to `packages/hermes-memory-plugin/**/AGENTS.md` (scaffold dir trees via `kb dox init`) for every new file.
- [x] 8.2 DocScribe: add a caveman-style note to `docs/architecture.md` — new plugin, the two routes, the external-file contract, and the "applies to new sessions" caveat.

## 9. Build, verify, QA

- [x] 9.1 `npm run build` (client) + `npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures; all new tests green.
- [x] 9.2 `review-code` pass on the diff before commit (security-hardening focus: PUT validation + path handling).
- [x] 9.3 (DEFERRED — manual browser QA, tested later) Isolated-verification browser QA (non-8000 ports, temp HOME, openspec poll disabled): load the settings section, edit + save a field, confirm the on-disk file changed and reload reflects it; verify dark + light.
- [x] 9.4 `kb dox lint` clean for the new package.

## Tests / scenario coverage

- [x] T.1 Every spec scenario in `specs/hermes-memory-settings/spec.md` maps to a test in §2/§3/§4/§7 above (path resolution, read effective/default, full write, atomic write, 3 rejection cases, activation gate, form default+badge, reset, save-PUT).

## Validate

- [x] V.1 `openspec validate "add-hermes-memory-settings-plugin"` passes.
- [x] V.2 (DEFERRED — manual, tested later) Manual: with `pi-hermes-memory` installed, the section appears; with it absent, it does not.
