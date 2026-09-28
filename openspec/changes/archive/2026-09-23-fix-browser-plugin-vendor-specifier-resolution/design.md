# Design — vendored-relay specifier resolution

## Context

`add-browser-relay` (D2) vendored playwright-core's CDP relay and mapped its
playwright-internal specifiers (`@isomorphic/manualPromise`,
`@isomorphic/time`, `@isomorphic/timeoutRunner`, `@utils/wsServer`) onto
`relay/vendor/shims/` through build-time alias layers. Those layers cover
`tsc` and vitest. The runtime path — `await import(plugin.serverEntryPath)` at
`dashboard-plugin-runtime/src/server/loader.ts:462` — is covered only when
jiti's `JITI_TSCONFIG_PATHS` is set AND a `tsconfig.base.json` is reachable.
Both hold in a monorepo started through the repo's own wrapper, and in Docker
(`entrypoint.sh` execs `pi-dashboard`; `Dockerfile:152` copies the tsconfig).
Neither holds in an npm/managed/Electron install, where the tsconfig does not
ship at all.

## D1 — Rewrite specifiers; delete the alias layers

**Decision.** Rewrite the 5 import lines in the 2 vendored files to
package-relative specifiers; delete the tsconfig `paths`, the vitest
`resolve.alias`, the `verify-published-imports.mjs` waiver, and the
`JITI_TSCONFIG_PATHS` stamp.

| Option | monorepo | Docker | npm / managed / Electron | Verdict |
|---|---|---|---|---|
| A — stamp the flag in every launcher | works | works | **fails** (no tsconfig to read) | rejected: cannot satisfy "every install mode" |
| B — plugin-local `tsconfig.json` with relative `paths` | works | works | works | implemented in the spike and passed; rejected on dependency surface — still needs the flag on every launch path plus jiti's undocumented nearest-tsconfig walk |
| **D — rewrite specifiers** | works | works | works | **selected**: depends only on files inside the package |

A was falsified directly: an out-of-repo install fails with the flag ON.

Specifier form: `'../../../../shims/manualPromise.js'`. `.js`-pointing-at-`.ts`
matches house style and `moduleResolution: bundler`, resolves under jiti, and
was exercised by the spike's full vitest run on the patched tree. It does not
resolve under plain Node type-stripping — a property shared by every import in
this repo, not introduced here.

## D2 — Integrity: provenance kinds, and fidelity checked at refresh time

The current manifest assumes one provenance for the whole tree. That is
already false: `playwright-core/src/server/registry/index.ts` is an authored
shim replacing a ~60 KB upstream module (`vendor/NOTICE` §"Authored shims"),
and after this change two more files are upstream-plus-patch. The manifest
therefore records a kind:

```jsonc
"relay/vendor/playwright-core/src/tools/mcp/cdpRelayV2.ts": {
  "kind": "upstream-verbatim",
  "upstream": "db32c68f…",   // bytes at upstreamCommit
  "patched":  "<new>"        // bytes on disk
},
"relay/vendor/playwright-core/src/server/registry/index.ts": {
  "kind": "authored",
  "patched": "4c5a9678…"     // no upstream counterpart exists
},
"relay/vendor/shims/manualPromise.ts": {
  "kind": "upstream-verbatim",
  "upstream": "86c9695f…",
  "patched":  "86c9695f…"    // unpatched today, but now machine-checked
}
```

`shims/**` join the manifest: they were hashed only in NOTICE prose, and every
rewritten import now points into them.

**Fidelity is checked where it can actually be checked.** Regenerating
`upstream` from the working tree and then comparing it to the working tree is
circular — it would detect nothing. `scripts/refresh-vendor.mjs` performs the
refresh: fetch each `upstream-verbatim` file at `upstreamCommit`, assert the
recorded `upstream` hash, then run the patch script, then regenerate
`patched`. The unit test asserts only what a unit test can: `patched` matches
disk, every entry carries the keys its `kind` requires, and the file set is
exactly the manifest's. Contract "detect an unfaithful refresh" is met by the
refresh tool (network, run by the refresher), not by CI — stated plainly
rather than implied.

## D3 — Apache-2.0: §4(b) in-file, §4(d) in NOTICE

