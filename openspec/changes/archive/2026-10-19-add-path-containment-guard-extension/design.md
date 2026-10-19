## Context

See proposal.md (Why, and the decision for outcome 1). Requirements are in `specs/path-containment-guard/spec.md`.

Current state that shapes the approach:

- **`packages/extension/src/path-gate/resolve.ts`** holds the pi-parity resolver:
  - `resolveToolPath`, which mirrors pi's `resolveToCwd`;
  - `resolveReadTarget`, which mirrors `resolveReadPath`'s variant fallback;
  - `canonicalizeTarget`, which real-paths the nearest existing ancestor and re-appends the tail.

  All of them take an injectable `ResolveEnv`. The resolver is parity-tested against pi's own helpers in `path-gate/__tests__/decide.test.ts`.
- **`path-gate/decide.ts`** holds the component-wise containment, a private `isWithin` + `fold` (NFC, with case folding only when needed), and the volume probe `defaultVolumeProbe`, which wraps `volumeCaseInsensitive` from `packages/shared/src/canonical-subject.ts`. The probe is mixed with gate-only concerns: `GateRoots` sets, sensitivity, grant subject and option building.
- **Other implementations.** `team-plugin/src/extension/guard.ts` and `chat-gateway/src/guard/` are separate guards. Only team-plugin does path containment, with its own weaker `canonicalize`/`inside`: it refuses `~`, never folds case, and does not mirror the read-variant fallback. A follow-up will migrate it, as listed in the proposal's non-goals.
- **pi tool arguments.** pi's `grep`/`find`/`ls` take an optional `path` and resolve `searchDir || "."` via `resolveToCwd`. None of them follow symlinks below the search root (rg/fd defaults). pi blocks a tool when a `tool_call` handler returns `{ block: true, reason }` or throws. Nested `ctx.executeTool` calls go through `tool_call` too.
- **`extensionConfig` arrays.** These reach the spawned process as `PI_EXT_<NAME>_<KEY>` holding the JSON-encoded array (`plugin-spawn-scope`). The mapper drops an array entry when no valid elements remain, so `allowedRoots: []` arrives as an absent variable.

## Goals / Non-Goals

**Goals:**
- One shared copy of the pi-parity path resolution and containment rules, used by both path-gate and the guard.
- A guard whose hot path is pure and synchronous: no server round trip and no prompt machinery.
- Standalone tests: the guard package is tested without the bridge, path-gate or a dashboard.

**Non-Goals:**
- Changing what path-gate decides, apart from the dangling-symlink fix (D6). The extraction is otherwise a pure move, and existing path-gate tests SHALL pass unmodified.
- Write-vs-read distinctions inside the allowed roots. Every allowed root is read+write; a plugin wanting read-only confinement denies `write`/`edit` instead.
- Live config reload. Config is read once, at load.

## Decisions

### D1 — Extract to `packages/shared/src/tool-path-resolve.ts`; keep `path-gate/resolve.ts` as a re-export

**What moves:**
- `ResolveEnv`, `defaultResolveEnv`, `resolveToolPath`, `resolveReadTarget` and `canonicalizeTarget`, moved verbatim.
- A new exported `isPathWithinRoots(canonical, roots, { env, caseInsensitive?, volumeCaseProbe? })`. It is built from decide.ts's `isWithin` + `fold` + `defaultVolumeProbe`, keeping the same exact-match-first / probe-only-on-miss order. It also exports a narrower `isWithinRoot(canonical, root, env, ci)`, which decide.ts still needs for the sensitivity check.

**What stays:**
- `path-gate/resolve.ts` becomes `export * from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js"`, so the import sites and the parity tests in `decide.test.ts` stay untouched. Those tests are the behaviour-preservation proof.
- `decide.ts` keeps all gate-only logic and calls the shared containment.

