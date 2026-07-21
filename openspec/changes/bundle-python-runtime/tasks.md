## 1. Verification spike (BLOCKING — before any impl)

- [ ] 1.1 Confirm uv `UV_PYTHON_INSTALL_MIRROR` `file://` layout against real per-triple python-build-standalone tarballs; if layout can't be matched, adopt the self-extract + `uv venv --python <path>` fallback (design D2 / test-plan #9)
- [ ] 1.2 Record the standalone interpreter's per-platform on-disk layout: bindir (`bin` vs `Scripts`/root `python.exe`) and `cacert.pem` path (feeds D8/#10, tasks 3.x/6.x)
- [ ] 1.3 Pin uv version + interpreter version in `_python-version.json` with per-triple sha256

## 2. Build-time bundling

- [ ] 2.1 Add `download-python.mjs` (sha256 verify + extract into `resources/python-dist/`, `resources/uv/`), mirroring `download-git-windows.mjs`
- [ ] 2.2 Wire the download + GO/NO-GO assert block into `bundle-server.mjs` (per-arch, same idiom as node-pty/koffi/git GO/NO-GO)
- [ ] 2.3 Emit `THIRD-PARTY-LICENSE.txt` for uv + python-build-standalone (mirror bundled-git `writeLicense`)

## 3. Runtime source-selection seam

- [ ] 3.1 `select-python-source.ts` — tri-state `pythonSource` truth table, default `bundled` all platforms (mirror `select-git-source.ts`, polarity flipped)
- [ ] 3.2 `resolveVenvBinDir(root)` — `Scripts` on win32 else `bin` (D8)
- [ ] 3.3 `ensure-bundled-python.ts` — SYNC PATH prepend: overlay-when-stamp-matches else bare-interpreter fallback; set `VIRTUAL_ENV` + `SSL_CERT_FILE`→interpreter CA; never await (D5)
- [ ] 3.4 `python-source.ts` — `augmentEnvWithPythonSource` + cached `getActivePythonSource` + `getPythonSourceReadout` (mirror `git-source.ts`)

## 4. Materialization module

