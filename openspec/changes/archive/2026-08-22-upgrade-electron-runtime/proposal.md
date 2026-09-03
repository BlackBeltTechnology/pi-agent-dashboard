# Upgrade the Electron runtime from 32.3.3 (EOL) to 43.4.1

## Why

`packages/electron/package.json:32` pins `electron: 32.3.3`. That line is **end-of-life
and receives no security backports**. Because the desktop app ships a full Chromium to
end users and auto-updates it into every install, this is security debt in a *released
artifact*, not dependency drift.

Filed as [#529](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/529).

| | |
|---|---|
| Current pin | `electron@32.3.3` → Chromium 128 |
| Latest stable | `electron@43.4.1` → Chromium 150 |
| Gap | **11 Electron majors / ~22 Chromium majors** |
| Support policy | latest **3** stable majors — currently 43, 42, 41 |
| Status of 32.x | **unsupported — no security backports** |

The renderer loads server-rendered content via `mainWindow.loadURL(serverUrl)`
(`packages/electron/src/main.ts`), so every Chromium renderer CVE since 128 lands on a
live surface. The shell can additionally expose CDP on a TCP port
(`--debug-cdp` / `PI_DEBUG_CDP`, default `9222`, opt-in and default OFF), which raises
the value of a current engine but is not itself the driver.

### The app code is a near no-op — the OS floor is the real work

The Electron API surface across **all** of `packages/electron/src`, enumerated from the
`import { … } from "electron"` sites (constructor-style uses such as `new Tray(...)` are
invisible to a `Symbol.method` grep — an earlier pass missed `tray.ts` for exactly that
reason, so the import sites are the authoritative source):

```
app.{quit,on,whenReady,commandLine,isPackaged,name,getPath,getVersion,relaunch,
     requestSingleInstanceLock,disableHardwareAcceleration}
BrowserWindow.getFocusedWindow   Menu.{buildFromTemplate,setApplicationMenu}
dialog.{showMessageBox,showErrorBox}   shell.{openExternal,openPath,showItemInFolder}
ipcMain.{handle,on,removeHandler,removeAllListeners}
contextBridge.exposeInMainWorld   ipcRenderer.{invoke,on,send,removeListener}
webContents.{on,send,getURL,reload,reloadIgnoringCache,setWindowOpenHandler}
screen.getAllDisplays   clipboard   Notification
Tray (constructed)   nativeImage.createFromPath        ← via src/lib/tray.ts
```

All of these are long-stable APIs and **none is expected** to appear in Electron's 33→43
breaking-changes doc. That expectation is stated as a hypothesis, not a settled fact: it
is **gated by task 1.3**, which re-derives the surface from the import sites and
re-checks it against the upstream doc. A hit there re-scopes the change.

No `remote` module. `contextIsolation: true` / `nodeIntegration: false` already set. No
native module loads under the Electron ABI on the **packaged** path: `sharp` is a
devDependency used only for icon generation, `electron-updater` is pure JS, and
`node-pty` lives in the **bundled server tree** under the separately-pinned bundled Node
(`BUNDLED_NODE_VERSION` = `v24.15.0`). See `design.md` Decision 3 for the one fallback
path where that separation does *not* hold.

What actually breaks is the **macOS support floor**:

```
      Electron majors   →   macOS floor
  ────────────────────────────────────────────
   32  (current pin)    │   10.15  Catalina
   33 … 37              │   11     Big Sur
   38 … 43              │   12     Monterey     ← target lands here
```

And this repo **triple-enforces the 10.15 floor as a hard CI gate**:

1. `forge.config.ts` → `packagerConfig.extendInfo.LSMinimumSystemVersion = "10.15"`
2. `_electron-build.yml:407` → `env: MACOSX_DEPLOYMENT_TARGET: "10.15"`
3. `_electron-build.yml:454+` → *"Verify macOS deployment target floor (10.15)"* —
   `plutil -extract` equality check on the Info.plist, plus a per-arch
   `otool -l … minos` major check. Note the asymmetry in the **current** wiring: the
   plist check is equality (`!= "10.15"` → fail), but the otool check is upward-only
   (`-gt`, line 536). That distinction becomes load-bearing at a 12.0 floor — see
   `design.md` Decision 2.

So bumping past 32 makes the darwin legs fail CI **by design**. The upgrade is therefore
not "bump a version" — it is *"raise the product's documented macOS floor from 10.15 to
12, and move all three enforcement points with it."*

### Why straight to 43, not a stepped walk

41, 42 and 43 **all require macOS 12**. The OS cost is paid once at 33 and once at 38,
and every supported landing spot is on the far side of both. Stepping through majors
therefore buys nothing on the axis that actually costs us, while 43 buys the longest
support runway. A per-major bisect is only worth doing *reactively*, if a smoke test
goes red.

## What Changes

- **Pin** `packages/electron/package.json > devDependencies.electron` from `32.3.3` to
  `43.4.1`. Literal semver, no range — required by `app-builder-lib`'s
  `getElectronVersionFromInstalled` (existing spec requirement, unchanged in shape).
- **Raise the macOS floor 10.15 → 12.0** at all three enforcement points; keep the
  three-gate pattern (it is what makes the floor non-silent).
  - `forge.config.ts` `LSMinimumSystemVersion: "12.0"`
  - `_electron-build.yml` `MACOSX_DEPLOYMENT_TARGET: "12.0"`
  - the verify step's expected plist value and per-arch `minos` majors → `12` for
    **both** `x64` and `arm64` (they converge; the old asymmetry existed only because
    arm64 could never declare below 11).
- **Gate the update stream** so shipped 10.15/11 clients are not offered an artifact
  their OS refuses to launch. Without it, the release-notes promise that those users
  "stay on 32.x" is false — they enter a repeating failed-install cycle instead.
  `electron-updater` has the mechanism (`checkIfUpdateSupported` →
  `updateInfo.minimumSystemVersion`), but **both** obvious ways to use it are silently
  inert, so the plan specifies the verified-correct one:
  - the value must be `21.0.0` — a full Darwin-kernel semver triple. `os.release()`
    returns the Darwin version, so `"12.0"` compares on the wrong scale; and the bare
    major `"21"` is not valid strict semver, so `semver.lt` throws, the throw is caught,
    and the gate passes every client.
  - the field must be **injected into the emitted `latest-mac.yml`**, not set in
    `electron-builder.yml`: that config key never reaches update metadata, and its only
    consumer is skipped under the `--prepackaged` build this pipeline uses.

  Both failure modes fail **open** with nothing but a log warning, which is why
  `design.md` Decision 5 treats them as the highest-risk item in the change.
- **Keep** the `darwin/x64` build leg unchanged. Apple still supports Intel Macs on
  macOS 12+; `macos-15-intel` remains available until 2027-08. No arch is dropped by
  this change.
- **Float the toolchain**: `@electron-forge/*` `^7.6.0` and `electron-builder` `^26.8.1`
  already resolve to versions that support Electron 43 (`7.11.2` / `26.15.3`). Verify at
  install time; only pin upward if resolution proves otherwise.
- **Update the docs** that state the Catalina floor as a user-facing promise.
- **Sequencing**: land this **before** `electron-platform-extraction` and
  `harden-electron-renderer-boundary`. Both touch `packages/electron` and will collide
  in `package.json` / config files; this change is small and mechanical, those two are
  structural, so the cheap one goes first.

Non-goals: no Electron API migration (nothing in our surface is deprecated), no renderer
security-model change (that is `harden-electron-renderer-boundary`), no restructuring of
the build pipeline (that is `electron-platform-extraction`).

## Impact

- **Affected specs**: `electron-build-pipeline` (1 renamed + 3 modified + 1 added)
- **Affected code**:
  - `packages/electron/package.json` — the pin
  - `packages/electron/forge.config.ts` — `extendInfo` + the 10.15 rationale comment
  - `.github/workflows/_electron-build.yml` — deployment-target env + verify step
  - `packages/electron/src/**` — expected **no changes**; a diff here is a signal to stop
    and re-scope
- **Affected users**: **macOS 10.15 Catalina and 11 Big Sur users can no longer install
  or auto-update.** This is the change's one intended user-visible regression: it needs
  both a release-notes callout **and** the update-stream gate above, or it degrades from
  "unsupported" into "broken".
- **Windows**: unaffected. **Linux**: expected unaffected, but this is *asserted, not
  verified* — Electron majors have moved the glibc floor before, and the Linux smoke runs
  on a current Ubuntu image, so an older-distro regression would pass CI silently. Task
  6.2 probes the Electron 43 glibc requirement rather than assuming.
- **Regression gate — with a known hole.** The Electron-E2E suite
  (`playwright.electron.config.ts` + `tests/e2e-electron/*.electron.spec.ts`) drives the
  **real packaged app**, but it does **not** cover the leg this change actually risks:
  `dmg-build-launch.electron.spec.ts:124` is `test.skip(process.platform !== "darwin")`
  and `ci-e2e-electron.yml:35` runs a `[ubuntu-latest, windows-latest]` matrix — **no
  macOS leg**, so that spec never executes in CI. The darwin path is covered only by the
  macOS launch smoke (`qa/tests/09-electron-mac-launch.sh`), which the `electron-qa-coverage`
  spec explicitly documents as *boot-proof, NOT floor-proof*. Group 5 therefore verifies
  the darwin artifact **locally and explicitly** rather than relying on a CI gate that
  does not exist.

## Discipline Skills

- `doubt-driven-review` — dropping OS support for shipped users is **irreversible for
  those users**; auto-update will silently stop reaching them. Stress-test the floor
  decision, and the claim that no shipped install sits on 10.15/11, before it stands.
- `security-hardening` — the change's entire justification is a security posture claim.
  Verify the CVE-exposure argument is real (renderer loads remote content; CDP port
  surface) rather than assumed, and confirm the bump does not silently relax
  `contextIsolation` / `sandbox` defaults inherited from newer majors.
- `systematic-debugging` — if a darwin leg goes red after the bump, resist per-major
  guessing. Decision 1 prescribes a *reactive* bisect (43 → 41 → 38 → 33) driven by
  evidence, which is that skill's phased-evidence rule applied to a version axis.
- `review-code` — small diff, but it spans a build config, a CI workflow and a version
  pin, where a wrong constant fails only at package time on a runner. Review before
  commit.