§4(b) obliges *modified files* to carry prominent notices that they changed;
§4(d) governs the NOTICE file. The patch script emits the in-file header, so
it is part of the patched bytes, the `patched` hashes, and the idempotency
contract (running twice must not stack headers). NOTICE additionally moves
`cdpRelay.ts` / `cdpRelayV2.ts` out of its "Verbatim upstream files" table
into a Modifications section — leaving them listed as verbatim would make the
attribution file self-contradictory.

## D4 — Guards chosen so no alias layer can satisfy them

1. **Out-of-repo load.** Pack → extract outside the repository → install →
   import under plain node+jiti with no repo tsconfig and no env var,
   asserting `typeof mod.default === "function"` (the loader's own check at
   `loader.ts:462-464`). The guard imports `cdpRelay.ts` explicitly in
   addition to the entry: the runtime chain (`index.ts` → `relay-manager` →
   `relay-instance` → `cdpRelayV2`) reaches 1 of the 5 patched lines;
   `cdpRelay.ts` holds the other 4 and has no runtime importer.
2. **Specifier guard.** Every bare specifier in
   `relay/vendor/playwright-core/**` must be a Node builtin or a declared
   dependency of the package. An allowlist of `@isomorphic/`/`@utils/`
   prefixes would pass a future refresh that introduces `@protocol/` or
   `@injected/`. The check parses import statements — a raw grep over
   `relay/vendor/**` would trip on `NOTICE` and `AGENTS.md`, which legitimately
   *name* the old specifiers.
3. **Idempotency.** Two consecutive script runs leave a byte-identical tree
   (including the §4(b) header).

## D5 — QA smoke: three ways it can be vacuously green

Each was hit or identified while spiking, and each becomes an assertion:

- **Nothing discovered.** Discovery reads exactly three sources
  (`loader.ts:115-131`): monorepo `packages/`, `~/.pi/dashboard/plugins`,
  `<ancestor>/resources/plugins`. A clean prefix has none, so `discovered ==
  0` and "no failures" holds on a broken build. The test SHALL install the
  plugin into the prefix and assert `browser ∈ discovered`.
- **Nothing enabled.** `browser` is `defaultEnabled: false`
  (`plugin-enabled.ts`, `add-browser-relay` GAP B). The test SHALL discover
  first, then write a config enabling every discovered plugin, then boot
  again — a config cannot be written before discovery has run.
- **Wrong tree.** `findMonorepoRoot()` walks up from the loader module, so a
  monorepo on the same host can be loaded instead of the install. The test
  SHALL assert each loaded plugin's path is inside the install prefix.

The success assertion is **"every attempted load succeeded"**, not
`loaded == discovered`: `loader.ts` legitimately reports `loaded: false` for
`missing/disabled dep` and unmet `missingRequirements`, which a clean VM will
produce for healthy builds.

## D6 — CI install-load check must test the worktree, not the registry

`npm install` inside the extracted tarball resolves
`@blackbelt-technology/dashboard-plugin-runtime@^0.8.0` and `…-shared@^0.8.0`
from the **registry** — the hazard `bundle-server.mjs:86-92` already
documents. Consequences if left unaddressed: a PR touching the runtime is
tested against a stale published copy; a release-prep PR bumping to an
unpublished version fails with an E404 unrelated to the change.

The check therefore packs the first-party workspace dependencies too and
installs them from those tarballs, so the imported graph is the working tree.
Scope: workspaces whose `pi-dashboard-plugin` manifest declares a `server`
entry — `packages/demo-plugin` is `fixture: true` and client-only, so an
unconditional "every plugin exposes a default-export server function" is
unsatisfiable. Cost is bounded by that filter and stated in the task so the
budget is visible.

## Risks

| Risk | Mitigation |
|---|---|
| A refresh re-copies upstream and skips the patch | specifier guard (D4.2) + `refresh-vendor.mjs` owning the whole sequence |
| Upstream fidelity unverifiable | `refresh-vendor.mjs` verifies `upstream` against a fetch at `upstreamCommit`; scope limit stated, not hidden |
| Apache-2.0 §4(b) unmet | in-file headers emitted by the patch script |
| Removing the stamp breaks another plugin | measured: the running server has no such variable and loads all 16 others |
| Removing the stamp breaks an OLD plugin copy still on disk (`~/.pi/dashboard/plugins`, Electron `resources/plugins`) | patched plugin ships in the same release; CHANGELOG states the pairing |
| Docker regresses (it works today via wrapper + copied tsconfig) | docker harness run is a gate, not an afterthought |
| Guard 1 covers only the runtime import chain | it imports `cdpRelay.ts` explicitly |
