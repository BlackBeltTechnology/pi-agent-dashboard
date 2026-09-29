## 1. Dashboard MCP registration

- [ ] 1.1 Write bridge tests: register after token delivery with `exposure:"deferred"` and an `Authorization` header; re-register on re-mint; unregister on revoke; guard when `registerMcpServer` is missing or throws; verify they fail first
- [ ] 1.2 Implement D1 in `packages/extension` (`mcp-token-delivery.ts` + bridge); stop writing `process.env.PI_DASHBOARD_MCP_TOKEN`; verify task 1.1 tests pass and a bash `env` dump in a real session shows no token
- [ ] 1.3 Delete `packages/mcp-server-plugin/src/server/header-command.mjs` and the provisioning write in `provisioning.ts` / `index.ts`; verify `rg -n 'requestHeadersCommand|PI_DASHBOARD_MCP_TOKEN' packages --glob '!**/node_modules/**'` is empty outside tests of the migration
- [ ] 1.4 Implement the D2 one-time removal (signature match, via the mcp-client writer); verify with tests for the provisioned entry, an operator entry, and an unparseable file
- [ ] 1.5 Real-session check: `/mcp` lists `pi-dashboard` as connected, `tool_search` finds a dashboard tool and the call authenticates as that session; verify after a dashboard restart too

## 2. mcp-client rebuild

- [ ] 2.1 Core: two-layer reader (JSONC), trust via `ProjectTrustStore`, whole-entry writer, `enabled` semantics, name validation, pi-shape schema; remove the adapter worker, port, floor and global settings; verify with unit tests for every `mcp-client-config` scenario
- [ ] 2.2 Live state from `pi mcp list --json` via safe-spawn, with timeout and per-cwd cache; verify the "state unknown" fallback with an injected failing runner
- [ ] 2.3 HTTP routes per "HTTP surface for pi MCP config"; remove the global-settings and adapter-verdict routes; verify route tests including project-scope admission
- [ ] 2.4 Client: server list (exposure, state, tool count), editor (transport tabs, exposure select, toolExposure list, JSON fallback), secret masking with `${NAME}` / `!command` shown as-is, discard guard; remove the global settings form and plugin timeout group; verify component tests (react-expert checkpoint)
- [ ] 2.5 Folder surfaces: pill counts, untrusted-folder inactive state, whole-entry override without silent secret copy; verify with the `mcp-client-folder-section` scenario tests
- [ ] 2.6 Remove `pi-mcp-adapter` (and now-unused `ajv` / `strip-json-comments`) from `packages/mcp-client-plugin/package.json` and `requires.piExtensions`; `pnpm install`; verify the plugins index shows no adapter requirement

## 3. apple-tools and shared

- [ ] 3.1 apple-tools: write `mcpServers.iMCP` via the service, preserving `enabled` / `exposure` / `toolExposure`; delete `ensureAdapterPackage` usage and every `settings.json` write; verify the installer tests (idempotent re-run leaves `settings.json` byte-identical)
- [ ] 3.2 Remove `pi-mcp-adapter` from `packages/shared/src/recommended-extensions.ts`; add a doctor row for "pi-mcp-adapter installed → built-in MCP disabled" and "operator `pi-dashboard` entry shadows registration"; verify doctor tests
- [ ] 3.3 Resolve the design Open Question on pi 0.99 (unknown adapter keys) and implement the matching row error text; verify on a real `mcp.json` containing `directTools`

## 4. Verification and docs

- [ ] 4.1 Full suite + an Audit subagent pass on token delivery; fix its findings
- [ ] 4.2 DocScribe: `docs/architecture.md` MCP sections (sequence diagram: registration replaces provisioning; security note updated to "token not in env"); `mcp-client-plugin/README.md`; CHANGELOG **BREAKING** entry (adapter dropped, how to migrate); update `AGENTS.md` rows with `See change: migrate-mcp-to-pi-builtin`; verify `openspec validate migrate-mcp-to-pi-builtin`

## 5. Scenario tests (from test-plan.md)

