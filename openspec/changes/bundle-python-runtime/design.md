## Context

The dashboard ships an Electron bundle that already embeds two runtimes:

- **git+sh** — `download-git-windows.mjs` → `resources/git/` (Windows-only, dugite-native, sha256-verified, GO/NO-GO asserted in `bundle-server.mjs`). Exposed at runtime by `ensureBundledGitOnPath` (pure `PATH` prepend), selected by `select-git-source.ts` (`windowsGitSource: auto|host|bundled`), wired into the spawn-env by `augmentEnvWithGitSource` ("the single call wired into the spawn-env path"), surfaced by `getGitSourceReadout` in Doctor.
- **Node** — `download-node.sh` → `resources/node/`.

Agents (and the bash tool calls they issue) now need a Python interpreter with runtime `pip install`. Host Python is absent/old/unpredictable on all three platforms. This change bundles a Python env by **reusing** the git/node build-time and runtime seams — but it is not a pure clone. A doubt-review (single-model + cross-model GLM) established four honest divergences from the git twin that the design must own explicitly:

1. **All-platform, not win32-only.** The git seam no-ops off Windows (`ensureBundledGitOnPath` returns early when `platform !== "win32"`; `selectGitSource` → `"host"`; `getGitSourceReadout` → `null`). Python is *active on all platforms* (D6), so the shared spawn-env chokepoint gains real non-Windows behavior — a change to that chokepoint, not a clone.
2. **Sync-inject with async materialization.** The git seam is a pure synchronous PATH prepend. Python needs a venv built by a subprocess (async). The inject seam MUST stay synchronous (D5); materialization is decoupled and never awaited inside it.
3. **New runtime-staleness mechanism.** `bundle-server.mjs`'s `.bundle-stamp` is a *build-skip* marker consumed by `build-installer.sh` — NOT a runtime rebuild trigger. The venv freshness stamp (D5) is a genuinely new runtime mechanism, only idiomatically similar (a version tag that forces a rebuild).
4. **Extra env surface.** git injects only `PATH`/`GIT_EXEC_PATH`/`SSL_CERT_FILE`. Python's `UV_*` vars are confined to the materialize subprocess (D2/D12), not the general spawn env — the spawn seam injects only `PATH` (+ `VIRTUAL_ENV`).

Only `materializePyEnv` is a wholly new module; the four divergences above are modifications to shared behavior, stated here so no reader mistakes them for free clones.

## Goals / Non-Goals

**Goals**
- Bundled, pip-capable Python env on `PATH` for arbitrary bash/tool calls, all platforms.
- Offline interpreter bootstrap (env materializes with no network); packages need network (graceful degradation).
- Reproducible, hash-pinned baseline; agent-writable overlay that never corrupts the baseline.
- Reuse the existing build-time (download+sha256+GO/NO-GO) and runtime (spawn-env PATH-inject) seams.

**Non-Goals**
- Shipping a pre-built/relocatable venv (rejected — see Decisions).
- A wheelhouse / air-gapped package availability (Tier 3 out of scope).
- A bespoke Python sandbox or Python-specific approval flow (defers to `add-supervised-tool-approval`).
- Preferring host Python (host is opt-in only).

## Decisions

### D1 — Ship the interpreter, materialize the venv locally (Option C), not a pre-built venv
A venv is **not relocatable**: `pyvenv.cfg home=` is an absolute path to the base interpreter, POSIX `bin/python` is a symlink, and console-script shebangs / Windows `.exe` launchers embed the build-time absolute path. Only `site-packages` moves cleanly. Shipping a venv would require an extract-time path rewriter (feasible — `bundle-server.mjs` already rewrites absolute symlink paths post-`cpSync` — but fragile per-OS).
**Chosen:** ship the relocatable `python-build-standalone` interpreter, create the venv on the user's machine where every path is written correctly. Also required because extracted `resources/` is read-only and the requirement is runtime pip-install (needs a writable venv under `~/.pi-dashboard/`).
**Alternatives:** (B) ship venv + extract-time rewriter — rejected as fragile; (hybrid) ship a wheelhouse — deferred (Tier 3).