**Alternatives considered:**
- (a) Reuse the existing `shared/src/path-containment.ts` `isPathInside`. Rejected: it folds case from the platform (`platform !== "linux"`, `packages/shared/src/path-containment.ts:36`) rather than probing the volume, and it does no NFC normalisation. Swapping it in would change path-gate behaviour on case-sensitive APFS. It is boundary-correct, so this is not a prefix bug.
- (b) Put the guard inside `packages/extension` and import `path-gate/resolve.ts` in place. Rejected by the operator in favour of a standalone, reusable package.

### D2 — Standalone package `packages/path-containment-guard`, loaded only by `-e`

**Package:**
- Published as `@blackbelt-technology/pi-path-containment-guard`, with `publishConfig.access: public` and a README.
- Depends on `@blackbelt-technology/pi-dashboard-shared` (for D1). Peer dependency `@earendil-works/pi-coding-agent` (optional), as in `untrusted-content-guard`.

**Deliberately no `pi.extensions` manifest entry.** A user who ran `pi install` on the package would otherwise load it in every session. With no env config it then fails closed and blocks every path tool everywhere. Loading is explicit only, through `-e <entry>` or a `scope.extensions` path.

**Exports:**
- `"."` → `src/scope.ts`, the pure helper (D5), with no pi import.
- `"./extension"` → `src/extension.ts`, the pi entry.

**Not a dashboard plugin.** It is not added to `BUNDLED_PLUGINS`, the client registry or `index.css`. It is added to the `publish.yml` PACKAGES list after `pi-dashboard-shared`, to the root `vitest.config.ts` projects, and to `knip.json`.

**Alternative considered:** shipping it as a pi package with `pi.extensions` plus an "inactive unless configured" mode. Rejected: "no config ⇒ allow" is fail-open, and the spec requires fail-closed when the guard is loaded.

### D3 — Module split inside the package

| File | Role |
|---|---|
| `src/config.ts` | `parseGuardConfig(env)` → `{ ok: true, roots: string[] (canonical), deniedTools: Set<string> } \| { ok: false, scope: "path" \| "all" }`. Pure apart from canonicalising the roots once. An unusable `ALLOWED_ROOTS` gives `scope: "path"`, so only path tools are blocked. An unparseable or non-array `DENIED_TOOLS`, or one with any entry that is not a non-empty string, gives `scope: "all"`, so every tool is blocked. Invalid root entries are dropped (fewer roots fails closed). The root predicate `isAcceptableRoot(p, platform)` is exported for `scope.ts` (D5). An invalid denied-tools entry cannot be dropped safely, because dropping it would lose an intended denial. |
| `src/decide.ts` | `decideGuard(toolName, input, cwd, config, env?)` → `{ allow: true } \| { allow: false, code, tool, canonical? }`. Pure, with an injectable `ResolveEnv`. Order: config-all-invalid → denied tool → not a path tool (allow) → config-path-invalid → argument validation → resolve (read-variant for `read`) → canonicalise → `isPathWithinRoots`. |
| `src/extension.ts` | The pi factory, which is **total**. It parses the config inside try/catch: a root whose canonicalisation throws is dropped in `config.ts`, and any other throw becomes a block-all `config_invalid` config. It always registers exactly one `tool_call` handler. This matters because pi drops an extension whose factory throws (`dist/core/extensions/loader.js:511-538`). At startup that exits pi (`dist/main.js:745-753`), but `AgentSession.reload` (`dist/core/agent-session.js:2969`) continues without the extension, which would be fail-open. That handler wraps `decideGuard` in try/catch (a throw becomes code `error`), returns `{ block: true, reason }`, and writes one `[path-containment-guard] <code> tool=… path=…` line to stderr per rejection, escaping control characters, U+2028 and U+2029 in every dynamic field (as path-gate does, `packages/extension/src/path-gate/handler.ts:100-102`). |
| `src/scope.ts` | `withPathContainmentGuard()` (D5). |

`cwd` comes from the handler's `ctx.cwd`, falling back to `process.cwd()`. The path argument key is `path` for all six tools (verified against pi `dist/core/tools/*.js`).