- [ ] 4.1 `materializePyEnv()` — eager non-blocking on boot, single-flight memoized promise, atomic tmp/versioned-dir writes (D5)
- [ ] 4.2 `py-base` build: `uv venv --link-mode copy` + `uv pip install --require-hashes -r requirements.txt` (small pinned starter set); UV_* confined to this subprocess only (#12)
- [ ] 4.3 `py-overlay` build: `uv venv --system-site-packages` → py-base; versioned dir `py-overlay-<stamp>/` + repoint-not-rename for Win-safe rebuild (#7)
- [ ] 4.4 `.py-stamp` runtime freshness (interpreter version); mismatch → rebuild base+overlay (distinct from build `.bundle-stamp`, #4)
- [ ] 4.5 Author the small hash-pinned starter `requirements.txt` (G2)

## 5. Config + Doctor + wiring

- [ ] 5.1 Add `pythonSource` to `config.ts` (default `bundled`)
- [ ] 5.2 Wire `augmentEnvWithPythonSource` into BOTH spawn paths — `ToolResolver.buildSpawnEnv` (binary-lookup) and terminal PTY path (mirror git wiring)
- [ ] 5.3 Add `getPythonSourceReadout` to Doctor output

## 6. Tests — edge-case (folded from test-plan.md)

- [ ] 6.1 (test-plan #E1) per-arch bundle content — see `packages/electron/src/__tests__/build-config-parity.test.ts`. Triple: build for triple T · bundle completes · `resources/uv/`+`resources/python-dist/` have T's artifacts and no other triple [electron]
- [ ] 6.2 (test-plan #E2) bare interpreter runnable cold — see `qa/tests/10-bundled-git.sh`. Triple: extracted bundle, no network/materialize · invoke interpreter `--version` · prints version, exit 0, zero network [L2]
- [ ] 6.3 (test-plan #E3) checksum mismatch aborts — see `packages/electron/src/__tests__/docker-make-windows-bundle.test.ts`. Triple: wrong-sha256 tarball · download+verify · abort pre-extract, exit≠0 [L1]
- [ ] 6.4 (test-plan #E4) GO/NO-GO missing triple — see `packages/electron/src/__tests__/build-config-parity.test.ts`. Triple: bundle missing required triple · GO/NO-GO · exit≠0 names triple [L1]
- [ ] 6.5 (test-plan #E5) default=bundled all platforms — see `packages/shared/src/__tests__/platform-git.test.ts`. Triple: `pythonSource` unset, {darwin,linux,win32} · `selectPythonSource()` · `bundled` on all three [L1]
- [ ] 6.6 (test-plan #E6) host opt-in — see `packages/shared/src/__tests__/platform-git.test.ts`. Triple: `pythonSource=host`, host python present · `selectPythonSource()` · `host`, no bundled prepend [L1]
- [ ] 6.7 (test-plan #E7) per-platform bindir — see `packages/shared/src/__tests__/ensure-bundled-git.test.ts`. Triple: root R, win32 vs posix · `resolveVenvBinDir(R)` · `R/Scripts` vs `R/bin` [L1]
- [ ] 6.8 (test-plan #E8) THIRD-PARTY license present — see `packages/electron/src/__tests__/build-config-parity.test.ts`. Triple: python bundled · inspect tree · license covers uv+pbs [electron]
- [ ] 6.9 (test-plan #E9) Doctor readout — see `packages/shared/src/__tests__/platform-git.test.ts`. Triple: bundled python active · `getPythonSourceReadout()` · reports version/stamp/baseline/pip-reachability [L1]

## 7. Tests — state / lifecycle (folded)

- [ ] 7.1 (test-plan #F1) sync inject + bare fallback — see `packages/shared/src/__tests__/ensure-bundled-git.test.ts`. Triple: overlay absent · `augmentEnvWithPythonSource(env)` · PATH←bare bindir, trigger fired, returns synchronously [L1]
- [ ] 7.2 (test-plan #F2) ready overlay preferred — same exemplar. Triple: overlay exists, stamp matches · augment · PATH←overlay bindir, `VIRTUAL_ENV`=overlay [L1]
- [ ] 7.3 (test-plan #F3) stale overlay rejected — same exemplar. Triple: overlay exists, stamp≠version · augment · PATH←bare (not stale overlay), rebuild triggered [L1]
- [ ] 7.4 (test-plan #F4) both spawn paths injected — see `packages/shared/src/tool-registry/__tests__/bundled-git-bash-strategy.test.ts`. Triple: session via buildSpawnEnv + terminal via PTY · spawn each · both child envs have python bindir on PATH [L1]
- [ ] 7.5 (test-plan #F5) stamp mismatch → rebuild — see `packages/shared/src/__tests__/ensure-bundled-git.test.ts`. Triple: `.py-stamp`≠version · materialize decision · base+overlay marked rebuild [L1]
- [ ] 7.6 (test-plan #F6) overlay persists across restart — see `qa/tests/10-bundled-git.sh`. Triple: pkg in overlay, version unchanged · server restart · pkg still importable [L2]
- [ ] 7.7 (test-plan #F7) no UV_* leak; SSL_CERT_FILE set — see `packages/shared/src/tool-registry/__tests__/bundled-git-bash-strategy.test.ts`. Triple: injection active · inspect child env · no `UV_*`, `SSL_CERT_FILE`→interp CA [L1]
- [ ] 7.8 (test-plan #F8) single-flight materialize — new unit; see `packages/shared/src/__tests__/ensure-bundled-git.test.ts` for harness glue. Triple: N concurrent triggers · fire before completion · exactly one build, same result [L1]
- [ ] 7.9 (test-plan #F9) torn build never visible — same exemplar. Triple: materialize interrupted mid-build · seam resolves env · partial env never selected (atomic visibility) [L1]

## 8. Tests — error-handling (folded)

- [ ] 8.1 (test-plan #X1) offline pip passthrough — see `qa/tests/10-bundled-git.sh`. Triple: no network, pkg uncached · agent `pip install <pkg>` · pip's own non-zero exit+stderr verbatim; `python x.py` (stdlib+baseline) exits 0 [L2]
- [ ] 8.2 (test-plan #X2) Win rebuild vs live install — see `qa/tests/10-bundled-git.ps1`. Triple: win32, agent holds overlay handles · stamp-triggered rebuild · new versioned overlay, no EACCES/EBUSY, later spawns resolve new [L2]
- [ ] 8.3 (test-plan #X3) baseline not corrupted — see `qa/tests/10-bundled-git.sh`. Triple: agent installs arbitrary pkg · `pip install` · pkg in overlay, `py-base` byte-identical [L2]
- [ ] 8.4 (test-plan #X4) nuke+rebuild restores baseline — same exemplar. Triple: delete base+overlay, network/warm-cache · re-run materialize · pinned starter baseline restored [L2]
- [ ] 8.5 (test-plan #X5) offline interpreter install — same exemplar. Triple: no network, interp in resources · run materialize (resolved mechanism) · venv created, zero network for interp step [L2]
- [ ] 8.6 (test-plan #X6) pip uses interpreter CA store — see `packages/shared/src/tool-registry/__tests__/bundled-git-bash-strategy.test.ts`. Triple: injection active · inspect env for `python -m pip` · `SSL_CERT_FILE`→interpreter CA bundle [L1]
