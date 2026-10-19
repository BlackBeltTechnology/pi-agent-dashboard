## Context

See proposal.md — Why. Audit at `24b25b050`. **Client roots** = the directory of every plugin manifest `pi-dashboard-plugin.client` entry (minus that manifest's `server`/`bridge` entry dirs), plus every `packages/*/src/client` tree. That is 19 `src/client` trees plus 5 manifests whose client entry sits elsewhere:

| Package | Manifest `client` | Scanned dir (excl.) |
|---|---|---|
| `demo-plugin` | `./src/client.tsx` | `src/` (excl. `server/`, `bridge/`) |
| `flows-anthropic-bridge-plugin` | `./src/client.tsx` | `src/` (excl. `server/`, `bridge/`) |
| `grammar-plugin` | `./src/index.tsx` | `src/` (excl. `server/`) |
| `quota-plugin` | `./src/client.tsx` | `src/` (excl. `server/`) |
| `roles-plugin` | `./src/index.tsx` | `src/` (excl. `server/`, `bridge/`) |

Hits in client roots (`crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `navigator.mediaDevices`; tests excluded):

| File | Call | Effect on a plain-http LAN origin |
|---|---|---|
| `packages/gmail-plugin/src/client/GmailSettings.tsx:107` (`Copyable`) | `navigator.clipboard?.writeText(value)` | Nothing is copied and the user gets no feedback. |
| `packages/kb-plugin/src/client/KbTestSearch.tsx:60` (`copy`) | `navigator.clipboard?.writeText(path)` | Nothing is copied, yet it shows "Path copied", a false success (`:61`, `:118`). |

No plugin client root calls `crypto.randomUUID`, `crypto.subtle` or `navigator.mediaDevices`. Neither hit throws, because optional chaining turns the call into a no-op. Once D4 widens the pattern, the scan will also flag one already-guarded call that today's literal regex misses: `packages/client-utils/src/identity/login-flow.ts:114` (`globalThis.crypto?.subtle ? "discovery-failed" : "insecure-context"`). That line is a capability check, so it is allowlisted (D3), not fixed.

The following are outside the client roots and therefore out of scope:
- `packages/shell/src/lib/protocol.ts:144,159` uses `crypto.subtle` (Ed25519 verify). `packages/shell/src/components/PairView.tsx:148` calls `navigator.mediaDevices.getUserMedia` with no guard. The shell is a standalone PWA served over HTTPS (GitHub Pages) or localhost and is never loaded into the dashboard SPA. The PairView gap is already documented in `packages/shell/AGENTS.md`.
- `packages/bus-client/src/client.ts:379,408` calls `randomUUID` on `import crypto from "node:crypto"` (`:16`). That is a Node API with no secure-context concept.
- `packages/deck3d/src/runtime/hud.ts:768` already guards the call with an `execCommand` fallback. deck3d is a standalone deck runtime.
- `packages/server`, `packages/extension` (e.g. `extension/src/bridge.ts:172`, `prompt-bus.ts:134`), and `packages/*/src/server/**` all call bare `crypto.randomUUID()` in Node, which is correct there.
- `packages/electron/out/**` and the plugin/server copies under `packages/electron/resources/server/**` are build-output copies, including the removed `jj-plugin`. They are not source and are not scanned.

Current helpers: `packages/client/src/lib/util/random-uuid.ts` and `clipboard.ts`, imported by about 20 client source files. Plugins may not import `packages/client`:
- it would create a cycle, because client depends on about 20 plugins;
- the `dashboard-plugin-loader` "Plugin runtime is a separate workspace package" requirement forbids it.

Every plugin, `client` and `client-utils` already depend on `@blackbelt-technology/dashboard-plugin-runtime`. gmail and kb already import its barrel (`GmailSettings.tsx:31`, `KbTestSearch.tsx:11`).

The current scan test is `packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts`:
- roots `client/src` and `client-utils/src` (`:18`);
- the literal regex `/\bcrypto\.(?:randomUUID|subtle)\b|\bnavigator\.clipboard\b/g` (`:29`);
- regex comment stripping that is not string-aware (`:32-34`).

## Goals / Non-Goals

**Goals:**
- One implementation of `randomUuid()` and `copyText()` that both plugins and the client can reach.
- Both plugin Copy actions call `copyText()` and report its real result.
- The scan test guards every client root above, the runtime's client surface, and four APIs, and is hard to evade by syntax.

**Non-Goals:**
- Shell, bus-client, deck3d runtime, server, extension (see Context).
- Changing any behaviour in a secure context, where the native API still wins.
- A shared `mediaDevices` helper. No caller exists yet, and capture has no non-secure fallback.

## Decisions

**D1 — Hoist the helpers into the runtime barrel.** Create `packages/dashboard-plugin-runtime/src/secure-context.ts` with `randomUuid()` and `copyText()`, moved verbatim, and re-export it from `src/index.ts`. `packages/client/src/lib/util/random-uuid.ts` and `clipboard.ts` become one-line re-exports. That way:
- the client import sites stay unchanged;
- the `vi.mock` paths in `ToolsSection.install-dropdown.test.tsx:16` and `GatewayPairQR.test.tsx:28` stay valid.

Why the barrel and not a new `./secure-context` subpath:
- `dashboard-plugin-loader` allows the barrel to grow ("at minimum"), so no spec delta is needed;
- about 65 client source files already import the barrel, so routing the util leaf through it adds nothing to the bundle;
- `secure-context.ts` has no top-level side effects; it touches `navigator`/`document` only when called. As it happens, `src/server/index.ts` does not re-export the barrel and no server or extension source imports it, but safety does not depend on that.

Alternatives considered:
- `packages/shared`: it is isomorphic and Node-heavy, and `copyText` needs `document`.
- `packages/client-utils`: gmail and kb would gain a dependency. `plugin-ui-primitive-registry` discourages `client-utils` for shared UI components; the barrel avoids the dependency entirely.
- A `ui:` primitive: overkill for two pure functions.
- A `./secure-context` subpath export: rejected for now as needless churn to the public entry-point list.

**D2 — Plugins report the real result.**
- `KbTestSearch.copy` awaits `copyText(path)`. It sets `copied` only when that returns true. The latest click wins: a monotonically increasing request counter (a ref) discards the result of any copy that a later click has superseded. Otherwise it shows `data-testid="kb-search-copy-failed"` with the `copyFailed` key and `aria-live="polite"`.
- `GmailSettings.Copyable` shows a transient label for 1500 ms (same counter guard), Copied or Copy failed, in a `role="status"` region so screen readers hear the result.
- New keys go into the `zh-CN` and `hu` maps of each plugin's `src/i18n.ts`. English comes from the `t()` default-string argument at the call site, because the catalogs have no `en` block. Both catalogs have parity tests: `kb-plugin/src/__tests__/i18n.test.ts` and the gmail `client-entry.test.tsx`.
- The `<code>` value stays visible and selectable, which is the manual fallback.

**D3 — Roots come from manifests.** At run time the scan test computes roots as:
- for each `packages/*/package.json` that has `pi-dashboard-plugin.client`: the directory of that entry, excluding the directories of that manifest's `server` and `bridge` entries;
- every `packages/*/src/client` that exists (filter on existence, because `fixture-policy-plugin`, `keycloak-resolver-plugin` and `mcp-server-plugin` have none);
- `client/src` and `client-utils/src`;
- `dashboard-plugin-runtime/src` excluding `server/`, `bridge/`, `vite-plugin/` and `test-support/` (the Node surfaces).

A new plugin is then covered automatically, provided it declares a manifest client entry or has a `src/client` dir. Allowlist changes:
- add `dashboard-plugin-runtime/src/secure-context.ts`;
- add `client-utils/src/identity/login-flow.ts`, a guarded `crypto?.subtle` capability check;
- remove the two client util entries, which become re-exports with no API hit.

An allowlist entry means a reviewed call site that is capability-checked. The delta permits a checked call; the scan flags every reference and leaves the judgement to the allowlist. The stale-entry check stays.

**D4 — Guard `navigator.mediaDevices` as well, with a wider pattern.**
- Member arm: `navigator` or `crypto` followed by `.`, `?.`, `["…"]` or `?.["…"]`, then `clipboard`, `randomUUID`, `subtle` or `mediaDevices`. Starting point: `\b(?:navigator|crypto)\s*(?:\?\.\s*)?(?:\.|\[\s*["'`])\s*(?:clipboard|randomUUID|subtle|mediaDevices)\b`.
- Quoted-global arm: `(?:window|globalThis|self)\s*\[\s*["'`](?:navigator|crypto)["'`]`.
- Destructuring arm: `=\s*(?:(?:window|globalThis|self)\s*\.\s*)?(?:navigator|crypto)\s*[;,)\n]` when the left side is an object pattern (`}\s*=`).
- Bare-method arm: `\b(?:getUserMedia|getDisplayMedia)\s*(?:\?\.\s*)?\(`, so capture is still caught when the `mediaDevices` object was reached through an alias.
- Comments are stripped with the TypeScript parser (`typescript` resolves from the client vitest project through the hoisted `nodeLinker`; task 1.1 verifies this) (`ts.createSourceFile`, collecting comment ranges per token), using `typescript`, which is already a root devDependency. A raw `ts.createScanner` pass is believed insufficient (the fixture in task 1.1 proves it either way): without `reScanTemplateToken` it does not re-scan template middles, so `` `${wsProtocol}//${window.location.host}` `` (`packages/client/src/App.tsx:497`) mis-lexes the rest of the file. With the parser, `"/*"` and `"//"` inside strings, templates or regex literals cannot hide code or invent hits.
- A fixture self-test asserts that each matched form is caught, that a commented-out call is not, and that `${a}//${b}` inside a template does not hide a later call.
- **Residual gap, accepted:** aliasing the global object itself (`const n = navigator; n.clipboard`, `const c = crypto; c.randomUUID()`) and `Reflect.get(navigator, "clipboard")` are not caught. One alias exists today, `packages/client/src/hooks/useHostPlatform.ts:34` (`const nav = navigator as …`), but it reads only `platform` / `userAgentData`. Review covers this gap; the spec scenario names only the shapes the scan catches.
- Root dedupe: a manifest client dir can contain a `src/client` tree (or be one). Roots are deduplicated by real path, so a file is scanned once.

`mediaDevices` has no fallback, so any future caller follows the DPoP/`crypto.subtle` rule: check that the API exists, report "unavailable in this context" otherwise, and add an allowlist entry with a justifying comment. Review of that allowlist entry plus the feature's own tests enforces the check. The spec scenario "Media capture on an http LAN origin" is enforced in this change by the scan only. Its behavioural test belongs to the first change that adds a caller (e.g. `add-voice-assistant-dashboard-plugin`). The scan cannot verify that a check exists, only that the call site is allowlisted.

Alternative considered: a full AST scan of the property-access chain. It catches more aliasing shapes, but costs more than this audit needs. The regex plus the method-name arm covers the real shapes found in the repo.

## Risks / Trade-offs

- [The runtime barrel gains a DOM-touching module] → It has no top-level side effects, and the server barrel never imports it.
- [`random-uuid.test.ts` also covers the `useSessionActions` spawn dispatch (E29; import at `:9`)] → It stays in `packages/client`, untouched. It keeps testing behaviour through the re-export. The runtime gets its own pure `randomUuid`/`copyText` tests.
- [The F9 assertion in `packages/kb-plugin/src/client/__tests__/KbSourcesSearch.test.tsx:412-421` is synchronous] → It becomes `await waitFor(…)` once `copy` is async.
- [The method-name arm may flag an unrelated `getUserMedia(` identifier] → Allowlist it with a comment. There are zero such names today.
- [`execCommand("copy")` is deprecated] → This is the same trade-off accepted in `add-lan-knock-pairing`, and it is the only fallback that works without HTTPS.
- [Merge overlap with `improve-gmail-plugin-setup-ux` and `add-gmail-auto-setup`, both active and unapplied, which edit `GmailSettings.tsx` but not `Copyable`] → Keep this diff to `Copyable` plus its import. Whichever change lands second rebases.
- [`shell` PairView's `getUserMedia` gap] → Stays out of scope. It is not a client root.

## Migration Plan

This is a pure client refactor: no persisted state and no protocol change. Rollback is reverting the commit.

Compatibility. Plugin client entries are bundled into the SPA at build time (`dashboard-plugin-loader`, "Client-side plugin entries are bundled by Vite"), so a plugin compiles against the runtime its build resolves.
- Old plugin on the new runtime: it keeps its optional-chained call, broken but harmless.
- New plugin on an old runtime: the named import `copyText` / `randomUuid` is undefined and the build fails. In-repo plugins cannot hit this, because `release-cut` Step 5 bumps every workspace and syncs inter-package dep specifiers in lockstep.
- A third-party plugin that adopts the helpers must raise its `@blackbelt-technology/dashboard-plugin-runtime` floor to the release that carries them. Record that release in the README's public-API entry (task 4.1).
