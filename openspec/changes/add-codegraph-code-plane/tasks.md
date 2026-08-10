## 1. Package scaffolding

- [ ] 1.1 Create `packages/codegraph-driver` (package.json: name, `type: module`, no pi deps; tsconfig; vitest config) mirroring kb package conventions.
- [ ] 1.2 Create `packages/codegraph-extension` (package.json with `pi.extensions: ["src/extension.ts"]`, peerDeps on the pi agent like kb-extension; depends on `codegraph-driver`).
- [ ] 1.3 Create `packages/codegraph-plugin` (package.json mirroring kb-plugin: `server/`, `client/`, `shared/`, `i18n.ts`; depends on `codegraph-driver`).
- [ ] 1.4 Add `AGENTS.md` DOX row per new directory; register the three packages in the workspace (root package-lock / workspaces) and confirm `npm install` resolves them.

## 2. codegraph-driver (pure CLI adapter)

- [ ] 2.1 Implement `presence(cwd)` → `{ binaryOnPath, indexed }` (PATH probe for `codegraph`; existence check for `<cwd>/.codegraph/`). Verify: unit test with binary present/absent and index present/absent.
- [ ] 2.2 Implement spawn helper: argument-vector only (no shell string), `CODEGRAPH_NO_DAEMON=1` in env, bounded timeout, returns typed `{ ok, json } | { unavailable, reason }` — never throws. Verify: test that shell metacharacters in query cannot alter the command.
- [ ] 2.3 Implement `init(cwd)`, `sync(cwd)`, `index(cwd, {force})` wrappers over the spawn helper. Verify: unit tests assert correct argv per command.
- [ ] 2.4 Implement `status(cwd)` → parse `codegraph status --json` into a typed health/freshness struct. Verify: fixture-JSON parse test + graceful handling of missing/malformed output.
- [ ] 2.5 Implement `explore(cwd, query)` → run `codegraph explore <query>` (JSON), return passthrough result or `{ unavailable }`. Verify: fixture-JSON passthrough test.
- [ ] 2.6 Export the driver surface from the package barrel; ensure zero pi imports (add a test/lint asserting no `@earendil-works` import in driver src).
- [ ] 2.7 Implement `resolveBinary(cwd)` ladder: (1) `CODEGRAPH_BIN` env/config, (2) bundled `<process.resourcesPath>/codegraph/<exe>` with dev fallback, (3) system PATH probe, (4) self-installed path, (5) none → `{ unavailable, installHint }`. Verify: unit tests for each rung's precedence.
- [ ] 2.8 Implement `installViaNpm({ pin })` → run `npm install -g @colbymchenry/codegraph@<pin>` (prefer bundled node/npm when present), then re-probe. Verify: argv test; missing-npm → typed unavailable, no throw.

## 3. codegraph-extension (pi tool + lifecycle)

- [ ] 3.1 Register the `codegraph_explore` native tool via `pi.registerTool` (input: query; description that routes code-structure/who-calls/blast-radius questions here). Verify: tool listed; returns driver result.
- [ ] 3.2 Cold-start guard: on first `codegraph_explore` in a cwd with no `.codegraph/`, run driver `init(cwd)` once, then serve (mirror kb `ensurePopulated`, guarded try/catch → degrade). Verify: test cold cwd triggers init exactly once.
- [ ] 3.3 Graceful degradation: binary absent or index absent → tool returns clean "use built-in tools" guidance, never errors. Verify: tests for both absent cases.
- [ ] 3.4 Own debounced `tool_result` write-hook: non-`.md` source writes schedule a per-cwd debounced `sync(cwd)`; coalesce overlapping runs (clone kb-extension reindex debounce/inflight structure). Verify: debounce + coalesce unit tests; `.md` writes do NOT trigger codegraph sync.
- [ ] 3.5 Per-cwd state map + cleanup on cwd removal (mirror kb-extension eviction). Verify: removed cwd is a safe no-op.
- [ ] 3.6 Extract pure lifecycle logic into a no-pi-imports module (like `reindex.ts`) for testability; wire it in `extension.ts`.

## 4. Discovery guidance

- [ ] 4.1 Add a root `AGENTS.md` docs-first gate row: code-structure / "who calls X" / blast-radius → `codegraph_explore`; docs / "where documented" → `kb_search`. Verify: row present, symmetric with existing kb rows.

## 5. codegraph-plugin (dashboard UI + server API)

