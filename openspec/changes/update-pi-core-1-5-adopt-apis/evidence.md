# Evidence: update-pi-core-1-5-adopt-apis

The packages were fetched with `npm pack` and unpacked, not installed: `/tmp/pi13/<pkg>/package` (1.3.0) and `/tmp/pi15/<pkg>/package` (1.5.0) for `pi-coding-agent`, `pi-ai`, `pi-agent-core`, `pi-tui`, plus `pi-schema` (1.5.0 only). The runtime observations below were made with the user's global pi install (`~/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent`, `version: 1.5.0`). The repo's `node_modules` is still 1.3.0.

## Dependency delta (package.json, 1.3.0 → 1.5.0)

| package | dep | 1.3.0 | 1.5.0 |
|---|---|---|---|
| pi-coding-agent | `@earendil-works/pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp`, `pi-tui` | `1.3.0` (exact) | `1.5.0` (exact) |
| pi-coding-agent | `typebox` | `1.3.27` | `1.3.27` |
| pi-coding-agent | `minimatch` | `10.2.6` | `11.0.3` |
| pi-coding-agent | `undici` | `8.10.2` | `8.12.3` |
| pi-ai | `typebox` | `1.3.27` | removed |
| pi-ai | `@earendil-works/pi-schema` | — | `1.5.0` |
| pi-ai | `@earendil-works/pi-telemetry` | `1.3.0` | `1.5.0` |
| pi-agent-core | `typebox` | `1.3.27` | removed |
| pi-agent-core | `@earendil-works/pi-schema` | — | `1.5.0` |
| pi-tui | `marked-cjk-friendly` | — | `0.1.2` |
| all four | `engines.node` | `>=22.19.0` | `>=22.19.0` |

`pi-schema@1.5.0` declares `engines.node >=22.19.0` and exports `.` and `./formats`.

**Exports maps (key lists) are equal 1.3.0 ↔ 1.5.0:**
- pi-coding-agent: `.`, `./rpc-entry`.
- pi-ai: `.`, `./models`, `./compat`, `./providers/*`, `./api/*`, `./utils/*`, `./oauth`, `./bedrock-provider`, `./bun-oauth`.
- pi-agent-core: `.`, `./package.json`.
- pi-tui: no `exports` (`main: dist/index.js`) in both versions.

No subpath was removed.

**pi-ai no longer re-exports TypeBox:** 1.3.0 `dist/index.d.ts:1-2` has `export type { Static, TSchema } from "typebox"; export { Type } from "typebox";`. 1.5.0 `dist/index.d.ts` has no `typebox` line, and `:34` exports `./utils/validation.ts`. The pi-coding-agent 1.5.0 extension loader still aliases `typebox`, `typebox/compile` and `typebox/value` for extensions (`dist/core/extensions/loader.js:42-44,81-82`).

## Project trust (D2)

`diff /tmp/pi13/…/dist/core/project-trust.js /tmp/pi15/…/dist/core/project-trust.js` has exactly one hunk:

```diff
23c23
<         return true;
---
>         return options.trustStore.get(options.cwd) ?? true;
```

Context (1.5.0 `resolveProjectTrusted`, `:18-40`): `trustOverride` → `!hasTrustRequiringProjectResources(cwd)` → **`trustStore.get(cwd) ?? true`** → extension `project_trust` handlers → `trustStore.get(cwd)` → default. On the no-resources path pi consults neither extensions nor `defaultProjectTrust`.