### D4 — Block reason format

The reason is `<code>[: <tool>[ <canonical>]][ — allowed roots: <r1>, <r2>…]`. The roots suffix appears only for `path_outside_roots`; each part after the code appears only where it applies. For example: `path_outside_roots: read /w/other/x.txt — allowed roots: /w/repo`.

Naming the allowed roots in the reason lets the model correct itself instead of retrying blindly. The roots are not secret: the spawning plugin chose them for this session. The code prefix is the stable, testable contract, and the rest of the message is free text.

### D5 — Spawn-scope helper derives the entry path from its own module URL

`withPathContainmentGuard(opts, base?)` returns `base` merged with the guard: `extensions` concatenated, the `extensionConfig` entry added, and a throw if one already exists. A merging helper, rather than a bare fragment, means a plugin with its own `extensions`/`extensionConfig` (team does this, `packages/team-plugin/src/server/conversations.ts:598-599`) cannot lose `-e <guard>` through a shallow spread. With no `base`, it returns:

```
{ extensions: [fileURLToPath(new URL("./extension.ts", import.meta.url))],
  extensionConfig: { "path-containment-guard": { allowedRoots, ...(deniedTools && { deniedTools }) } }
}
```

The extension name is the single shared constant `PATH_CONTAINMENT_GUARD_EXT_NAME` (D7), which the `config.ts` env names are also derived from. That makes a namespace typo impossible on either side. The helper's only validation is to throw when no root is a non-empty absolute path (D7). Everything else is left to the spawn mapper's sanitisation and the guard's fail-closed parsing.

The package ships `src/*.ts`, and pi loads extensions through jiti, so a `.ts` entry path is valid for `-e`, as for team-plugin's `guardExtensionPath` (`packages/team-plugin/src/server/index.ts:33`).

`import.meta.url` MUST stay uncast. A bare `import.meta.url` is an erasable shape, which jiti inlines. A TypeScript cast around `import.meta` defeats that erasure and forces jiti's native-ESM `data:` fallback (`openspec/specs/jiti-cjs-transpile-safety/spec.md`).

### D6 — The shared canonicaliser follows dangling symlinks

Today `canonicalizeTarget` (`packages/extension/src/path-gate/resolve.ts:111-125`) treats every `realpathSync` failure as "missing" and re-appends the name. pi's `write` follows a dangling link and creates its target, an escape reproduced during doubt-review.

**New algorithm**, run when `realpath(cur)` fails:
1. `lstat(cur)`.
2. If `cur` is a symbolic link, `readlink` it and resolve the link text **component by component**. Relative text starts from `realpath(dirname(cur))`; absolute text starts from its own root (`path.parse(text).root`, which is the drive or UNC root on win32). That realpath fails only on an ancestor loop or a permission error, and that then fails closed as `error`. On win32, the link text is split on both `/` and `\\`. For each component:
   - `..` → take the parent of the already-real prefix;
   - `.` → skip it;
   - otherwise append it, and when the result exists, real-path it (a symlinked intermediate directory is followed).

   Then re-append the pending tail and restart canonicalisation on the result. A lexical `path.resolve(dirname(cur), linkText)` would be wrong: it collapses `..` as text, while the kernel resolves it from the real parent. That is a bypass under a symlinked directory, which the review found.
3. Otherwise, keep walking up as today.

A hop counter (limit 40, matching common `SYMLOOP_MAX`) is shared across restarts within one canonicalisation, and throws when exceeded. A throw makes the guard reject with `error`, and makes path-gate block as `error` (an existing fail-closed outcome).

The lexical input path itself keeps today's treatment. pi resolves it with `path.resolve` before opening, so the kernel never sees its `..` (`resolveToolPath` parity).