### D2 — `uv` over hand-rolled `venv` + `pip`
`python-build-standalone` is an Astral project; `uv` is the same vendor's front-end for exactly that artifact (`uv python install` pulls from python-build-standalone). Running `pip` against an Astral interpreter mixes toolchains.
**uv dissolves two of the worst problems:**
- First-run latency → CoW/hardlink from a global content-addressed cache (vs pip download+build).
- Supply chain → `--require-hashes` native.

**Offline interpreter — INTENDED path, gated on a spike (see Open Questions #9).** The plan targets `UV_PYTHON_INSTALL_MIRROR=file://…resources/python-dist` so uv installs the interpreter from local disk (`--offline`/`--no-python-downloads`). **This is unverified:** uv's managed-python download expects a specific release-feed directory layout + manifest (the python-build-standalone feed shape), not arbitrary per-arch tarballs dropped in a dir. A **verification spike is a blocking task** before committing to `file://`; the fallback (if the mirror layout can't be matched) is to extract the tarball ourselves and point uv at the interpreter via `uv venv --python <extracted-path>`, bypassing the mirror entirely. Either way the interpreter bootstrap stays offline.

**Certs — NOT a blanket no-op (corrected).** uv's bundled Mozilla roots cover *uv's own* HTTPS. But an agent running `python -m pip install foo` uses **CPython's `ssl`/CA store** inside the python-build-standalone interpreter (which bundles its own certs at a version-specific path), not uv's. So online `pip install` can still hit a cert failure — the same class the git `SSL_CERT_FILE` dance fixed. Mitigation: the materialize step and the spawn seam set the interpreter's CA path (`SSL_CERT_FILE`/`PIP_CERT` → the standalone interpreter's bundled `cacert.pem`, resolved at materialize time). Tracked as a risk + task.

