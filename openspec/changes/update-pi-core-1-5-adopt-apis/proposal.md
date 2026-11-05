## Why

pi 1.5.0 is the latest release (2026-11-02). The repo pins, type-checks and tests against `1.3.0` (`pnpm-workspace.yaml:63-65`, `packages/server/package.json:19-20,78`, `docker/Dockerfile:116`), and the lockstep policy (`pi-core-version-check`) moves the floor with the pin. The user's global pi is already 1.5.0, so the dashboard spawns 1.5.0 sessions while the repo and its tests type-check against 1.3.0 (`/api/health` `.piRuntime.installSetDiverged: true`, versions `[1.3.0, 1.5.0]`).

Between 1.3.0 and 1.5.0 pi changed six things the dashboard mirrors or depends on:

- **Project trust precedence (1.5.0).** For a folder with no trust-requiring project resources, pi now returns the nearest recorded `trust.json` entry before falling back to implicit trust (`dist/core/project-trust.js:22-23`). The dashboard's shared trust decision still implements the 1.3 order, so it reports "trusted (implicit)" for a folder that pi refuses.
- **Tool-argument validation moved to `@earendil-works/pi-schema` (1.5.0, breaking).** pi-ai validates tool arguments with `compile(schema, { coerce: true })`. A `null` optional value is dropped, a single value is wrapped into an array, and error lines now read `- <path>: <message>` in pi-schema's wording. One repo test still asserts the old TypeBox semantics and claims to be "the same validator pi uses".
- **Two settings are documented as accepting `"disabled"` (1.5.0 docs).** `httpIdleTimeoutMs` and `websocketConnectTimeoutMs` are now documented and typed as `number | "disabled"`. pi's runtime parser (`parseHttpIdleTimeoutMs`, identical in 1.3.0) has accepted the string, trimmed and case-insensitive, since 1.3.0 or earlier, and pi 1.3.0's settings JSON schema already typed and described it (`dist/core/settings-schema.js:7-9,256-264`). What is new is the `number | "disabled"` type column in `docs/settings.md`, so users will write it. The typed PATCH rejects the string.
- **The Windows WSL-launcher check honours `SystemRoot` (1.4.0; `dist/utils/shell.js:8-12`, unchanged in 1.5.0).** The dashboard's `getShellConfig()` replica still uses the fixed `<drive>:\Windows\…` pattern.
- **`mcp.json` with a UTF-8 BOM is readable (1.4.0, #11191).** pi strips the BOM. The dashboard's layer reader reports such a file as unparseable and skipped.
- **Trust paths compare with `pathsEqual` (1.5.0, #10488).** pi matches `trust.json` keys with `pathsEqual` (`trust-manager.js:22-35`): both paths are resolved (`utils/paths.js:31-35`), and on Windows compared case-insensitively. `getEntry` now returns the stored key spelling (`trust-manager.js:28-31`; 1.3.0 returned the walked folder), and the user's `~/.agents/skills` is excluded with `pathsEqual` (`trust-manager.js:167`). The bridge's own lockless read (`nearestRecordedEntry`, `packages/shared/src/pi-trust-mirror-snapshot.ts:104-112`) still matches keys exactly. For a folder with trust-requiring resources pi 1.5 applies an extension `project_trust` answer before the recorded entry (`project-trust.js:25-41`), so a refusal saved with different casing on Windows, or under a non-normalised key such as `/r/` on any platform, is missed by the bridge, and the bridge's yes overrides pi's refusal. The server's resource-toggle gate (`packages/server/src/pi/resource-toggle-trust.ts:131`) compares the returned path with the cwd without case-folding, so on Windows an own-folder refusal saved with different casing now reads as inherited and prompts, which lets the user override a refusal that should be final. The trust-resource digest (`packages/shared/src/pi-trust-resource-digest.ts:215`) excludes the user's skills with `!==`.

The 1.5 audit also surfaced a pre-existing bridge defect. pi's `ExecResult` (1.3.0 and 1.5.0, `dist/core/exec.d.ts:23-31`) is `{ stdout, stderr, code, killed, truncated }`, with no `exitCode`. The `!`/`!!`/slash-exec path reads `result.exitCode ?? 0` (`packages/extension/src/command-handler.ts:1580`, typed by the local `packages/extension/src/pi-env.d.ts:33`), so every nonzero exit is forwarded as `0`. With 1.5, a run over pi's output cap (`truncated: true`, nonzero `code`) is forwarded as a truncated success.

## What Changes

### Pin bump + floor (atomic)
- Pin `@earendil-works/pi-coding-agent`, `pi-ai` and `pi-tui` to `1.5.0` on every governed surface:
  - the server dependency (`^1.5.0`) and `piCompatibility.minimum`/`recommended` (`1.5.0`);
  - the root `package.json` peers (`>=1.5.0`) and the pi-ai devDependency (`^1.5.0`);
  - every `packages/*/package.json` pi peer (`>=1.5.0`, still optional) and pi devDependency (`^1.5.0`). The `rg` sweep is the list. `packages/extension` gains an `@earendil-works/pi-ai` `^1.5.0` devDependency, because the new validator test imports pi-ai and the package declares it only as an optional peer;
  - `docker/Dockerfile` (and its `Dockerfile.AGENTS.md` row), plus the two `npm i -g …@1.3.0` steps in `.github/workflows/ci-e2e-browser.yml:504,563`, which `e2e-browser-workflow-contract.test.ts` (E3) requires to equal the Dockerfile pin;
  - `scripts/verify-release-deps.mjs` `minVersion` (and its `.AGENTS.md` sidecar);
  - the `pnpm-workspace.yaml` `overrides`;
  - `minimumReleaseAgeExclude`, derived from the lockfile after `pnpm install`. It gains the new transitive `@earendil-works/pi-schema@1.5.0`.
- Pin-encoding fixtures move first (TDD): `pi-version-skew.test.ts`, `pi-version-update-handling.test.ts` (X3), `bundled-node-meets-pi-floor.test.ts` (new `1.5.0` row, Node 22.19) and `verify-release-deps-pi-coherence.test.mjs`. The floor-encoding smoke tests move with them: `tests/e2e/pi-1-3-floor-smoke.spec.ts` is renamed to `pi-1-5-floor-smoke.spec.ts` (`FLOOR`), and `qa/tests/01-install.sh` (`PI_FLOOR`) changes.
- **BREAKING (publishable peers):** every `@earendil-works` pi peer becomes `>=1.5.0` (optional, no upper bound), and pi devDependencies become `^1.5.0`.
- Dependency delta, verified from manifests:
  - pi-ai and pi-agent-core drop `typebox` and add `@earendil-works/pi-schema` `1.5.0`;
  - pi-tui adds `marked-cjk-friendly`;
  - pi-coding-agent keeps `typebox` `1.3.27`; minimatch moves 10 → 11 and undici 8.10 → 8.12. The repo's own `minimatch` (`packages/shared`, `packages/extension`, `^10.0.0`) follows to `^11.0.3` (see Adopted).
  - `exports` maps and Node engines (`>=22.19.0`) are unchanged.
- **Not a pin surface:** `PLUGIN_HOST_API_VERSION = "1.3.0"` (`packages/shared/src/dashboard-plugin/host-api.ts`) is the dashboard's own plugin host API version. The match with pi's version is a coincidence, so it stays. Several in-flight changes mention pi 1.3.0 (`context-manager-*`, `add-plugin-connector-kit`, `add-supervised-tool-approval`, `add-vault-reach-all-projects`). This change doesn't edit them; they rebase onto the new floor when they land.

### Adopted
- **Trust decision order follows pi 1.5.** In `decidePiTrust` (`packages/shared/src/pi-trust-mirror.ts:259-276`), pi's nearest recorded entry (true or false) decides first, whether or not the folder has trust-requiring project resources. If nothing is recorded, a folder with no such resources is implicitly trusted. Dashboard trust and `defaultProjectTrust` then apply only to folders that have trust-requiring resources. The server's host predicate (`packages/server/src/pi/host-project-trust.ts:68,75`) reads the recorded entry unconditionally. Today it skips the read when the folder has no trust-requiring resources.
- **Validator test drives pi's validator.** `typebox-nullable-array-validation.test.ts` is replaced by a test that calls pi-ai's exported `validateToolArguments` on the `ask_user` optional-array shape and asserts the 1.5 semantics. Fixtures that quote validator wording (`parse-ctx-result.fixtures.ts` `err_validation` and its assertions) are refreshed to pi-schema wording. The `Validation failed for tool "<name>":` prefix is unchanged, so no parser changes.
- **`"disabled"` timeouts.** The typed PATCH accepts exactly `"disabled"`, the canonical spelling the dashboard writes, for `httpIdleTimeoutMs` and `websocketConnectTimeoutMs`. The form shows any stored value pi parses as disabled (`"disabled"`, trimmed and case-insensitive) as `0`, since both disable the timeout, and doesn't rewrite it unless the user edits the row. Other stored strings stay as stored and don't block saving other rows (only changed rows go into the patch). The `compaction.reserveTokens` hint follows pi's new description.
- **WSL-launcher detection honours `SystemRoot`.** The replica's `isWslLauncherBash` takes the spawn env: with `SystemRoot` set, only `<SystemRoot>\System32\bash.exe` and `<SystemRoot>\Sysnative\bash.exe` count as the launcher, and a `SystemRoot` that is not drive-absolute means "not the launcher". The fixed `<drive>:\Windows\…` pattern is only the fallback when `SystemRoot` is unset. The replica's default existence check becomes `accessSync(F_OK)`, like pi's `shellPathExists`, and its header names 1.5.0.
- **BOM-tolerant `mcp.json` reads.** `readLayer` (`packages/mcp-core/src/layers.ts:47-61`) strips one leading U+FEFF before `JSON.parse`, as pi does. This covers the MCP page, the config writer's pre-write read and the Radius MCP offer, which all read through `readLayer`. The two plugin registrars that read `mcp.json` directly, `packages/blender/src/mcp-register.ts:75` and `packages/craft-apps/src/mcp-register.ts:82`, strip it the same way inline.
- **`!`/slash-exec exit status from `ExecResult.code`.** `handleBashCommand` reads `result.code` (`command-handler.ts:1580`), so `bash_output.exitCode` carries pi's exit status, nonzero for a failed or over-cap run. `pi-env.d.ts:33` types `exec` with pi's result shape, and the `command-handler.test.ts` mocks use `code`.
- **Trust paths compare as pi's `pathsEqual` does, everywhere.** A shared helper mirrors pi's `getPathComparisonKey` (`path.win32.resolve(p).toLowerCase()` on win32, `path.posix.resolve(p)` elsewhere), with the path module injectable so the Windows branch is testable on any host. It has three users:
  - the bridge's `nearestRecordedEntry` matches every trust-file key with it on every platform, so `piStoreBlocks` (`packages/extension/src/project-trust.ts:152-157`) withholds its yes for a case-different (Windows) or non-normalised (`/r/`) refusal, as pi's order requires;
  - the resource-toggle gate (`packages/server/src/pi/resource-toggle-trust.ts:131`) decides "recorded for this folder itself" with it, so a Windows own-folder refusal saved with different casing still refuses instead of prompting;
  - the trust-resource digest (`packages/shared/src/pi-trust-resource-digest.ts:215`) excludes the user's `~/.agents/skills` with it, as pi does.
  The host predicate needs no change: it reads through pi's own `ProjectTrustStore.getEntry` (`packages/server/src/pi/host-project-trust.ts:158-166`), which uses `pathsEqual`.
- **`minimatch` `^11.0.3` in lockstep with pi.** `packages/shared/src/enabled-models-match.ts` mirrors pi's `resolveModelScope` (`model-resolver.js:268-269`, minimatch 11.0.3). `packages/shared` and `packages/extension` move from `^10.0.0` to `^11.0.3`. The repo calls only the named `minimatch(target, pattern, { nocase: true })`, which minimatch 11 still exports.
- **Settings page catches up with pi-written keys.** `extensionChangelogVersions` (pi-written, global settings) joins the read-only managed list, and the `collapseChangelog` hint follows pi's new description.

### Audited, deliberately NOT consumed
`Usage.cost.totalFromProvider`; `AssistantMessage.responseModel`; `pi.changelogPath` and extension changelogs; `pi.exec({ maxBuffer })` (the bridge keeps pi's default cap, the smaller of 256 MiB and the string limit); `ExecResult.truncated` / `killed` (not surfaced separately: with the exit-status fix an over-cap run is already reported as failed); `ctx.ui.custom({ blocked })` (no repo caller); the OAuth `device_code` event's `openBrowserOnConfirm` / `copyCodeOnConfirm` (pi: clients may ignore them; the dashboard copies only the fields it uses); `keyText`/`keyHint`; `MarkdownTransformContext` `messageId`/`timestamp`; `selfUpdateCommand` (stays JSON-only, see design D7); MCP OAuth `clientRegistration: "auto"` / CIMD default; pi-ai no longer re-exporting TypeBox. The repo imports no `Type`/`Static`/`TSchema` from pi-ai or pi-coding-agent; extensions import `typebox`, which pi's loader remaps.

### Documented no-ops
- **Fixed or changed inside pi, no dashboard code:**
  - OpenRouter cost totals are now billed values (`usage-totals` sums `cost.total`; numbers shift);
  - compaction trigger semantics;
  - extension tools default-active on resume;
  - `setActiveTools` ordering;
  - provider and model catalogue changes (the repo hard-codes no model ids);
  - `/tree` summary and terminal-title escape fixes;
  - `pi install`/`remove` symlink handling and npm audit output;
  - the pi-ai OAuth provider modules (`github-copilot`, `kimi-coding`, `meta`, `radius`), whose URL checks moved to a shared `trustedHttpUrl` helper inside pi.
- **TUI only:** keybinding hints, Apple Terminal Shift+Enter, Rex OSC sequences.
- **Not used by the dashboard:** the removed `examples/extensions/sandbox/` (referenced only by research prose).
- **Mirror needs no change:** pi's MCP entry-rule change (`oauth.clientRegistration` accepts `"auto"`). `packages/mcp-core/src/pi-rules.ts` never validated `clientRegistration`, and the writer never writes `oauth`.

### Out of scope
- A typed form row for `selfUpdateCommand`.
- Deriving `pi-settings-schema.ts` from pi's JSON Schema (still deferred, as in the 1.3 change).
- Refreshing the `pi 1.1.0` comments in `pi-rules.ts`.
- Editing in-flight changes that mention 1.3.0.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-core-version-check`: pins, floor, peers and examples move to `1.5.0`. The extension `typebox` devDependency's rationale is restated, because tool arguments are no longer validated by TypeBox.
- `pi-trust-mirror`: a recorded entry decides before implicit trust, and trust-file keys match as pi's `pathsEqual` does (resolved on every platform, case-insensitive on Windows); the remote-trust digest excludes the user's own `.agents/skills` by the same comparison.
- `cross-scope-resource-disable`: "An untrusted folder SHALL prompt…" decides whether a refusal is recorded for the folder itself with pi's `pathsEqual`, because pi 1.5 returns the stored key spelling; a Windows own-folder refusal saved with different casing still refuses.
- `pi-agent-settings-editor`: `"disabled"` is accepted for the two timeout keys, and the form shows it as `0`; `extensionChangelogVersions` joins the read-only managed list.
- `windows-git-bash-runtime`: WSL-launcher detection is `SystemRoot`-aware.
- `mcp-client-config`: layer reads strip a leading BOM.
- `bash-execution`: `bash_output.exitCode` is the `code` of pi's `pi.exec` result, so a nonzero or over-cap run is never forwarded as `0` (pre-existing defect).
- `pi-api-feature-detection`: records the 1.4.0–1.5.0 audit (adopted, not consumed, no-ops).
- `provider-auth-server`: "OAuth implementation is resolved from the pi runtime dependency" carries a stale `^1.0.0` server pin. It is restated as `^<piCompatibility.minimum>`, which corrects pre-existing drift in the same governed pin set (found by the spec-collateral scan).

## Impact

- **Pins:** `packages/server/package.json`, root and `packages/*/package.json` peers and devDependencies, `pnpm-workspace.yaml`, `docker/Dockerfile` (+ `Dockerfile.AGENTS.md`), `.github/workflows/ci-e2e-browser.yml`, `scripts/verify-release-deps.mjs` (+ sidecar), plus `pnpm install` (lockfile).
- **Code:**
  - `packages/shared/src/pi-trust-mirror.ts` (`decidePiTrust` order);
  - `packages/server/src/pi/host-project-trust.ts` (unconditional recorded read);
  - `packages/shared/src/pi-settings-schema.ts` (disabled-literal flag, `checkInt`, hint);
  - `packages/client/src/components/settings/pi-settings-form.ts` (`toForm` display);
  - `packages/shared/src/platform/resolve-pi-shell.ts` (`isWslLauncherBash(p, env)`, existence check);
  - `packages/mcp-core/src/layers.ts`, `packages/blender/src/mcp-register.ts` and `packages/craft-apps/src/mcp-register.ts` (BOM strip);
  - `packages/extension/src/command-handler.ts` (`result.code`) and `packages/extension/src/pi-env.d.ts` (`exec` result typed as pi's `ExecResult`);
  - a new shared `pathsEqual` helper (`packages/shared/src/pi-path-compare.ts`), used by `packages/shared/src/pi-trust-mirror-snapshot.ts` (`nearestRecordedEntry` key match), `packages/server/src/pi/resource-toggle-trust.ts` (own-folder check) and `packages/shared/src/pi-trust-resource-digest.ts` (user-skills exclusion); `ancestorKeys` in `pi-trust-mirror.ts` takes the path module;
  - `packages/client/src/components/settings/pi-settings-form.ts` (`DASHBOARD_MANAGED_KEYS`) and the `collapseChangelog` hint in `pi-settings-schema.ts`;
  - `minimatch` `^11.0.3` in `packages/shared/package.json` and `packages/extension/package.json`, plus an extension `@earendil-works/pi-ai` devDependency.
- **Tests:** pin fixtures, `pi-trust-mirror.test.ts:165-167` (old order), the validator test replacement, the ctx-result fixtures, settings PATCH/form tests, `resolve-pi-shell.test.ts`, an `mcp-core` layer test, the blender and craft-apps `mcp-register` BOM tests, the `command-handler` exit-status tests and mocks, helper and trust-key match tests (win32 casing with `path.win32` injected, posix non-normalised keys), a win32 own-folder refusal test for the toggle gate, a digest user-skills exclusion case, the `selfUpdateCommand` PATCH/form test, and the existing `enabledModels` matcher tests on minimatch 11.
- **Docs (DocScribe):** floor mentions in `docs/architecture.md` (`:616`, `:1918-1926`, `:2303`, `:6487`), `docs/faq.md` (`:1989`, `:1993`), `docs/security/deployment-process-supply-chain.md` (`:137-138`) and `README.md` (if any); task 1.6's sweep output is the full list.
- **`CHANGELOG.md` `[Unreleased]`:** the floor raise (breaking for below-floor pi) and the trust-precedence and trust-path (`pathsEqual`) alignment, and the `!`/slash-exec exit-status fix.
- **Rollback:** revert the commit and run `pnpm install`. Persisted formats don't change (`trust.json`, `settings.json` and `mcp.json` are read the same way or more leniently).

## Discipline Skills

- `doubt-driven-review`: the floor raise is a public, irreversible-for-users step (a publishable peer range), and the trust-order change alters an authorization decision.
- `security-hardening`: trust precedence decides whether project resources (`.pi/mcp.json`, settings, extensions) count as active, and the change must not widen trust. It narrows trust. A recorded refusal now wins for folders without trust-requiring resources (for example an `AGENTS.md`-only folder), which changes what `host.isProjectTrusted` / `host.projectTrustSource` report. The MCP project layer is not on that path, because `.pi/mcp.json` is itself a trust-requiring resource (`trust-manager.js:8-17`). The bridge also stops overriding a refusal saved with different casing (Windows) or under a non-normalised key, and the toggle gate stops offering a prompt that could override a Windows own-folder refusal saved with different casing. The `selfUpdateCommand` non-adoption is not a security measure (the typed form already writes `shellPath` and `shellCommandPrefix`); its reasons are in design D7.
- `systematic-debugging`: not triggered. The evidence was gathered by diffing the unpacked 1.3.0/1.5.0 tarballs and running pi 1.5's validator (`evidence.md`). The one defect found (`exitCode` vs pi's `code`) has its root cause read from `exec.d.ts`, and is fixed test-first.
