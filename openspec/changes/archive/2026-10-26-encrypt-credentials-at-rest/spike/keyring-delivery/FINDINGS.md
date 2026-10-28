# Spike: `@napi-rs/keyring` 2.1.2 delivery risks

Question: what can break when the binding ships to users (Node versions, platforms, packaging, signing)?
Feeds tasks 1.2, 1.3, 1.4, 1.7 and design D5.

- Host: macOS arm64 (Apple silicon), Rosetta on, Docker Desktop (arm64 Linux containers).
- Harness: `run.sh` (sections: matrix electron select rosetta sign skew missing docker secretservice noexec), `probe.cjs`, `secret-service.sh`.
- Raw output: `results-2026-10-25-darwin-arm64.txt`.
- Probe = set → get → delete of a throwaway entry, on the main thread AND in a `worker_threads` Worker (design D4 runs keychain jobs in a worker).

## Results

| # | Probe | Result | Verdict |
|---|---|---|---|
| 1 | Node 16.14 → 24.15 (10 versions, N-API 8–10), main + worker | all round-trip, 15–40 ms | no Node-version regression; N-API, no ABI rebuild |
| 2 | Electron 44.9.0 `ELECTRON_RUN_AS_NODE` (Node 24.22) main + worker | round-trip | launcher fallback path works |
| 3 | `npm_config_target_arch=x64` on arm64 host | installs **arm64** package + `npm warn Unknown env config "target-arch" … will error in a future major` | ignored for optional deps |
| 4 | `--cpu=x64` / `--os=linux --cpu=x64 --libc=glibc` / `--os=win32 --cpu=x64` | installs the requested triple | cross-install works |
| 5 | `--cpu=x64 --cpu=arm64` | installs arm64 only (last flag wins) | no dual-arch install in one npm run |
| 6 | x64 Node (Rosetta) + arm64-only install | `Cannot find native binding` | host-arch bundle on another arch = `keychain_unavailable` |
| 7 | x64 Node (Rosetta) + `--cpu=x64` install, or install run under `arch -x86_64` (as `build-installer.sh --mac-both` does) | round-trip / x64 package installed | Intel path OK when install runs as x64 |
| 8 | nodejs.org `node` as shipped | TeamIdentifier `HX7739G8FX`, hardened runtime, **has** `disable-library-validation` | loads binding signed by team `K3VT49H83Y` |
| 9 | `node` re-signed (ad-hoc, `--options runtime`) with repo `entitlements.plist` | round-trip | DLV entitlement suffices |
| 10 | same, `entitlements.plist` **minus** `disable-library-validation` | load fails; root cause (3 `cause` levels deep) `dlopen … code signature … not valid … different Team IDs` | **re-signing bundled Node without DLV kills the binding** |
| 11 | main 2.1.2 + platform package 2.1.1 | loads and round-trips, also with `NAPI_RS_ENFORCE_VERSION_CHECK=1` | version skew is **silent**; generated loader only checks when the env var is set and the package path is used |
| 12 | platform package deleted; `--omit=optional` | `Cannot find native binding`; `--omit=optional` installs no binding | any optional-dep pruning removes the binding |
| 13 | Docker `node:24-bookworm-slim` / `node:22-alpine`, no session bus | typed error `Couldn't access platform storage: PermissionDenied` in 1–5 ms, no hang | maps to `keychain_unavailable` |
| 14 | Docker bookworm + `dbus-run-session` + unlocked `gnome-keyring` | round-trip, ~9 ms | Secret Service works (arm64-gnu) |
| 15 | bus up, keyring not unlocked (headless, no prompter) | typed error `Secret Service: unlock prompt was dismissed`, ~12 ms, no hang | maps to `keychain_unavailable` |
| 16 | binding on a `noexec` mount | root cause `failed to map segment from shared object` | `.node` cannot live on noexec `/home`, `/tmp`, tmpfs |

Every failure surfaces as the SAME top-level message: `Cannot find native binding. npm has a bug related to optional dependencies (npm/cli#4828)…`.
The real reason (wrong arch, code signature, noexec, missing package) is only in the nested `err.cause` chain.

## What this confirms in the design