`ResolveEnv` gains **optional** `isSymlink?(p)` and `readlink?(p)`. `defaultResolveEnv` supplies `fs.lstatSync(p).isSymbolicLink()` (false when missing) and `fs.readlinkSync`, and an absent field counts as "not a symlink". The existing `ResolveEnv` literals in `path-gate/__tests__/decide.test.ts:11-22,224-232` and `handler.test.ts:9-19` then still type-check and behave as before.

On Windows, `readlink` may return `\\?\`-prefixed text. This is not normalised: it canonicalises to a path no root contains, so it fails closed. It is noted in the README.

This is the one deliberate behaviour change to path-gate; the MODIFIED `agent-path-confinement` delta covers it. Rejected alternative: a guard-only fix, which would leave path-gate open and fork the resolver (operator choice).

### D7 — A spawn owns the env namespace of each extension it configures

`buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts:295,433-449`) copies the host env and projects `extensionConfig` on top, never removing inherited `PI_EXT_*`. The mapper drops an array entry with no valid elements but keeps the extension name with an empty record (`packages/dashboard-plugin-runtime/src/server/server-context.ts:492-520`). An inherited `PI_EXT_<NAME>_<KEY>` therefore survives whenever the plugin's own key was dropped or omitted.

**Changes in `buildSpawnEnv`:**
1. Move the `extensionConfig` block after the `applySpawnEnvContributors` call (today it runs before it, `process-manager.ts:433-453`). Contributors fill only absent names (`spawn-env-contributors.ts:141-156`), so before this move they could re-fill a stripped key.
2. Then delete every env key under `PI_EXT_<normName>_`, for all configured names, before projecting any of them. Stripping inside the per-name projection loop would let one name's strip delete another name's freshly projected vars when the prefixes nest, for example `path-containment` vs `path-containment-guard`.
3. Unconditionally delete every `PI_EXT_PATH_CONTAINMENT_GUARD_*` key, also before projection (operator choice A). The guarantee is headless-only: a tmux pane inherits the tmux server env (`process-manager.ts:606-638`), and plugin spawns are headless-only. Guard config can then only come from the spawn's own `extensionConfig`, even when a plugin loads the guard without config.
4. Delete every removed name from `contributedOut` too, so the tmux `-e` emission never re-adds it.

The guard's extension name lives in shared as `PATH_CONTAINMENT_GUARD_EXT_NAME`, in a new tiny module `packages/shared/src/path-containment-guard-name.ts`. The guard and the server both import it, so the server never depends on the guard package.

**Why only configured names, not all `PI_EXT_*`:** operator- or contributor-supplied `PI_EXT_*` for unconfigured extensions keeps working.

**Existing spawns that name an extension**, and so newly own its namespace:
- `pi-dashboard`: goal-plugin, `packages/goal-plugin/src/server/index.ts:109`; automation-plugin, `packages/automation-plugin/src/server/engine.ts:788`. Both set `askUserPromptTimeoutSeconds` themselves, which ask-user-tool documents as a per-spawn override.
- `team`: `packages/team-plugin/src/server/conversations.ts:599`.
- `chat-gateway-guard`: `packages/chat-gateway/src/server/gateway.ts:653`.

Task 4.3 confirms that none of them relies on inherited keys merging in.

The helper validates with the guard's own exported root predicate (`config.ts`), and also rejects malformed `deniedTools` entries, so a plugin's mistake surfaces at spawn time.

**Dropped `deniedTools` elements.** The mapper silently drops non-string and NUL-bearing elements, and drops the key once none survive (`server-context.ts:492-520`). The guard then sees fewer denials, or none. This is accepted: a dropped element can never equal a tool name, so its removal cannot lose an intended denial. String mistakes (`""`, `"Bash"`) survive the mapper and are judged by the guard.

Observed, not fixed here: `isSafeEnvString` accepts `""`, so `[""]` survives the mapper, contrary to plugin-spawn-scope's "non-empty" wording. This is harmless for the guard, which ignores empty roots.

## Risks / Trade-offs

- **[Handler order with path-gate]** pi runs `tool_call` handlers in load order (`docs/extensions.md`), and `-e` paths merge ahead of discovered ones (pi `dist/core/resource-loader.js:409`, `mergePaths(cliEnabledExtensions, enabledExtensions)`). So a guard loaded through `scope.extensions` runs before the bridge's path-gate, and a guard rejection is never preceded by a gate prompt. The one remaining prompt case is a target outside the session cwd but inside `allowedRoots`: the guard passes it and path-gate may prompt. → README: keep `allowedRoots` inside the session cwd. The spec's independence requirement is order-agnostic, since either handler can block.
- **[Later handlers can rewrite approved arguments]** pi passes one mutable `args` object to every `tool_call` handler. For example, image-fit rewrites `event.input.path` to a resized copy (`maybeResize`, `packages/image-fit-extension/src/extension.ts`). → Accepted trust boundary, stated in the spec. Co-loaded extensions run with full process authority and could read files directly anyway. Wrapping the six built-ins to re-check final args was rejected as heavy and still bypassable by the same extensions.
- **[Shell, MCP, subagent and codemode tools bypass path confinement]** pi ships `bash` and `powershell` (pi `dist/core/tools/powershell.js:16`). → Accepted non-goal. The README recommends `deniedTools` naming every shell and code-executing tool (`bash`, `powershell`, `ctx_execute`-style sandboxes, subagent/spawn tools, `codemode`), plus `scope.noMcp: true`. `ctx.executeTool` can reach every registered `codemode`/`deferred`-exposure tool even when it is inactive (pi `dist/core/agent-session.js:1144-1152`), so a `scope.tools` allowlist alone does not confine nested calls. `deniedTools` does catch them by name. It also notes that a `scope.tools` allowlist does not remove MCP tools on pi ≥ 1.0.4 (plugin-spawn-scope spec). The guard is an argument-level control, not a sandbox.
- **[The jiti-safety gate does not seed `-e`-only entries]** `jiti-cjs-transpile-safety` derives its seeds from `pi.extensions`, server `main` and plugin entries, and this package has none. → A package-local test transpiles `extension.ts` and `scope.ts` with jiti in CommonJS mode and asserts no `import.meta` in code position (task 3.6).
- **[A module that fails to import on reload leaves the session unguarded]** A syntax error or a missing dependency fails before the total factory can run. → README: plugins respawn rather than reload guarded sessions. The jiti test (task 3.6) and the package tests catch import breakage in CI.
- **[Install footprint]** The guard depends on all of `pi-dashboard-shared`, which is heavier than `untrusted-content-guard`. → Accepted in exchange for a single resolver; noted in the README.
- **[A directory search inside a root can traverse a symlink pointing outside]** This would apply if a future pi version made `grep`/`find` follow symlinks. → Today rg/fd do not follow them. Add a test that pins that the guard decides only on the search root, and note the assumption in the README.
- **[TOCTOU]** A path canonicalised at check time can be swapped for a symlink before the tool opens it. → The same limitation as path-gate. Documented; a sandbox is out of scope.
- **[Roots are canonicalised once at load]** A root replaced by a symlink after load keeps its old canonical form. Targets resolved through the new symlink then land elsewhere and are rejected, so this fails closed and is acceptable.
- **[The extraction regresses path-gate]** → A pure move. The `decide.test.ts` parity suite and `handler.test.ts` run unchanged, and the re-export shim keeps the import paths stable.

## Migration Plan

- No persisted state, protocol or API changes. The guard itself is opt-in.
- Two behaviour changes reach existing sessions:
  - D6: path-gate now asks about dangling-symlink escapes.
  - D7: spawns that name an extension own its namespace; the four call sites are listed in D7.
- Rollback:
  - Guard only: stop passing it in `scope.extensions`.
  - D6/D7: a code revert. The path-gate re-export shim keeps import sites unchanged, so reverting the shared module is clean.
