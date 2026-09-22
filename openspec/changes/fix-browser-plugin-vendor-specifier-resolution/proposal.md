# Make the browser plugin's vendored relay resolve without alias configuration

## Why

The browser relay plugin fails to load wherever its playwright-internal
specifiers cannot be aliased. Live evidence from the dashboard running in this
repo (pid 20948):

```
[plugin-loader] Failed to load plugin "browser": Cannot find module '@isomorphic/manualPromise'
Require stack:
- packages/browser-plugin/src/server/relay/vendor/playwright-core/src/tools/mcp/cdpRelayV2.ts
```

That boot discovered 18 plugins, loaded 16, failed 1 — `browser`. (The
`~/.pi/dashboard/server.log` file holds 39 boots and 434 cumulative
`Loaded plugin` lines; the per-boot figures are the ones that mean anything.)

`@isomorphic/manualPromise` is not a registry package. It is a
playwright-internal specifier inside the vendored relay
(`relay/vendor/playwright-core/**`, change `add-browser-relay` task 2.2,
design D2) pointing at `relay/vendor/shims/` that ship in the same package.
Three layers map it; each covers a different tool, and none covers runtime by
itself:

| Layer | Mechanism | Covers |
|---|---|---|
| typecheck | `tsconfig.base.json` `paths` | `tsc` |
| tests | `packages/browser-plugin/vitest.config.ts` `resolve.alias` | vitest |
| runtime | jiti's opt-in `JITI_TSCONFIG_PATHS=true` (stamped only in `packages/server/bin/pi-dashboard.mjs:191`) **plus** a reachable `tsconfig.base.json` | only where BOTH hold |

Install modes, measured rather than assumed:

| Mode | wrapper stamps the flag | `tsconfig.base.json` reachable | today |
|---|---|---|---|
| monorepo checkout, started via the repo's `bin/pi-dashboard.mjs` | yes | yes | **works** |
| Docker image (`docker/entrypoint.sh:74` execs `pi-dashboard`; `Dockerfile:152` copies `tsconfig.base.json`) | yes | yes | **works** |
| monorepo, started any other way (bridge auto-start `buildSpawnEnv`, `/api/restart`, an npm script, a stale wrapper on `PATH`) | no | yes | broken |
| npm global / managed `~/.pi-dashboard/node_modules` install | yes | **no** | broken |
| Electron bundled server (`bundle-server.mjs` copies workspace source, not `tsconfig.base.json`) | n/a | **no** | broken |

Two distinct causes, and the second is the fatal one:

**Cause 1 — the flag is launcher- and version-coupled.** Only the standalone
wrapper stamps it, and only since `add-browser-relay`. The failing server
above was launched from the globally installed `@blackbelt-technology/pi-agent-dashboard@0.8.0`
wrapper, which predates line 191 — hence 97 environment variables and no
`JITI_*` among them. `extension/src/server-launcher.ts` `buildSpawnEnv`
(bridge auto-start) and `spawn-process/restart-helper.ts` (`/api/restart`)
stamp nothing and merely inherit whatever the parent had.

**Cause 2 — the flag is useless without a file that is never published.**
`tsconfig.base.json` is absent from the npm tarball, from the globally
installed dashboard (verified on 0.8.0), and from the Electron bundle. There
the flag enables reading a file that does not exist. Measured: an out-of-repo
install of today's plugin fails **identically with the flag on and off**.

`scripts/verify-published-imports.mjs:126-129` already detected this class of
defect and was silenced with a waiver stating the specifiers *"cannot be
rewritten"*. That is the assumption this change discards.

## What Changes

**Resolution.** The four playwright-internal specifiers in the vendored tree
SHALL be rewritten to package-relative paths (`'../../../../shims/manualPromise.js'`)
by a committed idempotent script, so resolution depends only on files inside
the published package — no tsconfig, no env var, no bundler config, no cwd.

This replaces the `add-browser-relay` "never edit `playwright-core/`" rule
with copy → verify → patch → rehash. Integrity is restructured, not dropped:

- `vendor-hashes.json` gains a **provenance kind** per file, because the tree
  is not uniformly upstream. `playwright-core/src/server/registry/index.ts`
  is an authored ~60 KB-replacing shim (`vendor/NOTICE` §"Authored shims"),
  so labelling its hash `upstream` would be a lie. Kinds: `upstream-verbatim`
  (records `upstream` + `patched`), `authored` (records `patched` only).