- Node version skew between the dev, npm, Docker and Electron arms is not a delivery risk (rows 1, 2).
- CI Electron legs are native per arch (`_electron-build.yml` matrix: `macos-14` arm64, `macos-15-intel` x64, ubuntu x64/arm64, windows x64; win32-arm64 ships x64 Node and is built on an x64 host). Each leg installs its own triple; no cross-build exists in CI.
- No-bus and locked-keyring failures are fast typed errors, not hangs (rows 13, 15). The 10 s worker deadline remains for interactive prompts (macOS dialog, desktop unlock dialog).

## Gaps found (fold into design / tasks)

1. **Bundled-Node signing (row 10).** `packages/electron/entitlements.plist` grants DLV to the Electron app, but the server runs on the bundled `Resources/node/bin/node`. Today it keeps the nodejs.org signature (DLV present). When `macos-notarization` re-signs it, the entitlements used for `Resources/node/bin/node` MUST include `com.apple.security.cs.disable-library-validation`, or every macOS user gets `keychain_unavailable`. The CI check must load the binding with the **bundled** Node after signing, not only `codesign --verify` the `.node`.
2. **Diagnostics (rows 6, 10, 12, 16).** The worker must walk `err.cause` (arrays included) and log the deepest `dlopen`/`map segment`/`Cannot find module` message as a short reason detail. The top-level text blames npm and is misleading.
3. **Version equality (row 11).** Neither npm nor the loader enforces main == platform version. `verify-release-deps` / the bundle GO/NO-GO must assert the bundled `@napi-rs/keyring-<triple>/package.json` version equals `@napi-rs/keyring`'s.
4. **Local cross-builds (rows 3, 5, 7).** `npm_config_target_arch` (set by `bundle-server.mjs` for `TARGET_ARCH`) does NOT select the keyring triple; only `--cpu`/`--os`/`--libc` or running npm under `arch -x86_64` does. The GO/NO-GO assertion must check the triple of `TARGET_ARCH ?? process.arch`, so a mis-configured local cross build fails at build time. (Incidental, out of scope: npm warns this env config will error in a future npm major.)
5. **No `--omit=optional` anywhere on the delivery path (row 12).** Today none (`bundle-server.mjs` uses `--omit=dev`; Docker `pnpm install --frozen-lockfile`). The GO/NO-GO covers it.
6. **noexec install roots (row 16).** Documented limitation for the npm arm: a global prefix on a noexec mount yields `keychain_unavailable`; remedy `PI_DASHBOARD_DATA_KEY_FILE`.

## Not covered here (still open)

- linux-x64-gnu and win32-x64 real round-trips (task 1.2; Windows needs a VM or the `spike-windows-on-gh-actions` route; amd64 image pull was blocked by the local proxy).
- Notarized DMG with a real Developer ID signature (task 1.4 / manual E93).
- macOS keychain ACL prompt-vs-silent matrix across node binaries (task 1.1 / manual E94).

## CI spike (GitHub Actions, 2026-10-25)

Workflow `ci-workflow.yml` (reference copy; ran on throwaway branch `spike/napi-keyring-delivery`, deleted).
Runs 40180184596 (windows, containers) and 40180638544 (linux, macos). Raw lines: `results-2026-10-25-ci.txt`.

