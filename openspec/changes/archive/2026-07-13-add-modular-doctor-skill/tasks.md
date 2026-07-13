## 1. Skill scaffold + router contract

- [x] 1.1 Create `packages/extension/.pi/skills/doctor/SKILL.md` router with
      front-matter (name, description, triggers) and NO capability knowledge.
- [x] 1.2 Define the capability-MD front-matter contract keys: `scope`,
      `symptoms:` (phrases), `depends-on:` (module ids). → verify: a fixture MD
      parses into a router catalog entry.
- [x] 1.3 Implement router derivation: build the symptom→module map and the
      sweep DAG from module front-matter (no hand-kept catalog). → verify:
      adding a fixture module registers it in routing + sweep with no SKILL.md
      edit.
- [x] 1.4 Implement sweep ordering + lower-layer short-circuit (missing pi
      suppresses downstream bridge failures). → verify: fixture where pi absent
      reports pi as root cause, not the bridge.

## 2. Shared check library (`_lib`, shell-first)

- [x] 2.1 Add `_lib` resolver helpers that wrap `resolvePiPackage`,
      `resolvePiPackageEntry`, `listPiPackages`, `sourcesMatch`, `parseSourceKey`
      (no reimplementation). → verify: unit test resolves a tier-1 and a tier-2
      case matching the primitives.
- [x] 2.2 Add server-tier helpers for `/api/health` + `/api/pi-core/versions`
      that DEGRADE cleanly when the server is down. → verify: server-down run
      returns file-derived facts + a "server unavailable" label.
- [x] 2.3 Add a fact-provenance labeller (file-derived vs server-enriched) used
      by every module report. → verify: mixed run labels each fact correctly.

## 3. Capability modules (uniform 5-part contract)

- [x] 3.1 `env-node.md` — node version, OS, platform, PATH. → verify: reports
      node version + platform; flags unsupported node.
- [x] 3.2 `pi-resolution.md` — enumerate ALL pi locations (CLI/repo/managed/nvm/
      session-cwd), flag divergence + floor violation vs `piCompatibility`. →
      verify: fixture with two pi versions flags divergence; sub-floor flagged.
- [x] 3.3 `peers.md` — pi-flows + anthropic-messages via tier-1/tier-2; detect
      name-skew (published component probing a dead rescoped name). → verify:
      fixture with `@pi/anthropic-messages`-only probe on npm-absent name is
      flagged with the correct current package + carrying version.
- [x] 3.4 `plugins-bridges.md` — `bridgeLoadedFrom`, `packages[]` vs
      `dashboardPluginBridges`, bridge activation status. → verify:
      dashboardPluginBridges-only bridge flagged misregistered; `waiting_peers`
      reports failing peer.
- [x] 3.5 `build-reload.md` — mode, `dist/client` mtime vs source, reload gap. →
      verify: production + stale dist flagged with build+restart fix; changed
      extension without reload flagged with reload fix.
- [x] 3.6 `install-topology.md` — detect npm-global / Electron / Docker / dev;
      topology-specific fix routing incl. Electron-immutable. → verify: each
      topology fixture yields the matching remediation.
- [x] 3.7 `model-resolution.md` — `model:resolve` handler present, roles +
      preset, `@role` resolvability, pi-flows model-resolve-aware. → verify:
      unresolvable `@role` fixture flagged; missing handler flagged.

## 4. Two-tier self-update

- [x] 4.1 Implement per-module `<module>.knowledge.hash` over each module's
      `derives-from` semantic tokens (peer names, floor, manifest ids), not raw
      bytes. → verify: whitespace-only source change does NOT drift the hash; a
      peer rename DOES.
- [x] 4.2 On run, compare live-hash vs stored-hash per module; mark stale
      authored prose. → verify: fixture drift marks exactly the affected module.
- [x] 4.3 Implement `--regenerate <module>`: re-derive tables, propose prose
      edits for confirmation, never overwrite silently. → verify: regenerate
      updates derived tables and leaves prose changes pending confirmation.

## 5. Distribution + packaging

- [x] 5.1 Ensure `packages/extension/package.json` `files`/`pi` include the new
      `doctor` skill dir. → verify: `npm pack` tarball contains
      `.pi/skills/doctor/**`.
- [x] 5.2 Confirm the skill auto-loads (NL trigger) in a fresh session. →
      verify: fresh session surfaces the doctor skill on a diagnostic prompt.

## 6. Docs + AGENTS.md convention (delegate docs/ writes, caveman style)

- [x] 6.1 Add root `AGENTS.md` convention line: doctor self-derives from live
      sources; never hand-maintain version/name tables. (≤200 chars)
- [x] 6.2 Add a Documentation Update Protocol row mapping each source-of-truth
      change to the module to regenerate (peer rename → `peers`; pi floor bump →
      `pi-resolution`; new install platform → `install-topology`; new
      bridge/plugin slot → `plugins-bridges`).
- [x] 6.3 Add per-file rows for the new `doctor/` skill dir to the nearest
      directory `AGENTS.md` (extension skills tree).
- [x] 6.4 (delegate) Author `docs/doctor-skill.md` topic doc via a
      general-purpose subagent with the caveman-style rule verbatim; add the
      pointer + `docs/AGENTS.md` row.

## 7. Tests + gates

- [x] 7.1 Unit tests for `_lib` resolver + provenance labeller + per-module
      hash. → verify: `npm test` green.
- [x] 7.2 Fixture-driven module tests (one per module, covering its key
      failure-mode from section 3). → verify: each module's flagged/clean cases
      pass.
- [x] 7.3 Router tests: symptom routing, capability run, full sweep + short
      circuit, auto-registration. → verify: all router scenarios pass.
- [x] 7.4 Run the code-quality (Biome) + code-review gates on the diff. →
      verify: `npm run quality:changed` clean; review threads resolved.

## 8. Validate

- [x] 8.1 Manual: reproduce the anthropic name-skew scenario and confirm the
      doctor surfaces it with the correct fix (release cut / local source).
- [x] 8.2 Manual: run doctor with the server down; confirm file-derived report
      + correct labels.
- [x] 8.3 Manual: rename a peer in a scratch source, confirm only `peers.md`
      flags stale and `--regenerate peers` proposes the update.