- `shims/**` enter the manifest. They are currently hashed only in NOTICE
  prose, and after this change every rewritten import points into them.
- **Refresh fidelity is a refresh-time network check, not a unit test.**
  Comparing a regenerated hash against a hash regenerated from the same tree
  is circular. `scripts/refresh-vendor.mjs` fetches each file at
  `upstreamCommit`, asserts the `upstream` hash, then applies the patch.

**Apache-2.0.** §4(b) requires *the modified files* to carry a change notice;
§4(d) governs the NOTICE file. Both are done: the patch script emits an
in-file modification header (so it is part of the `patched` bytes and the
idempotency contract), and `vendor/NOTICE` gains a Modifications section.

**Deletions.** The 4 `paths` entries; the 4 vitest aliases; the
`verify-published-imports.mjs` waiver block; the `JITI_TSCONFIG_PATHS` stamp
and every doc that describes the alias mechanism as live
(`packages/browser-plugin/AGENTS.md`, `vendor/NOTICE`, `vendor/AGENTS.md`,
`scripts/verify-published-imports.mjs.AGENTS.md`, `packages/server/AGENTS.md`,
the X14 test's own title and comments, the `vendor-hashes.json` `$comment`
regenerator one-liner).

Removing the stamp is safe by measurement: the running server carries no such
variable and loads all 16 other plugins. It is not cosmetic — leaving it would
keep a global resolution-semantics switch alive for every other plugin with no
remaining justification.

**Guards.** Typecheck, vitest and X14 were all green while production was
broken, because each supplied its own alias. Three guards that no alias layer
can satisfy:
1. out-of-repo load — pack, extract outside the repo, install, import the
   server entry under plain node+jiti with no repo tsconfig and no env var,
   asserting the loader's own contract (`typeof mod.default === "function"`);
2. specifier guard — every bare specifier in `relay/vendor/playwright-core/**`
   must be a Node builtin or a declared dependency (a prefix allowlist would
   miss `@protocol/`, `@injected/` and friends on a future refresh);
3. patch-script idempotency.

Guard 1 must import `cdpRelay.ts` explicitly: the runtime chain reaches only
`cdpRelayV2.ts` (1 of the 5 patched lines), while `cdpRelay.ts` holds the
other 4 and has no runtime importer.

**QA.** A `qa/` clean-install boot that installs the plugin into the prefix,
asserts `browser` is discovered, enables every discovered plugin, asserts no
attempted load failed and the loaded plugin's path is inside the install
prefix — plus a per-PR CI check running the pack→install→import loop for every
plugin workspace declaring a `server` entry.

Out of scope: stamping `JITI_TSCONFIG_PATHS` across launchers (explicitly
rejected — it cannot fix the unpublished-tsconfig modes) and any behavioural
change to the relay.

## Spike evidence

Executed before writing this proposal, in a detached worktree since removed.
`tasks.md` §0 reproduces every row.

| # | Check | Result |
|---|---|---|
| 1 | `tsc --noEmit` on browser-plugin, patched tree, `paths` removed | exit 0 |
| 2 | `vitest run` on browser-plugin, **patched tree**, `resolve.alias` removed | 22 files, 199 tests passed (incl. X14) — also the only evidence that Vite maps the new `.js` specifiers to `.ts` |
| 3 | patched package outside the repo, tsconfig deleted, no env var, cwd `~` → import server entry | loaded; registration function reachable |
| 4 | same layout, UNPATCHED, flag ON **and** OFF | fails both ways |
| 5 | `npm pack` | ships `vendor/playwright-core/**` + `vendor/shims/**`, no `node_modules`; `npm install --omit=dev` resolves 75 deps |
| 6 | real server boot, temp HOME, flag emptied — UNPATCHED | `loaded: 16  failed: 1` (`browser`) |
| 7 | same boot, PATCHED tree | `loaded: 17  failed: 0`, `Loaded plugin "browser"` |
| 8 | option B (plugin-local tsconfig + flag) | worked; rejected on dependency surface, not failure |

Not yet measured, and therefore tasked rather than claimed: Electron bundle,
managed `~/.pi-dashboard` install, Docker after the stamp is removed.

