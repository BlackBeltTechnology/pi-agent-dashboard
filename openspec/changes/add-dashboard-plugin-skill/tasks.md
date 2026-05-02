## 1. Skill package scaffolding

- [ ] 1.1 Create `packages/dashboard-plugin-skill/package.json` with `name: @blackbelt-technology/pi-dashboard-plugin-skill`, `private: false`, and a `pi.skills` declaration pointing at `skills/dashboard-plugin-scaffold/SKILL.md`.
- [ ] 1.2 Add the package to the workspace root `package.json` `workspaces` array.
- [ ] 1.3 Add a stub `vitest.config.ts` and `tsconfig.json` that mirror `packages/dashboard-plugin-runtime/`.
- [ ] 1.4 Add `packages/dashboard-plugin-skill/README.md` describing how to install (`npm i -g @blackbelt-technology/pi-dashboard-plugin-skill`) and how to invoke from a pi session.

## 2. Skill markdown

- [ ] 2.1 Author `skills/dashboard-plugin-scaffold/SKILL.md` with the hybrid contract: the up-front `ask_user` batch, the mode branch, and the prescriptive steps for each mode.
- [ ] 2.2 Author `references/slot-taxonomy.md` covering all 10 React slot ids: when to use, prop contract, multiplicity, ordering rules, example snippet.
- [ ] 2.3 Author `references/manifest-schema.md` mirroring `dashboard-plugin-loader/spec.md` Requirement 1 (the canonical schema).
- [ ] 2.4 Author `references/plugin-context-api.md` documenting the public exports of `@blackbelt-technology/dashboard-plugin-runtime/context` (the de-facto client SDK).
- [ ] 2.5 Author `references/server-context-api.md` documenting the `ServerPluginContext` from `dashboard-plugin-loader/spec.md` Requirement 3.
- [ ] 2.6 Author `references/tui-to-dashboard-mapping.md` with the canonical mapping table (from this proposal's design.md §"TUI → dashboard mapping").
- [ ] 2.7 Author `references/build-integration.md` summarising the Vite plugin behavior, dev vs prod fixture filtering, and tree-shaking.

## 3. Templates (mode `new`)

- [ ] 3.1 `templates/plugin-package.json.tmpl` with a `pi-dashboard-plugin` manifest, `requiredApi: "^0.x"`, and placeholder `{{ id }}` / `{{ displayName }}` / `{{ priority }}` / `{{ claims }}`.
- [ ] 3.2 `templates/client.tsx.tmpl` with one section per slot id, each commented with the prop contract and a TODO marker. The renderer keeps only sections matching the user's `multiselect`.
- [ ] 3.3 `templates/server-index.ts.tmpl` exporting a default `registerPlugin(ctx)` with example REST route + WS handler scaffolds.
- [ ] 3.4 `templates/bridge-index.ts.tmpl` exporting a stub pi-extension entry. (Only emitted when the user opts in.)
- [ ] 3.5 `templates/configSchema.json.tmpl` — empty JSON Schema 7 object with a `$schema` header.
- [ ] 3.6 `templates/tsconfig.json.tmpl` matching the conventions in `packages/dashboard-plugin-runtime/tsconfig.json`.
- [ ] 3.7 `templates/vitest.config.ts.tmpl` matching the conventions in `packages/dashboard-plugin-runtime/vitest.config.ts`.
- [ ] 3.8 `templates/README.md.tmpl` summarising the plugin's claims and how to develop it.
- [ ] 3.9 `templates/test/index.test.ts.tmpl` with one assertion per claim type, using vitest.

## 4. Scripts

- [ ] 4.1 `scripts/grep-tui-surface.sh` — runs the grep prelude (`ctx.ui.*`, `pi.registerTool`, `registerExtensionUI`, session-replacement bans) and emits a JSON callsite list.
- [ ] 4.2 `scripts/register-workspace.sh` — idempotently adds `packages/<id>-plugin` to the root `package.json#workspaces` array, atomic write via tmp+rename.

## 5. Mode `new` flow tests

- [ ] 5.1 Vitest test that drives the templates with a synthetic answer set (id: `acme`, slots: `["settings-section","tool-renderer"]`, server: true, bridge: false) and snapshot-asserts the resulting tree matches a fixture in `__fixtures__/new-acme/`.
- [ ] 5.2 Vitest test that drives the templates with **all 10 slots** selected and asserts every slot stub is present in `client.tsx`.
- [ ] 5.3 Vitest test asserting the generated `package.json#pi-dashboard-plugin` validates against the manifest schema in `packages/dashboard-plugin-runtime/src/manifest-validator.ts`.

## 6. Mode `augment` flow tests

- [ ] 6.1 Vitest test that runs `grep-tui-surface.sh` against a fixture pi-extension repo (`__fixtures__/sample-extension/`) containing one `ctx.ui.select`, one `ctx.ui.custom`, and one `pi.registerTool` callsite. Asserts the JSON output names all three.
- [ ] 6.2 Vitest test that takes a synthetic per-callsite confirmation set, runs the manifest-injection step, and asserts the resulting `package.json#pi-dashboard-plugin` matches a fixture.
- [ ] 6.3 Vitest test asserting the augmented manifest satisfies the forward-compat contract (items 1-5 in design.md §"Forward-compat contract"). This is the contract test.

## 7. Documentation updates

- [ ] 7.1 Add the new package to `AGENTS.md` Key Files table.
- [ ] 7.2 Add an "Authoring a dashboard plugin" section to `README.md` pointing at the skill.
- [ ] 7.3 Add a paragraph to `docs/architecture.md`'s plugin-architecture section noting the skill is the canonical on-ramp.
- [ ] 7.4 Cross-link from `packages/demo-plugin/README.md` to the skill (the demo is what the skill produces).

## 8. Publishing

- [ ] 8.1 Confirm `packages/dashboard-plugin-skill/package.json` declares `repository`, `license`, and a populated `files` array (so the npm tarball includes `skills/`, `templates/`, `references/`, `scripts/`, but not test fixtures).
- [ ] 8.2 Add the package to the publish workflow's per-package list (so `release-cut` picks it up after sub-packages and before the root metapackage).
- [ ] 8.3 First publish of the skill is gated on at least Mode `new` flow tests passing and a manual end-to-end run that scaffolds a real `packages/test-acme-plugin/` and verifies it loads in the dashboard.