- [ ] 5.1 L1 test: register after delivery — see `packages/extension/src/__tests__/mcp-token-delivery.test.ts`; fake `registerMcpServer`, token delivered · `mcp_token_minted` · one call with Bearer header and `exposure:"deferred"` (test-plan #E1)
- [ ] 5.2 L1 test: re-mint replaces — same exemplar; token A then B · second delivery · re-registered with B (test-plan #E2)
- [ ] 5.3 L1 test: revoke unregisters — same exemplar; registered · revoke / session end · `unregisterMcpServer("pi-dashboard")` (test-plan #E3)
- [ ] 5.4 L1 test: token not in env — same exemplar; delivered · handler · `PI_DASHBOARD_MCP_TOKEN` undefined (test-plan #E4)
- [ ] 5.5 L1 test: no `mcp.json` write — same exemplar with temp agent dir; registration · file absent or byte-identical (test-plan #E5)
- [ ] 5.6 L1 test: migration of the provisioned entry — see `packages/mcp-client-plugin/src/core/__tests__/config-writer-admission.test.ts`; provisioned + `docs` / operator-shaped / unparseable · startup migration · removed / kept+reported / untouched (test-plan #E6)
- [ ] 5.7 L1 test: no `/mcp` command — see `packages/mcp-server-plugin/src/server/__tests__/dispatch.test.ts` for fake-pi harness; load dashboard extensions · collect commands · no `mcp` (test-plan #E7)
- [ ] 5.8 L1 test: project replaces global — see `packages/mcp-client-plugin/src/core/__tests__/config-writer-admission.test.ts`; both define `docs` · effective view · folder entry exactly (test-plan #E8)
- [ ] 5.9 L1 test: untrusted folder inactive — same exemplar; untrusted project · effective view · inactive with reason (test-plan #E9)
- [ ] 5.10 L1 test: writer siblings / names / transport — same exemplar; save cases · writer · siblings kept, bad name and dual transport refused (test-plan #E10)
- [ ] 5.11 L1 test: enabled semantics — same exemplar; folder disable of global-only, re-enable · writer · full copy `enabled:false`, key removed (test-plan #E11)
- [ ] 5.12 L1 component test: folder override without silent secrets — see `packages/mcp-client-plugin/src/client/__tests__/FolderMcpPage.test.tsx`; global `docs` with auth header · override changing `exposure` · complete entry, header absent, warning shown (test-plan #E12)
- [ ] 5.13 L1 component test: masking vs references — see `packages/mcp-client-plugin/src/client/__tests__/FolderMcpSection.test.tsx`; `${GITHUB_TOKEN}` vs literal · render editor · reference shown, literal masked (test-plan #E13)
- [ ] 5.14 L1 test: `pi mcp list --json` failure — see `packages/mcp-server-plugin/src/server/__tests__/adapter-diagnostic.test.ts` for injected-runner pattern; failing runner · list request · "state unknown" (test-plan #E14)
- [ ] 5.15 L1 test: apple-tools iMCP entry — see `packages/apple-tools/src/__tests__/install.test.ts`; existing iMCP with `enabled`/`exposure`, populated packages · re-run · command refreshed, fields kept, settings byte-identical (test-plan #E15)
- [ ] 5.16 L1 test: registration guard — see `packages/extension/src/__tests__/mcp-token-delivery.test.ts`; missing / throwing API · delivery · one log line, report sent, no throw (test-plan #E16)
- [ ] 5.17 L1 test: no adapter requirement — see `packages/mcp-server-plugin/src/server/__tests__/generated-freshness.test.ts` for manifest-scan pattern; plugins index · read · no `pi-mcp-adapter` (test-plan #E17)
- [ ] 5.18 L3 Playwright: subprocess cannot read token — see `tests/e2e/mcp-token-settings.spec.ts`; harness session · bash `env` · no token (test-plan #X1)
- [ ] 5.19 L3 Playwright: session reaches `/mcp` across restart — see `tests/e2e/mcp-token-settings.spec.ts`; harness session · list + tool_search + call, restart, call again · connected and authenticated (test-plan #X2)
- [ ] 5.20 Manual: doctor explains an installed `pi-mcp-adapter` disabling the built-in (test-plan: manual-only, #X3)