- [ ] 5.1 Server: `codegraph-routes.ts` folder-scoped endpoints (status/health, init, sync, index) using the base64url cwd codec pattern from kb-plugin; call through `codegraph-driver`. Verify: route tests (present/absent binary).
- [ ] 5.2 Server: long-running `init`/`index` run through a job-registry (clone kb-plugin `job-registry.ts`) so the UI can poll progress. Verify: job lifecycle test.
- [ ] 5.3 Client: `codegraph-api.ts` thin REST client + shared types. Verify: api client tests mirroring kb-api tests.
- [ ] 5.4 Client: `CodegraphSettingsPanel.tsx` + `useCodegraphStats` — show binary-present state, per-worktree index freshness, force-reindex control; install hint when binary absent. Verify: component tests for present/absent/stale states.
- [ ] 5.5 Register the plugin's contributions with the dashboard (mirror kb-plugin registration); confirm the panel renders in settings.

## 6. Electron bundling + install fallback (delivered method)

- [ ] 6.1 Add `scripts/download-codegraph.mjs` mirroring `download-git-windows.mjs`: read pinned `_codegraph-version.json` (tag + per-arch sha256), resolve `npm_config_target_arch`/`TARGET_ARCH`/`process.arch`, download + verify into `resources/codegraph/`. Verify: script fetches+verifies for a supported arch; skips (no error) for a target with no published prebuilt.
- [ ] 6.2 Add `resources/codegraph/` as an `extraResource` in `forge.config.ts` ("when present", like `./resources/git`); wire the download step into the electron build. Verify: packaged app contains the binary under `resourcesPath/codegraph` for a supported target.
- [ ] 6.3 Runtime bundled resolution: driver rung 2 reads `process.resourcesPath` (packaged) with a repo-relative dev fallback (mirror `resolveLoadingPagePath`). Verify: packaged smoke resolves the bundled binary; dev resolves the fallback.
- [ ] 6.4 Plugin install action: a `CodegraphSettingsPanel` "Install CodeGraph" button → server route calls driver `installViaNpm`, then re-probes and updates the panel. Verify: route test (install invoked, state refreshed); button hidden when a binary already resolves.

## 7. Docker peer-binary carry (opt-in)

- [ ] 7.1 Add `ARG CODEGRAPH_ENABLED=0` to `docker/Dockerfile`; when enabled, install a pinned `codegraph` (via `npm install -g @colbymchenry/codegraph@<pin>` or zrok-style pinned tarball + sha256 — resolve per Open Question) and run `codegraph telemetry off`. Verify: image builds with flag on/off; `codegraph version` succeeds when on.
- [ ] 7.2 Ensure `.codegraph/` is gitignored and persists in the workspace mount (no extra VOLUME). Document env/flags in `docker/README.md`. Verify: index survives container restart.
- [ ] 7.3 Reconcile CodeGraph's outbound telemetry endpoint with `add-universal-network-guard` posture (telemetry disabled + endpoint noted). Verify: no outbound telemetry from the built image.

## 8. Docs, deprecation, validation

- [ ] 8.1 Confirm `add-kb-code-symbol-index` SUPERSEDED banner is in place (do-not-implement). Verify: banner present.
- [ ] 8.2 Delegate `docs/` prose (architecture pointer for the code plane / two-plane model) to DocScribe in caveman style; add per-directory `AGENTS.md` rows for new files. Verify: `kb dox lint` clean for the new dirs.
- [ ] 8.3 Full validation: `openspec validate add-codegraph-code-plane`, `npm test` for the three new packages, and a manual `codegraph_explore` smoke against a repo with a `.codegraph/` index. Verify: all green.

## 9. Scenarios (from scenario-design / test plan)

- [ ] 9.1 Code-structure query returns CodeGraph result; kb store/tools not invoked.
- [ ] 9.2 Query text with shell metacharacters cannot inject (argv-only spawn).
- [ ] 9.3 Cold-start builds the index on first explore (init once).
- [ ] 9.4 Source-file write triggers a debounced sync; `.md` write does not.
- [ ] 9.5 Watcher daemon is not spawned (`CODEGRAPH_NO_DAEMON=1`).
- [ ] 9.6 Each worktree owns its own `.codegraph/` index; `.codegraph/` gitignored.
- [ ] 9.7 Binary absent → tool returns built-in-tools guidance, no error.
- [ ] 9.8 No index for cwd → guidance, no error.
- [ ] 9.9 Docs-first guidance row present and symmetric.
- [ ] 9.10 Panel shows presence + per-worktree freshness; degrades to install hint when binary absent.
- [ ] 9.11 `packages/kb` and `packages/kb-extension` unmodified; new packages have no kb dependency.
- [ ] 9.12 Resolution ladder: bundled preferred over PATH; PATH used when unbundled; override wins over both.
- [ ] 9.13 Install action runs `npm install -g` and re-probes; panel reflects new presence.
- [ ] 9.14 Electron build bundles a per-arch binary as extraResource for a supported target; unsupported target ships no bundle.