Row 3 used a looser assertion than the loader's contract (it observed jiti's
nested-default interop shape). Guard 1 asserts `typeof mod.default ===
"function"` exactly as `loader.ts:462` does; if the interop shape differs
between the harness and the server, that is a finding to surface, not to
paper over.

Two harness traps hit while spiking the QA step, now binding requirements:

- **Vacuous green.** The first boot of the UNPATCHED tree reported
  `16 loaded, 0 failed` — `browser` is `defaultEnabled: false`, so it was
  never loaded. A clean-install variant is worse: with no plugin installed
  into the prefix, discovery returns **zero** and every assertion passes on a
  broken build.
- **Wrong-tree contamination.** A boot of the PATCHED worktree reported the
  failure with a `Require stack` in the MAIN checkout: per-package
  `node_modules` symlinks resolved `dashboard-plugin-runtime` back there, so
  `findMonorepoRoot()` loaded the unpatched tree.

## Discipline Skills

- `doubt-driven-review` — already run on this proposal + design (two
  reviewers, fresh-context and cross-model); findings reconciled into this
  revision. Re-run on the dual-SHA/provenance design before any vendored file
  is touched, since that is the irreversible-feeling step.
- `review-code` — before commit, on the patch script, the guards and the
  deletions spanning three packages.
- `systematic-debugging` — applied; re-invoke only if a gate goes red.
- Not triggered: `security-hardening` (no untrusted input, auth, secret or
  PII path is touched — the relay deny-list and pairing tokens are
  unchanged), `performance-optimization` (no latency/throughput budget),
  `observability-instrumentation` (no new endpoint, job or external call).

## Impact

- `relay/vendor/playwright-core/src/tools/mcp/{cdpRelay,cdpRelayV2}.ts` — 5 specifier lines + an Apache §4(b) header.
- `relay/vendor/NOTICE`, `relay/vendor/AGENTS.md`, `packages/browser-plugin/AGENTS.md`, `scripts/verify-published-imports.mjs.AGENTS.md`, `packages/server/AGENTS.md` — the alias mechanism stops being described as live.
- `src/server/__tests__/vendor-hashes.json` (+ its `$comment` regenerator) and `vendor-integrity.test.ts` — provenance kinds, shims included.
- `tsconfig.base.json`, `packages/browser-plugin/vitest.config.ts`, `packages/server/bin/pi-dashboard.mjs`, `scripts/verify-published-imports.mjs` — deletions.
- New: `scripts/patch-vendor-specifiers.mjs`, `scripts/refresh-vendor.mjs`, `scripts/verify-plugin-install-load.mjs`, a `qa/` clean-install plugin-load test.
- `openspec/specs/browser-relay/`, `openspec/specs/dashboard-plugin-loader/` — deltas (both ADDED; the baseline browser-relay spec has 11 requirements and none covers vendor integrity, so there is nothing to MODIFY).

**Rebuild matrix.** `/api/restart` is NOT sufficient here and must not be used
to verify: it re-execs the entry directly and inherits `process.env`, so a
server whose ancestor was started by the old wrapper keeps
`JITI_TSCONFIG_PATHS=true` and would go green for the wrong reason. Editing
`bin/pi-dashboard.mjs` is not exercised by it at all. Verification requires a
**cold relaunch through the wrapper with the variable explicitly unset**
(`env -u JITI_TSCONFIG_PATHS`). Ordinary source-only iteration during
implementation may still use `/api/restart`.

**Compatibility.** The server stops stamping the flag while older plugin
copies may still be present — `~/.pi/dashboard/plugins/` from a prior install,
or `resources/plugins/` inside an already-installed Electron bundle. Such a
copy works today in a monorepo/Docker context and stops working after the
server upgrade. The patched plugin must therefore ship in the same release as
the stamp removal, and the CHANGELOG entry must say so. Docker specifically
moves from "works via wrapper + copied tsconfig" to "works via package-relative
specifiers"; the harness run in §6 is the gate on that transition.

**Rollback.** Revert the commit: source-only, no persisted state, no wire
format, no config or data migration. A reverted server paired with an
already-published patched plugin still works (relative specifiers resolve
irrespective of the flag); the reverse pairing — new server, old plugin — is
the one to avoid, which is why both ship together.