| # | Leg | Probe | Result |
|---|---|---|---|
| C1 | ubuntu-latest x64 (Node 22.19.0, 24.22.0), ubuntu-24.04-arm | unlocked gnome-keyring, main + worker | round-trip 10–110 ms |
| C2 | same | **no session bus, default `Entry`** | **succeeds**: entry lands in the kernel **session** keyring (`keyctl show @s` → `user: keyring:data-key-v1@<service>`); readable from a new `keyctl session`. README: keyutils is in-memory, "will not persist across reboots" |
| C3 | same | no bus, `{ linux: { store: 'secret-service' } }` | typed error in ~5 ms: `DBus error: The name org.freedesktop.secrets was not provided by any .service files` |
| C4 | same, after `dbus-x11` installed (no bus) | default `Entry` | `dbus-launch` autolaunch reaches a bus → `Secret Service: no result found` (typed, ~18 ms) |
| C5 | same | bus up, keyring not unlocked (default and pinned) | `Secret Service: unlock prompt was dismissed`, 25–375 ms, no hang |
| C6 | same | Secret Service item attributes | `service=pi-dashboard-credential-key`, `username=data-key-v1`, label `keyring:data-key-v1@pi-dashboard-credential-key`; `secret-tool lookup … account …` finds **nothing**, `… username …` finds it |
| C7 | same | noexec tmpfs | `failed to map segment from shared object` (as local row 16) |
| C8 | docker x64 `node:24-bookworm-slim`, `node:22-alpine`, `node:24-alpine` | no bus | `PermissionDenied` 3–5 ms (keyutils syscalls blocked by Docker's default seccomp) |
| C9 | windows-latest x64 (Node 22.19.0, 24.22.0), windows-11-arm arm64 | round-trip as `runneradmin`, non-interactive | round-trip 15–55 ms |
| C10 | same | Credential Manager view | `Target: LegacyGeneric:target=data-key-v1.pi-dashboard-credential-key`, `Type: Generic`, `User: data-key-v1` |
| C11 | windows-11-arm | x64 Node (emulated, = Electron win32-arm64 leg) + `--cpu=x64` binding | round-trip |
| C12 | windows-11-arm | x64 Node + arm64-only install | `Cannot find module './keyring.win32-x64-msvc.node'` |
| C13 | macos-14 arm64, macos-15-intel x64 | setup-node Node and the bundled nodejs.org `v24.22.0` (team `HX7739G8FX`, DLV=1) | round-trip, main + worker |
| C14 | same | **SIP state of the runner** | `System Integrity Protection status: disabled` |
| C15 | same | ad-hoc runtime re-sign **without** DLV (`ENT_CHECK nodlv_DLV=0 runtime=1`) | **loads** (contrast local row 10 with SIP on: refused). CI runners cannot detect the no-DLV regression by loading |
| C16 | same | item created by setup-node's `node`, read by: bundled nodejs.org Node / `security -w` / ad-hoc re-signed node | silent read / **blocked** (prompt, killed at 30 s) / **blocked** |
| C17 | same | Keychain item | login keychain, class `genp`, `svce=pi-dashboard-credential-key`, `acct=data-key-v1`; no prompt on create |

### CI gaps found (fold into design / spec / tasks)

7. **Linux keyutils fallback (C2).** The default `Entry` never reports `keychain_unavailable` on a headless Linux host with keyutils: it creates the data key in the kernel session keyring, which is lost at reboot or session end, and every credential file is then locked `key_missing`. The keychain worker MUST construct entries with `{ linux: { store: 'secret-service' } }`. Pinned, a missing Secret Service is a fast typed error (C3) → `keychain_unavailable` → remedy `PI_DASHBOARD_DATA_KEY_FILE`.
8. **No-DLV detection (C14, C15).** GitHub macOS runners run with SIP disabled, so a load check there passes even without DLV. The build gate MUST be static: `codesign -d --entitlements - Resources/node/bin/node` contains `com.apple.security.cs.disable-library-validation`. The load round-trip stays as a smoke check only.
9. **macOS ACL (C16, task 1.1 partial).** Any `node` signed by the nodejs.org team reads the entry silently (designated requirement is team-based); `/usr/bin/security` and differently-signed binaries prompt. Threat model: on the npm arm any nodejs.org `node` the agent can run reads the key without a prompt. (Homebrew node not measured.)
10. **OS-tool identifiers (C6, C10, C17).** Linux attribute is `username`, not `account`; Windows target is `data-key-v1.pi-dashboard-credential-key`. The guard keychain rule still matches (service name + verb), but test/scenario commands and docs must use the real forms.
11. **Licence (README).** Linux binaries statically link `libdbus` (`AFL-2.1 OR GPL-2.0-or-later`); ship the package's `LICENSE.third-party.md` with the Electron Linux bundle and the Docker image.

### Still open after CI
- Real Developer-ID notarized DMG on a SIP-enabled Mac (task 1.4 / manual E93).
- Homebrew `node` row of the ACL matrix (task 1.1).
- Interactive Windows session after a password change (manual E95).
