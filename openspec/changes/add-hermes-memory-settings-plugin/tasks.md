## 1. Scaffold package

- [ ] 1.1 Create `packages/hermes-memory-plugin/` with `package.json` mirroring `goal-plugin`: `name` `@blackbelt-technology/pi-dashboard-hermes-memory-plugin`, `type: module`, `exports` for `./client` + `./server`, `files: ["src/"]`, deps on `@blackbelt-technology/dashboard-plugin-runtime` + `@blackbelt-technology/pi-dashboard-shared`, `@mdi/js`/`@mdi/react`, peer `react`/`react-dom`/`wouter`.
- [ ] 1.2 Add the `pi-dashboard-plugin` manifest: `id: "hermes-memory"`, `displayName: "Hermes Memory"`, `client`, `server`, `configSchema`, `claims: [{ slot: "settings-section", component: "HermesMemorySettings", tab: "general" }]`, `requires: { piExtensions: ["pi-hermes-memory"] }`.
- [ ] 1.3 Register the package in the workspace (pnpm-workspace already globs `packages/*`) and regenerate the client plugin registry (`packages/client/src/generated/plugin-registry.tsx`) via its generator.
- [ ] 1.4 Add a minimal `src/configSchema.json` (draft-07) documenting the plugin-level config (may be `{ enabled }` only; the hermes fields live in the external file, not dashboard config).

## 2. Shared schema + validation (TDD)

- [ ] 2.1 Write `src/shared/__tests__/hermes-config.test.ts` asserting `DEFAULTS` matches the extension's `DEFAULT_CONFIG` values and the field set lists every `MemoryConfig` key.
- [ ] 2.2 Write failing tests for `validateHermesConfig`: rejects unknown key, wrong type, out-of-range enum (`memoryMode`), negative/ non-integer numeric bound, and an uncompilable `correctionStrongPatterns` entry; accepts a full valid object. (spec: "Reject invalid config")
- [ ] 2.3 Implement `src/shared/hermes-config.ts`: the `MemoryConfig` field descriptors (type + enum/bounds), `DEFAULTS`, `KNOWN_KEYS`, and `validateHermesConfig(body) → { ok, errors[] }` (unknown-key allowlist, type/enum/bound checks, regex compile check). Make 2.1–2.2 pass.
- [ ] 2.4 Add a source-version pin comment referencing `pi-hermes-memory/src/types.ts` so the field set is re-checked on hermes upgrades (risk D-R1).

## 3. Server path resolution + IO (TDD)

- [ ] 3.1 Write `src/server/__tests__/config-path.test.ts`: default agent root → `<home>/.pi/agent/hermes-memory-config.json`; `PI_CODING_AGENT_DIR=/tmp/agent` → `/tmp/agent/...`; `~`-expansion. (spec: "Resolve the hermes config file path")
- [ ] 3.2 Implement `resolveHermesConfigPath(env)` replicating hermes `resolveAgentRoot()`; fixed filename, never from input.
- [ ] 3.3 Write `src/server/__tests__/config-io.test.ts` against a temp dir: read-absent → `exists:false` + all defaults `isDefault:true`; read-present with one key → that field `isDefault:false`, others default; write creates parent dir + pretty JSON; write is atomic (tmp+rename, no partial file). (spec: "Read effective config", "Write the full resolved config")
- [ ] 3.4 Implement `readEffectiveConfig(path)` → `{ filePath, exists, raw, fields }` and `writeResolvedConfig(path, obj)` (tmp-file + `fs.rename`, `mkdir -p` parent).

## 4. Server routes (TDD)

- [ ] 4.1 Write `src/server/__tests__/routes.test.ts` (inject a Fastify instance): `GET` returns the effective shape; `PUT` valid → 200 + file written; `PUT` invalid (unknown key / bad enum / bad regex) → 400 + file unchanged. (spec: all route scenarios)
- [ ] 4.2 Implement `src/server/index.ts` `registerPlugin(ctx)`: register `GET`/`PUT /api/plugins/hermes-memory/config` on `ctx.fastify`; PUT calls `validateHermesConfig` first, 400 on failure (no write), else `writeResolvedConfig`.
- [ ] 4.3 Add structured logging (`logger.info` path + field count on read/write; `logger.warn`/`error` + reason on failure) — never log field values. (observability-instrumentation checkpoint)

## 5. Client settings surface

- [ ] 5.1 Implement `src/client/hermes-api.ts`: `getConfig()` / `putConfig(full)` against `${apiBase}/api/plugins/hermes-memory/config`.
- [ ] 5.2 Implement `src/client/HermesMemorySettings.tsx` promoting `mockups/hermes-settings.html`: 9 grouped accordions, per-field control + DEFAULT badge (from `isDefault`) + Reset, sticky save bar with change count, raw-JSON view, "applies to new sessions" notice. Map tokens 1:1 to `index.css` vars (no raw hex).
- [ ] 5.3 On save, build the full resolved config from current field values and `putConfig`; reload reflects saved values. (spec: "Save persists via the write route")
- [ ] 5.4 Export `HermesMemorySettings` from `src/client/index.tsx`.

## 6. UX-review deferrals (from mockups/ux-review.md)

- [ ] 6.1 Inline client validation: number fields `min`/integer; each `correction*Patterns` line compiled with an error hint; disable Save while any field is invalid.
- [ ] 6.2 Reveal `memoryPolicyCustomText` only when `memoryPolicyStyle === "custom"`.
- [ ] 6.3 Add a `prefers-reduced-motion` guard on transitions.

## 7. Component tests

- [ ] 7.1 Write `src/client/__tests__/HermesMemorySettings.test.tsx`: unset field shows default + DEFAULT badge; reset returns a changed field to default; save issues a PUT with the full config. (spec: "Settings form shows current value or default")
- [ ] 7.2 Write `src/__tests__/manifest.test.ts`: manifest declares the `settings-section` claim and `requires.piExtensions: ["pi-hermes-memory"]` (activation gate — spec: "Activate only when the extension is installed").

## 8. Docs

- [ ] 8.1 Add per-file rows to `packages/hermes-memory-plugin/**/AGENTS.md` (scaffold dir trees via `kb dox init`) for every new file.
- [ ] 8.2 DocScribe: add a caveman-style note to `docs/architecture.md` — new plugin, the two routes, the external-file contract, and the "applies to new sessions" caveat.

## 9. Build, verify, QA

- [ ] 9.1 `npm run build` (client) + `npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures; all new tests green.
- [ ] 9.2 `review-code` pass on the diff before commit (security-hardening focus: PUT validation + path handling).
- [ ] 9.3 Isolated-verification browser QA (non-8000 ports, temp HOME, openspec poll disabled): load the settings section, edit + save a field, confirm the on-disk file changed and reload reflects it; verify dark + light.
- [ ] 9.4 `kb dox lint` clean for the new package.

## Tests / scenario coverage

- [ ] T.1 Every spec scenario in `specs/hermes-memory-settings/spec.md` maps to a test in §2/§3/§4/§7 above (path resolution, read effective/default, full write, atomic write, 3 rejection cases, activation gate, form default+badge, reset, save-PUT).

## Validate

- [ ] V.1 `openspec validate "add-hermes-memory-settings-plugin"` passes.
- [ ] V.2 Manual: with `pi-hermes-memory` installed, the section appears; with it absent, it does not.