**Env scoping (corrected, #12).** `UV_*` vars (`UV_PYTHON_INSTALL_MIRROR`, `UV_CACHE_DIR`, `UV_MANAGED_PYTHON`, `UV_OFFLINE`, `UV_NO_CONFIG`) are passed ONLY to the `materializePyEnv` subprocess invocation — never merged into the general spawn env, or they'd leak into every child (pi sessions, terminals) and `UV_NO_CONFIG` would suppress host uv config globally. The spawn seam injects only `PATH` (+ `VIRTUAL_ENV`, + `SSL_CERT_FILE` for the interpreter).

**Cost:** one more bundled binary (~30-40 MB) + a dependency on Astral resolver semantics + cache↔env coupling (see Risks).
**Alternative:** hand-rolled `venv`+`pip` (zero new dep, clones git/node muscle) — rejected: slower first-run, offline requires a manual wheelhouse dance, you re-wire `--require-hashes` and certs yourself.

### D3 — Tier 2 bundle shape (uv + per-arch interpreter tarball, no wheelhouse)
Each installer ships only its **own triple's** tarball (the build matrix already fans out `darwin-arm64/darwin-x64/linux-x64/win32-x64` — same triples as the node-pty GO/NO-GO), so Tier 2 = one ~40 MB tarball per installer, not six. Tier 2 fixes the scary failure mode (offline user can still bootstrap the interpreter + venv; only `pip install` degrades). Tier 3 (wheelhouse) explodes on scientific wheels (numpy/pandas/pyarrow, per-platform) and cannot cover arbitrary agent installs anyway.

### D4 — `py-base` (copy) + `py-overlay` (clone), overlay on PATH
```
~/.pi-dashboard/
├── uv-cache/     UV_CACHE_DIR (your dir; survives app updates; off ~/.cache cleaner radar)
├── py-base/      --link-mode copy · hash-pinned requirements.txt · pristine baseline
└── py-overlay/   --system-site-packages → py-base · agent-writable · PREPENDED to PATH
```
Prepending the **overlay** (not the base) means agent `pip install X` lands in the overlay, base stays pristine, and nuke-overlay restores a known-good baseline. Base uses `copy`, overlay uses `clone` (fast, disposable). Co-locate `uv-cache` + `py-*` under one dir → same-volume rule for clone/hardlink holds (Windows cross-drive hardlink otherwise falls back to copy).

**Corrected claim (#6): "cache-independent" means survives cache *eviction*, NOT offline *rebuild*.** `--link-mode copy` makes the *already-materialized* `py-base` files independent of the cache — a `uv cache clean` cannot break an existing base. But **rebuilding** `py-base` after a nuke re-runs `uv pip install`, which in Tier 2 needs the wheels either in a warm `UV_CACHE_DIR` or from the network. So: existing base survives cache wipe ✓; nuke+rebuild of base is **online-or-warm-cache only** in Tier 2 (fully-offline base rebuild would require the Tier-3 wheelhouse, out of scope). This is an explicit non-goal, not an oversight.

**Overlay reset cadence (decided, #8): persist until interpreter version bump.** The overlay is NOT reset per-session or per-boot; agent installs accumulate and a later session inherits a prior session's overlay packages. Accepted trade-off: convenience over per-session clean-state. Contract 3 (baseline never corrupts) is still satisfied because installs land in the overlay, never `py-base`; a version bump (D5 stamp mismatch) nukes+rebuilds both. Explicit `pythonSource`-reset or a Doctor "reset env" action is the manual escape hatch.

### D5 — Sync inject with bare-interpreter fallback + decoupled background materialization
**(Rewritten after doubt-review found the original "first call awaits the promise" model architecturally impossible — #1/#3/#5.)**

The original design said boot fires `materializePyEnv()` and "the first python/bash call awaits the same memoized promise." **This cannot work:** the spawn-env inject point (`augmentEnvWithGitSource`'s twin) is called *synchronously* inside `ToolResolver.buildSpawnEnv` (`binary-lookup.ts:508`) and `terminal-manager.ts:131` — and the child that runs `python` is a *separate process* handed a frozen `env` snapshot, with no handle to any in-process Promise. Making `buildSpawnEnv` async would cascade into the sync tmux (`execSync`) and PTY (`pty.spawn`) paths — a new seam shape (violates contract 6).

**Corrected model — the inject seam stays synchronous; it makes a sync decision and never awaits:**
```
augmentEnvWithPythonSource(env)  — SYNC (existsSync + readFileSync stamp + fire-and-forget):
  overlayReady = existsSync(overlay/bin/python) && readStamp() === bundledInterpVersion
  if overlayReady:  PATH.prepend(overlay/<bindir>)   VIRTUAL_ENV=overlay
  else:             PATH.prepend(bareInterp/<bindir>)   ← present in resources
                                                          IMMEDIATELY, no build
                    triggerBackgroundMaterialize()      ← fire-and-forget, single-flight
  set SSL_CERT_FILE = interpreter cacert.pem            (both branches, #10)
```
This mirrors what `ensureBundledGitOnPath` already does (`if (!exists(dir)) continue`) — pure sync fs probes, no await. Consequences:
- `python x.py` (stdlib) **always resolves instantly** via the bare bundled interpreter (contract 1), even before any venv exists.
- venv-backed `pip`/baseline packages become available once the background materialize finishes; before that, `pip install` degrades gracefully (bare interpreter, read-only site-packages → clear failure, not a hang).
- **Update window (contract 5) is covered:** after an electron-updater whole-app replace, the *new* bare interpreter is present in the new `resources/` immediately, so `python` keeps resolving while the venv rebuilds in the background. The stale overlay (whose `pyvenv.cfg home=` now points at the deleted old interpreter) is **rejected by the stamp check** — the seam falls back to the new bare interpreter rather than prepending a broken venv.

**Background materialize** (`materializePyEnv`, the one new module) is single-flight (memoized promise in the server process so N triggers share one build) and writes via atomic tmp-then-rename (idiom borrowed from `bundle-server.mjs`'s symlink materialization). It is **eager on server boot** (fired non-blocking) AND lazily re-triggerable by the seam.

**Freshness stamp** (`.py-stamp` = bundled interpreter version) is a **new runtime-staleness mechanism** — NOT the `.bundle-stamp` idiom (that is a build-time skip marker consumed by `build-installer.sh`, corrected per #4). It only *resembles* it (a version tag). Stamp mismatch → rebuild base+overlay. **First-run == first-run-after-update** (one rebuild path).

**Rebuild-vs-live-install hazard (#7, Windows).** A stamp-triggered rebuild that atomic-renames the overlay while an agent's in-flight `pip install` holds open handles inside it fails on Windows (`EACCES`/`EBUSY` — dir rename with open handles). Mitigation: build the replacement overlay in a **fresh versioned dir** (`py-overlay-<stamp>/`) and repoint the seam's target at the new dir rather than renaming over the busy one; GC old overlay dirs when no process references them. The sync seam already resolves the current overlay dir by stamp, so pointing at a new versioned dir is consistent with the existing decision.

### D6 — `pythonSource: auto|host|bundled`, default `bundled` (polarity flip vs git)
git defaults to preferring host (host git is reliable on mac/linux). Python inverts: host Python is the swamp (system/pyenv/homebrew/conda/PATH-shadowing) bundling exists to escape. So default resolves to **bundled on all platforms**; host is an opt-in escape hatch. Cross-platform (unlike win-only git). Doctor `getPythonSourceReadout` reports: source+setting, interpreter version, venv path + stamp match, baseline satisfied (N/N), last install status, pip network reachability.

### D7 — Security: agent pip == bash trust; no new gate
If bash tool calls work, the agent already has arbitrary code execution (`curl|sh`, `node -e`). `pip install X` is not a new capability — same trust boundary. Hardening applies where we have authority: the shipped baseline stays `--require-hashes`. No bespoke Python sandbox.

**Reframed (#11): the approval gate is future-optional, NOT a dependency.** Agent pip == bash trust **today**, standalone, needing no gate at all — that IS the accepted posture (contract 7). If/when `add-supervised-tool-approval` ships, bash calls (and thus pip) route through it for free; but this change does not depend on it and does not claim "one gate covers bash+pip" as a current fact. Shipping before that gate exists is acceptable — the interim posture is exactly the existing bash trust level, not a regression.

### D8 — Per-platform venv bindir (#13)
`uv venv` creates `bin/` on POSIX and `Scripts/` on Windows; the executables are `python`/`pip` vs `python.exe`/`pip.exe`. The seam's PATH prepend MUST select the platform-correct bindir so an arbitrary `bash`/`cmd` call resolves `python` via the same PATHEXT logic `binary-lookup.ts:whichSync` uses for git. `resolveVenvBinDir(root)` returns `<root>/Scripts` on win32 else `<root>/bin`; the same helper serves the bare-interpreter branch (python-build-standalone lays out `python.exe` at the install root on Windows, `bin/python3` on POSIX — verify exact layout in the D2/#9 spike). Existence-probed like git's `if (!exists(dir)) continue`.

## Risks / Trade-offs

- **[uv cache↔env coupling]** clone/hardlink couple the installed env to the global cache; wiping the cache can break installs → **Mitigation:** `UV_CACHE_DIR` inside `~/.pi-dashboard/` (survives updates, off cleaner radar); `py-base` uses `--link-mode copy` so a cache wipe can only ever break the disposable overlay.
- **[First-run/boot latency spend]** eager warm costs work on every boot even if Python is unused → **Mitigation:** non-blocking boot promise; the cost is background-only unless a call awaits it; uv CoW/hardlink keeps rebuilds fast.
- **[Offline package installs fail]** Tier 2 needs network for `pip install` → **Mitigation:** graceful degradation (interpreter + venv still materialize offline); Doctor surfaces pip reachability; wheelhouse (Tier 3) is a future add-on if air-gapped becomes a requirement.
- **[Arbitrary agent installs = RCE at user privilege]** → **Mitigation:** already the bash trust level (D7); baseline hash-pinned; defer approval to `add-supervised-tool-approval`.
- **[Bundle size +~70-80 MB]** uv + one interpreter tarball per installer → **Mitigation:** accepted; per-arch targeting keeps it to one tarball, no wheelhouse.
- **[Astral dependency/semantics drift]** → **Mitigation:** pin uv + interpreter versions (`_python-version.json`), GO/NO-GO build asserts, `UV_NO_CONFIG=1` to ignore stray user config.
- **[Same-volume link rule]** cross-drive clone/hardlink fails on Windows → **Mitigation:** co-locate `uv-cache` + `py-*` under `~/.pi-dashboard/`.
- **[#9 uv `file://` mirror layout unverified — HIGHEST BLAST RADIUS]** uv expects a python-build-standalone release-feed layout, not arbitrary tarballs → **Mitigation:** blocking verification spike (Open Q #9) before committing to `file://`; documented fallback = self-extract + `uv venv --python <path>`.
- **[#10 pip cert failure]** agent `python -m pip` uses CPython's CA store, not uv's bundled roots → **Mitigation:** set `SSL_CERT_FILE`/`PIP_CERT` to the standalone interpreter's bundled `cacert.pem` in both the materialize subprocess and the spawn seam.
- **[#7 Windows rebuild-vs-live-install rename]** dir rename with open pip handles → `EACCES` → **Mitigation:** versioned overlay dirs (`py-overlay-<stamp>/`), repoint-not-rename, GC unreferenced dirs.
- **[#12 UV_* env leak]** UV_* vars in the general spawn env would leak into every child + `UV_NO_CONFIG` suppresses host uv config globally → **Mitigation:** UV_* confined to the `materializePyEnv` subprocess; spawn seam injects only `PATH`(+`VIRTUAL_ENV`,+`SSL_CERT_FILE`).
- **[#6 offline base rebuild not guaranteed]** Tier 2 nuke+rebuild of `py-base` needs warm cache or network → **Mitigation:** documented non-goal (fully-offline base rebuild = Tier 3 wheelhouse, out of scope); Doctor surfaces cache/pip reachability so the failure is legible.
- **[#3/#5 pre-warm / update-window gap]** bash call before venv ready, or during post-update rebuild → **Mitigation:** D5 bare-interpreter fallback — `python` (stdlib) always resolves; only venv-backed `pip`/packages degrade until warm.

## Migration Plan

Additive — no existing behavior changes. Rollout:
1. Land build-time bundling (`download-python.mjs` + `_python-version.json` + GO/NO-GO in `bundle-server.mjs`) behind the per-arch matrix.
2. Land runtime seams (`select-python-source.ts`, `ensure-bundled-python.ts`, `python-source.ts`, `materializePyEnv`) + config default `bundled`.
3. Wire `augmentEnvWithPythonSource` into the spawn-env path + Doctor readout.
**Rollback:** set `pythonSource: host` (or remove the resources) — the seam no-ops exactly like the git seam when no bundle is resolvable; agents fall back to host Python if present.

## Open Questions

- **#9 (BLOCKING SPIKE — resolve before implementation):** confirm uv's expected `UV_PYTHON_INSTALL_MIRROR` directory layout/manifest against real python-build-standalone tarballs on all target triples. `file://` mirror is the intended path *pending this spike*; fallback = self-extract + `uv venv --python <extracted-path>`. Also settle the standalone interpreter's on-disk layout per platform (bindir, `cacert.pem` path) that D8/#10 depend on.
- Exact interpreter version + `uv` version to pin (and bump cadence — coordinate with `manage-node-runtime-updates`?).
- Exact package list for the small hash-pinned baseline `requirements.txt` (contents TBD; **shape decided:** a small pinned starter set materialized into `py-base` at first boot, not empty — scenario-design G2). Everything beyond the starter set is on-demand overlay install.
- License attribution mechanics: `THIRD-PARTY-LICENSE.txt` for uv + python-build-standalone (verify exact texts) — mirror the git bundle's `writeLicense`.

**Resolved by scenario-design gate (2026-07-16):**
- ~~Offline/failed `pip install` observable~~ → **pass pip's own non-zero exit + stderr straight through** to the tool call; no dashboard wrapper, no extra timeout (G1).
- ~~Baseline empty vs pinned~~ → **small hash-pinned starter set** in `py-base` at first boot (G2).

**Resolved by doubt-review (2026-07-16):**
- ~~Overlay reset cadence~~ → **persist until interpreter version bump** (D4, #8).
- ~~Sync seam awaits async materialize~~ → **impossible; sync-inject + bare-interpreter fallback** (D5, #1/#3/#5).
- ~~`add-supervised-tool-approval` timing~~ → **future-optional, not a dependency**; interim = existing bash trust (D7, #11).