`trust-manager.js` 1.3.0 → 1.5.0: `findTrustFileKeys(data, path)` filters keys with `pathsEqual` (case-insensitive on Windows), and both the nearest-ancestor lookup and the delete-on-set use it. The server reads recorded entries through pi's own `ProjectTrustStore` (`packages/server/src/pi/host-project-trust.ts:158-166` → `getEntry`, `trust-manager.js:185`; `packages/server/src/pi/resource-toggle-trust.ts:126`), so it inherits the match. **The bridge does not:** it reads `trust.json` lockless and looks keys up with `nearestRecordedEntry` (`packages/shared/src/pi-trust-mirror-snapshot.ts:104-112`, `data[k]` per ancestor key, exact), called from `piStoreBlocks` (`packages/extension/src/project-trust.ts:152-157`). For a folder with trust-requiring resources, 1.5.0 `resolveProjectTrusted` applies the extension `project_trust` answer before `trustStore.get` (`project-trust.js:25-41`), so on Windows a refusal stored as `C:\Work\Repo` is missed for the bridge key `c:\work\repo` and the bridge's yes wins. Adopted (design D2). `pathsEqual` → `getPathComparisonKey` (`dist/utils/paths.js:31-35,41-43`): `win32.resolve(p).toLowerCase()` on win32, `posix.resolve(p)` elsewhere, so non-normalised keys (`/r/`, `/a//r`, `/a/./r`) match on posix too. 1.5.0 `findNearestTrustEntry` returns `{ path: key, … }`, the stored key spelling (`trust-manager.js:28-31`); 1.3.0 returned `{ path: currentDir, … }` (`:26`). The toggle gate's own-folder check (`resource-toggle-trust.ts:131`; `canonical` at `:38-44` is `realpathSync(path.resolve(p))`, no case-folding) therefore reads a Windows case-different own refusal as inherited. pi 1.5 also excludes the user's `~/.agents/skills` with `pathsEqual` (`trust-manager.js:167`; `!==` at `:161` in 1.3.0 and 1.4.0); the dashboard digest uses `!==` (`pi-trust-resource-digest.ts:215`). Adopted (design D2). Version attribution checked on the unpacked 1.4.0 tarball (`npm pack @earendil-works/pi-coding-agent@1.4.0` → `/tmp/pi14`): 1.4.0 `core/trust-manager.js` has no `pathsEqual`, while `extensions/mcp/config.js` already strips the BOM (`:51`, `:183`; 1.3.0 does not). So the BOM strip is 1.4.0 (#11191) and `pathsEqual` trust paths are 1.5.0 (#10488, changelog 1.5.0 "Fixed Windows paths being compared case-sensitively"). The legacy `createHostProjectTrust` adapter (`host-project-trust.ts:98-107`) has no production caller. `samePathStr` (`packages/shared/src/pi-trust-mirror.ts:130-132`) only compares mirror deny-list paths and is unrelated to trust-key lookup.

Repo order today:
- `packages/shared/src/pi-trust-mirror.ts:260` returns `implicit` before the recorded check at `:261-263`;
- `packages/server/src/pi/host-project-trust.ts:68` reads `recordedEntry` only when `hasTrustRequiringResources`, and `:75` forces `piDefault: "ask"` on the no-resources path;
- `packages/shared/src/__tests__/pi-trust-mirror.test.ts:165-167` pins the old order (`hasTrustRequiringResources: false, recordedEntry: { decision: false }` → `{ trusted: true, source: implicit }`);
- `packages/server/src/__tests__/host-project-trust.test.ts:115-118` (no resources, nothing recorded → `implicit`) stays true under 1.5.

CI gap accepted (test-plan decision G1): the bridge's Windows-casing case in `packages/extension/src/__tests__/project-trust.test.ts` runs under `it.runIf(process.platform === "win32")`, and unit vitest runs on `ubuntu-latest` only (`.github/workflows/ci.yml`), so CI never executes it. CI proof of the casing match comes from the injected-`path.win32` unit rows (test-plan E19, E22, E23, E29); the bridge only forwards the native `piTrustKey`. The digest casing case does run in CI, through the injected `pathApi` (design D2).

`resource-toggle-trust.ts` is already coherent with 1.5: it reads `getEntry(cwd)` first for every folder (`:126-139`; a recorded `true` → proceed, a refusal recorded for the folder itself → refused). `implicitlyTrusted` is computed only when no entry exists (`:155,161`) or when the only entry is an inherited refusal, which it excludes explicitly (`:180`).

## Tool-argument validation (D3)

pi-ai 1.5.0 `dist/utils/validation.js`: `compile(schema, { formats, coerce: true, unresolvedRefs: "reject" })`, cached per schema object. `validateToolArguments` runs `parse(structuredClone(args))` and, on failure, throws `Validation failed for tool "<name>":\n  - <dotted path>: <message>…\n\nReceived arguments:\n<json>`.

Observed with the installed pi 1.5.0 pi-ai (`/tmp/pi15/v.mjs`), using the `ask_user`-shaped schema `{ method: string (required), options?: string[] }`:

| arguments | result |
|---|---|
| `{"method":"select"}` | `{"method":"select"}` |
| `{"method":"select","options":null}` | `{"method":"select"}` (null dropped) |
| `{"method":"select","options":"a"}` | `{"method":"select","options":["a"]}` (wrapped) |
| `{"method":"select","options":["a",1]}` | `{"method":"select","options":["a","1"]}` (coerced) |
| `{}` | throws `Validation failed for tool "ask_user":` / `  - method: missing` |

Further wording (`/tmp/pi15/v2.mjs`):
- `ctx_execute` with `{ language: "javascript\">" }` against `{ language: enum["shell","javascript"], code: string }`, both required → `  - code: missing` / `  - language: expected one of ["shell","javascript"]`;
- `{ n: "abc" }` against `{ n: number }` → `  - n: expected number, got string`.

Repo consequences:
- `packages/extension/src/__tests__/typebox-nullable-array-validation.test.ts:1-40` asserts `typebox/value` `Value.Check` semantics (`null` rejected, `["a",1]` rejected) and claims to be "the same validator pi uses". That claim was already false in 1.3.0: pi-ai 1.3.0's `validateToolArguments` drops optional `null`s before checking (`dist/utils/validation.js:204-229,284-286`, `normalizeOptionalNulls`).
- `packages/client/src/components/tool-renderers/parse-ctx-result.ts:86` matches `^Validation failed for tool "(ctx_\w+)":`. The prefix is unchanged, so it still matches.
- `parse-ctx-result.fixtures.ts:16` (`err_validation`) carries AJV-era wording (`must have required properties code`, `must be equal to one of the allowed values`). It is asserted in `__tests__/parse-ctx-result.test.ts:107` and `__tests__/CtxToolRenderer.test.tsx:213` (plus the comment at `:285-286`).
- `packages/memory-eval/src/signature.ts:22-25` (`errorLine`) picks the first line matching `ERROR_LIKE` (`fail` matches the header), and `GENERIC` at `:47` matches `validation failed`, so pi-schema output still classifies as generic. Verified no-op.
- No non-JSON-Schema TypeBox builder is used anywhere in `packages/**/*.ts`: `rg 'Type\.(Refine|BigInt|Undefined|Codec|Decode|Encode|Date|Uint8Array|Function|Symbol|Promise|Constructor|Void)\b|Format\.Set'` finds 0 hits.
- No `Type`/`Static`/`TSchema` import from `@earendil-works/pi-ai` or `@earendil-works/pi-coding-agent`: 0 hits. `packages/extension/src/ask-user-tool.ts:13` imports `Type` from `typebox`. `packages/extension/src/__tests__/ask-user-tool.test.ts:16-18` mocks `@earendil-works/pi-ai` `StringEnum`, which pi-ai 1.5 still exports (`dist/utils/string-enum.d.ts`).
- `ask-user-tool` "Schema rejection still fires for empty args" still holds: `- method: missing` names `method`.

## Settings (D4)

`diff` of `docs/settings.md` 1.3.0 → 1.5.0 (all changed rows):

| key | 1.3.0 | 1.5.0 |
|---|---|---|
| `compaction.reserveTokens` | "Tokens reserved for the model response." | "Free context tokens below which automatic compaction starts." |
| `terminal.clearOnShrink` | — | adds "When unset, `PI_CLEAR_ON_SHRINK=1` enables it." |
| `httpIdleTimeoutMs` | type `number`; "Set to `0` to disable." | type `` number \| `"disabled"` ``; "Set to `0` or `"disabled"` to disable." |
| `websocketConnectTimeoutMs` | same | same change |
| `selfUpdateCommand` | — | NEW `string[]`, default None; `pi update` runs it; `PI_SELF_UPDATE_COMMAND` wins; agent-directory settings only |
| `collapseChangelog` | — | adds "Also condenses extension package changelogs to one line per package." |

No default changed, so the parity test (`packages/server/src/__tests__/pi-settings-schema-parity.test.ts:92-100`, defaults only; `:56` already treats `\|` as an escaped pipe) stays green against 1.5 docs.

Runtime: `parseHttpIdleTimeoutMs` (`dist/core/http-dispatcher.js:15-29`) is identical in 1.3.0 and 1.5.0 and maps `"disabled"` (trimmed, case-insensitive) to `0`. pi 1.3.0's settings JSON schema already types and describes it (`dist/core/settings-schema.js:7-9`, `Type.Union([Type.Number({ minimum: 0 }), Type.Literal("disabled")])`; `:256-264`, `0 or "disabled" disables it`), as does 1.5.0. So the value was always honoured and described by pi. What is new is the `number | "disabled"` type column in `docs/settings.md`, so users will write it.

Repo:
- `checkInt` (`packages/shared/src/pi-settings-schema.ts:243-249`) rejects any non-number;
- the typed PATCH validates through it (`packages/server/src/pi-agent-settings.ts:96-98`);
- raw mode checks only `RAW_LEGACY_TYPED` (`:268-279`), which excludes both timeout keys, so a raw save of `"disabled"` already passes;
- the form maps a stored value with `toFormString` (`packages/client/src/components/settings/pi-settings-form.ts:45-55`) into a `type="number"` input (`PiSettingsRows.tsx:216-231`). A browser renders `"disabled"` there as empty, with the default as placeholder.

1.5.0 also adds the pi-written `extensionChangelogVersions` (record of string → string, global settings; `dist/core/settings-schema.js:142`, written by `dist/core/settings-manager.js:524-531`). It is not in `docs/settings.md`. The repo's read-only managed list is `DASHBOARD_MANAGED_KEYS` (`packages/client/src/components/settings/pi-settings-form.ts:171`: `dashboardPluginBridges`, `_dashboardManagedPackages`, `lastChangelogVersion`), rendered at `PiSettingsPage.tsx:801-812`. Adopted (design D4).

How an unlisted key shows today: Form mode renders only the rows in the typed schema and `pi-settings-form.ts`'s link/JSON row table (`npmCommand` at `:162` is a JSON-action row), plus the managed list, so `selfUpdateCommand` gets no Form-mode entry at all and is seen only in JSON mode. A typed PATCH naming it hits `checkLeaf` → `selfUpdateCommand is not a form field; use the JSON editor for this key` (`packages/server/src/pi-agent-settings.ts:90,95-97`).

`collapseChangelog` hint: `pi-settings-schema.ts:213` still says "Show a condensed changelog after an update"; it follows the 1.5 description (design D4).

`selfUpdateCommand`: the dashboard's own pi-core update runs `npm install -g <pkg>@latest` (`packages/server/src/pi/pi-core-updater.ts:4-5`), not `pi update`, so the key never affects a dashboard-triggered update.

## Windows shell (D5)

`diff` of `dist/utils/shell.js` 1.3.0 → 1.5.0, `isLegacyWslBashPath`. The change shipped in 1.4.0 (pi-coding-agent 1.4.0 `dist/utils/shell.js:8-12`, as is `shellPathExists`; changelog 1.4.0, #9501) and is unchanged in 1.5.0:

```diff
-    const normalized = path.replace(/\//g, "\\").toLowerCase();
+    const normalized = win32.normalize(path).toLowerCase();
+    const systemRoot = process.env.SystemRoot;
+    if (systemRoot) {
+        if (!/^[a-z]:[\\/]/i.test(systemRoot))
+            return false;
+        return ["System32", "Sysnative"].some((directory) => normalized === win32.join(systemRoot, directory, "bash.exe").toLowerCase());
+    }
+    // Fall back to conventional launcher paths only when the Windows directory is unknown.
     return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
```

Existence checks: `existsSync` becomes `shellPathExists` (`accessSync(path, F_OK)` in try/catch). The comment says it is "identical on Unix" and avoids `existsSync`'s extra stat that rejects runnable Store aliases (nodejs/node#36790). Resolution order in `getShellConfig()` is unchanged: `%ProgramFiles%\Git\bin\bash.exe` → `%ProgramFiles(x86)%\Git\bin\bash.exe` → `where bash.exe`. Other hunks (pwsh discovery, taskkill `||`, macOS SIGSTOP) don't touch bash resolution.

Repo: `packages/shared/src/platform/resolve-pi-shell.ts:6` ("Replica of pi-coding-agent 1.3.0"), `:38-42` (fixed regex), `:57` (`existsSync` default). Callers: `git-source.ts:195` (passes the spawn env) and `packages/electron/scripts/assert-bundled-bash-resolvable.mjs:130` (compares `.path` only).

## mcp.json BOM (D6)

`diff` of `dist/extensions/mcp/config.js` 1.3.0 → 1.5.0 (the whole diff):

```diff
+import { stripBom } from "../../utils/text.js";
-        parsed = JSON.parse(readFileSync(path, "utf8"));
+        parsed = JSON.parse(stripBom(readFileSync(path, "utf8")));
-    const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
+    const text = existsSync(path) ? stripBom(readFileSync(path, "utf8")) : undefined;
```

pi's `editMcpServers` writes `JSON.stringify(parsed, null, indent)` back without a BOM. Changelog 1.4.0: "Fixed `mcp.json` files that start with a UTF-8 BOM failing to parse … (#11191)".

`dist/core/mcp-servers.js` 1.3.0 → 1.5.0: `oauth.clientRegistration` accepts `"auto"` besides `"dcr"`/`"cimd"`, and a new `isClientMetadataDocumentCallback`. `packages/mcp-core/src/pi-rules.ts` `validateOAuth` (`:96-128`) checks no `clientRegistration` at all. It is more permissive, never rejects what pi accepts, and the writer emits no `oauth`, so this is a no-op.

Repo: `packages/mcp-core/src/layers.ts:47-61` `readLayer` calls `JSON.parse(raw)` directly. Its callers are the effective view (`effective-view.ts:139,168`) and the writer (`config-writer.ts:221,235,424,503,602,609`, which refuses to write an unparseable file). The Radius MCP offer (`packages/server/src/auth/radius-mcp.ts:108`) reports `layer.message`.

## minimatch (D8)

pi-coding-agent 1.5.0 depends on `minimatch` `11.0.3` and imports the named export (`dist/core/model-resolver.js:6`, used at `:268-269` with `{ nocase: true }`). The repo declares `^10.0.0` (`packages/shared/package.json:38`, `packages/extension/package.json:56`; hoisted `10.2.6`). Only caller: `packages/shared/src/enabled-models-match.ts:12-21` (namespace import, picks `.minimatch`). Checked on pi's installed copy (`…/pi-coding-agent/node_modules/minimatch`, `11.0.3`, engines `18 || 20 || >=22`, exports `.`): `typeof minimatch === "function"`, `default` undefined, so the namespace import still resolves. Adopted: both to `^11.0.3`.

## Verification runs

Filled in during apply:
- fixtures red → green;
- `pnpm install` plus the lockfile-derived `minimumReleaseAgeExclude`;
- `npm test`;
- `npm run build`;
- the docker-harness floor smoke (`pi-1-5-floor-smoke.spec.ts`);
- `qa/tests/01-install.sh`;
- the `rg '\b1\.3\.0\b'` sweep, with each surviving hit justified.

## `pi.exec` result field (pre-existing defect, D9)

`packages/extension/src/command-handler.ts:1578` (`handleBashCommand`, used by `!`, `!!` and slash-exec templates) calls `pi.exec(resolved.path, argv, { timeout: BASH_TIMEOUT })`. pi's `ExecResult` (`dist/core/exec.d.ts:23-31`, 1.3.0 and 1.5.0) is `{ stdout, stderr, code, killed, truncated }`; there is no `exitCode`. The bridge reads `exitCode = result.exitCode ?? 0` (`:1580`), and the local type `packages/extension/src/pi-env.d.ts:33` declares `exitCode`, so every nonzero exit has been forwarded as `0`. The `command-handler.test.ts` mocks (`:629,651,674,690,711,728,1065,1353,1439`) return `exitCode`, which hid it.

Changelog 1.5.0 (Fixed): `pi.exec()` no longer crashes with `RangeError: Invalid string length`. The default cap is the smaller of 256 MiB and the runtime string limit. Past the cap, the command is terminated and the result has `truncated: true` and a nonzero `code` (#11360). With the defect, such a run reaches the client as a truncated success. Adopted: read `result.code` (D9).

## Spec-collateral scan (`node scripts/spec-collateral.mjs --change update-pi-core-1-5-adopt-apis`)

Each top candidate was read against this change:

**T1 (capabilities outside the delta):**
- `provider-auth-server` "OAuth implementation is resolved from the pi runtime dependency" carried a stale `^1.0.0`. That drift predates this change. **MODIFIED here** to `^<piCompatibility.minimum>` (`^1.5.0`), so it can't drift again.
- `mid-turn-prompt-queue` "re-verified through pi 1.3.0" (`:17`, `:164`) is a historical anchor. It is still true on 1.5.0: `queue_update` and `clear*Queue` have 0 hits in 1.5.0 `dist/core/extensions/types.d.ts` and `runner.js`. Not modified.
- `electron-build-pipeline` "Win32 builds prove pi resolves the bundled bash" already speaks of `<SystemRoot>\System32\bash.exe` and compares paths only. Consistent.
- `ask-user-tool` "Schema imports use the typebox package" is still true, because pi's loader still aliases `typebox`.
- `bridge-extension` (multiselect / `ctx.ui.custom`): the new optional `blocked` field does not change it.
- `tool-registry`, `packaging`, `ci-cd-pipeline`, `workspace-publishing`, `mcp-client-folder-section` contain no pi version number and no trust-order or validator wording. Matched on identifiers only.
- Also checked by hand: `cross-scope-resource-disable` "An untrusted folder SHALL prompt…" already puts the recorded decision first. Its own-folder rule is **MODIFIED here** (doubt-review cycle 2): "recorded for the folder itself" is decided with pi's `pathsEqual`, because 1.5.0 `getEntry` returns the stored key spelling. Its "no `.pi` directory, which pi currently loads as trusted" assumes nothing is recorded, which is still true under 1.5.

**T2 (unmodified requirements in delta capabilities):**
- `pi-agent-settings-editor` "Raw replacement of the whole file": the timeout keys are not raw-checked, so `"disabled"` already passes. Consistent.
- "Model cycling scope editor", "Optimistic concurrency", "Filtering the settings page": unaffected.
- `pi-api-feature-detection`: the 1.2.0–1.3.0 and 0.87–1.0 audits are historical records. Not modified.
- `windows-git-bash-runtime` "Bundled shell is resolvable by pi as bash.exe" uses `<SystemRoot>\System32\bash.exe`, consistent with the modified classification.
- `pi-trust-mirror` "The Access page discloses pi trust…" lists sources generically. Consistent.
- `pi-core-version-check` "/api/health surfaces pi-version compatibility" and "PiVersionAdvisory…" name no version number. Unaffected.
- Re-run after the `provider-auth-server` delta: the new T1/T2 hits are `package-install` "The queue carries no package-manager knowledge" (identifier match only) and the `provider-auth-server` registry requirements ("Legacy Azure provider id…", "API key provider registry", "OAuth provider registry"). Their "on pi 1.0.0" wording is a historical anchor. **Correction:** the pi-ai OAuth modules are NOT unchanged. The file list differs only by the new `auth/oauth/trusted-url.js`, but the contents of `auth/oauth/github-copilot.js`, `kimi-coding.js`, `meta.js` and `radius.js` changed: each now imports the shared `trustedHttpUrl`, and `radius.js` additionally validates `authorizationEndpoint` and `verification_uri` with it. `auth/types.d.ts:144-147` adds optional `device_code.openBrowserOnConfirm` / `copyCodeOnConfirm` ("clients may ignore it"). The dashboard mirrors the event in `packages/server/src/auth/pi-oauth-types.ts:53-59` (without the two fields) and `applyDeviceCode` (`packages/server/src/auth/provider-auth-adapter.ts:221-228`) copies only `userCode`, `verificationUri`, `intervalSeconds`, `expiresInSeconds`, so the extra fields are ignored and the device-code flow is unaffected. Recorded as audited, not consumed. The registry requirements' "on pi 1.0.0" wording stays a historical anchor; not modified.
