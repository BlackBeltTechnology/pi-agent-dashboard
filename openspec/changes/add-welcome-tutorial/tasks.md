## 0. Prerequisites & spikes

- [ ] 0.1 Confirm `fix-trusted-network-tunnel-bypass` status; remote-access chapter stays hidden until it ships (feature check in status snapshot)
- [ ] 0.2 Spike: render `FolderKbSection`, roles settings panel, `SessionCard`, an `ask_user` card standalone in an opaque-origin frame under a draft `SpecimenProvider`; record which components need refactoring or fall back to shots (update design D7)
- [ ] 0.3 Spike: single-file Vite React build set as `srcdoc` of a `sandbox="allow-scripts"` frame; `asset` verb round-trip (parent fetch → ArrayBuffer → frame blob URL) for a WebP shot; verify through a tunnel with a paired-device bearer and with the OAuth cookie, not only locally

## 1. Folder home marker (server)

- [ ] 1.1 Tests: marker validation (valid, malformed, escaping entry, symlink out, unknown cwd), dirId issuance, file route (content types, traversal incl. encoded, unknown dirId 404, GET/HEAD only, no `Origin: null` CORS allowance, unauthenticated tunnel request denied by the network guard, namespace-coverage test still green)
- [ ] 1.2 Marker read endpoint + opaque dirId registry for pinned ∪ workspace folders
- [ ] 1.3 `GET /api/home/:dirId/*` via `lib/path-containment.ts` (inside guard jurisdiction; never a top-level `/home/` prefix)

## 2. Home frame + bridge (client)

- [ ] 2.1 Tests: `/folder/:cwd` marker present/absent/invalid/deeper routes; sandbox attributes; bridge accepts only matching `event.source` + `pi:"home"` + `v:1` + schema + tier verb; rejection logging dedupe; other-tier label; spawn confirm
- [ ] 2.2 `HomeFrame` component: parent-authenticated fetch of the entry → `srcdoc`, `{lang}`/fallback resolution, optional compact prompt
- [ ] 2.2b Bridge `asset {path}` verb: path confinement, size cap, ArrayBuffer transfer; SDK `<Shot>` uses it
- [ ] 2.3 Bridge dispatcher (navigate allowlist, openDialog ids, spawn, applyRolePreset prefill, refreshShots)
- [ ] 2.4 Parent → frame `theme`/`lang` push (initial + on change), `status` snapshot builder with field allowlist (first-party only); test that URLs/tokens/paths never appear
- [ ] 2.5 Trust tier resolution (welcome dir + copy-manifest hash)

## 3. Welcome package & SDK

- [ ] 3.1 `packages/welcome` scaffold (Vite React, single-file output per language), register in workspace + add-new-plugin-package checklist items that apply
- [ ] 3.2 Home SDK: `useDashboardTheme`, `useDashboardLang`, `useDashboardStatus`, `<DashLink>`, `spawn`, `<Pop>`, `<Shot>`, `<Specimen>`, in-memory storage, mock bridge (`?mock=1`)
- [ ] 3.3 i18n catalog `en` (source), `hu`, `zh-CN`; key-parity test
- [ ] 3.4 Content: Welcome & Anatomy (A–L parts)
- [ ] 3.5 Content: Connect a provider
- [ ] 3.6 Content: Model roles — size classes, per-role hints, presets resolver (hard requirements, cost bands, family ≠ rule) with unit tests; link to Models ▸ Model roles when `promote-model-roles-settings` is present
- [ ] 3.7 Content: Start your first project — folder creation, Initialize, each project-init question + what it writes
- [ ] 3.8 Content: Knowledge base & DOX (layers, knowledge_base.json, KB row states, `/folder/:cwd/kb`, `kb dox init`, dox-describe, read/write discipline, doctrine toggles)
- [ ] 3.9 Content: Chat & controlling agents; Extensions & plugins (packages, plugin catalog, per-folder resources, MCP, write your own plugin)
- [ ] 3.10 Content: Everyday features (editor, terminal, live preview, git/worktrees, automations, goals, flows, OpenSpec)
- [ ] 3.11 Content: Use it from anywhere (paths, zrok install/enable/reserve, safety step with `trustedHasLoopback`, QR pairing + compare-code, copy-string pairing, devices, troubleshooting)
- [ ] 3.12 Content: Troubleshooting (doctor, health, FAQ links)
- [ ] 3.13 Plugin-gated sections render enable notice

## 4. Ship, copy, pin once (server)

- [ ] 4.1 Tests: first boot copy, upgrade overwrite, same-version no-op, user shots preserved unless manifest version changed, atomic replace
- [ ] 4.2 `build:welcome` wired into the server package build; `version.json`
- [ ] 4.3 Boot copy-on-version into `~/.pi/dashboard/welcome`
- [ ] 4.4 Tests + impl: `welcomeSeeded` one-time pin in `preferences-store.ts` (existing installs with `pinSeeded`, permanent unpin)
- [ ] 4.5 Exempt welcome dir from Initialize / OpenSpec-init offers

## 5. Capture + specimen builder

- [ ] 5.1 Add `data-tour` anchors to shell/session/settings/plugin components referenced by anatomy + manifest
- [ ] 5.2 `SpecimenProvider` (mock WS store, typed mock API, in-memory storage, theme, i18n); specimen fixtures typed from shared API types
- [ ] 5.3 Specimens: provider list, Model roles rows, KB row + settings, session card, composer, directory card, pairing dialog, project-init `ask_user` cards
- [ ] 5.4 Shot manifest + fixture HOME (recorded pi session JSONL, git repo + worktree, enabled plugins, scratch root) on the docker test harness
- [ ] 5.5 Playwright capture: `lang × {light,dark}`, frozen clock, animations off, masks, network stubs, WebP crops
- [ ] 5.6 Lint gates: figure ids ↔ manifest, anchors exist, i18n parity, forbidden imports (monaco-editor, xterm, mermaid), per-chapter chunk size budget
- [ ] 5.7 CI job path-filtered on `packages/client/**` + `packages/welcome/**`: capture + pixel diff vs baseline → warning annotation + artifact (non-blocking)
- [ ] 5.8 Runtime "Refresh screenshots" + "Reset to shipped" (Playwright or `agent-browser` detection; notice when absent)
- [ ] 5.9 Replace the dangling root `npm run screenshots` script with the welcome capture command

## 6. Verification

- [ ] 6.1 `npm test` green; `Audit` subagent on bridge + static route; `review-code` pass
- [ ] 6.2 Manual: fresh HOME → welcome pinned + rendered; unpin → stays unpinned after restart; theme + language switch live; third-party marker dir shows label and confirm-on-spawn
- [ ] 6.3 Rebuild matrix: server restart, client build + restart, full rebuild

## 7. Docs

- [ ] 7.1 `docs/faq.md`: marker home format, welcome tutorial, refresh screenshots (DocScribe)
- [ ] 7.2 `docs/architecture.md`: home frame + bridge protocol v1 section (DocScribe)
- [ ] 7.3 AGENTS.md rows for new/changed files; `packages/welcome/AGENTS.md`
- [ ] 7.4 README: link to the tutorial; CHANGELOG `[Unreleased]`
