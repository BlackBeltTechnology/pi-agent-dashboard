## Context

`@electron-forge/maker-dmg` depends on `electron-installer-dmg`, which depends on `appdmg`, which depends on `macos-alias`. `macos-alias` ships native code that is compiled via `node-gyp` from an `install` script:

```json
"scripts": {
  "install": "node-gyp rebuild"
}
```

Under pnpm hoisting the package lives at `node_modules/.pnpm/macos-alias@0.2.12/node_modules/macos-alias/`. If `pnpm install` was run with `--ignore-scripts` (CI sometimes does this for security), or if Xcode CLT is not available at install time, `build/Release/volume.node` is never produced. The DMG maker then crashes at make-time:

```
Cannot find module '../build/Release/volume.node'
```

Local builds emit the `.app` correctly (Electron Packager step) but no `.dmg`. The user must dig through the forge stack trace to identify the root cause.

## Goals / Non-Goals

**Goals:**
- Local builds either produce a `.dmg` or fail with a clear actionable error.
- No DMG-maker stack traces in production / CI logs.
- The Electron Doctor diagnostic surfaces this state.

**Non-Goals:**
- Replacing `@electron-forge/maker-dmg` with `electron-builder`. (Tracked as alternative; deferred.)
- Auto-installing Xcode Command Line Tools. (Permission-prompts and security implications; out of scope.)
- Cross-platform changes (Linux DEB / AppImage / Windows NSIS makers are unaffected by `macos-alias`).

## Decisions

### D1. Postinstall hook in `packages/electron/package.json`

```json
"scripts": {
  "postinstall": "node scripts/ensure-macos-alias.mjs"
}
```

`ensure-macos-alias.mjs` (new file):
1. Skip when `process.platform !== "darwin"`.
2. Locate `macos-alias` in the workspace via `require.resolve` and walk up to its `package.json`.
3. Test `<dir>/build/Release/volume.node` existence; exit 0 if present.
4. Run `npm rebuild macos-alias --prefix=<resolved-dir>` (or pnpm-equivalent depending on packageManager field).
5. Test again; if still absent, print a clear error referencing Xcode CLT (`xcode-select --install`) and exit 0 — non-fatal at install time, fatal at build time (D2).

Non-fatal here because (a) Linux/Windows contributors should not be blocked by macOS native build failures, (b) `npm install` running with `--ignore-scripts` should not break the whole repo install.

### D2. Build-time gate in `build-installer.sh`

Right before invoking `electron-forge make` on darwin:

```bash
if [[ "$HOST_PLATFORM" == "darwin" ]]; then
  if ! find node_modules -path '*/macos-alias/build/Release/volume.node' -print -quit | grep -q .; then
    echo "→ macos-alias native module missing; attempting rebuild..."
    if ! node packages/electron/scripts/ensure-macos-alias.mjs --rebuild; then
      echo "❌ macos-alias build failed. Install Xcode Command Line Tools (xcode-select --install) and retry."
      exit 1
    fi
  fi
fi
```

Fail loudly with an actionable message before the forge invocation that would otherwise emit a confusing stack trace.

### D3. Doctor diagnostic row

`packages/shared/src/doctor-core.ts` already aggregates platform readiness checks. Add a darwin-only row:

```ts
{
  id: "macos-alias-volume",
  section: "Electron build prerequisites",
  label: "macos-alias native module",
  state: existsSync(volumeNodePath) ? "ok" : "warn",
  suggestion: "Run `npm run -w packages/electron postinstall` or install Xcode CLT.",
}
```

`section` reuses the existing `SECTION_OF` map; no new section needed if "Electron build prerequisites" exists; otherwise append to "Build" section.

### D4. Defer electron-builder migration

`electron-builder`'s dmg target has no `macos-alias` dependency and would eliminate this issue at the root. Migration costs include: rewriting `forge.config.ts`, updating CI matrix to use `electron-builder` CLI, re-validating code-signing + notarization. Estimated 1–2 days. Not justified for a build-time-only inconvenience; revisit if `macos-alias` causes another regression.

## Risks / Trade-offs

- **Postinstall script that conditionally invokes `npm rebuild` can confuse pnpm** → Mitigated by gating on `process.platform` and using `--prefix=<resolved-dir>` so the rebuild is local to the hoisted copy.
- **CI runners may not have Xcode CLT** → Most macOS GitHub-hosted runners ship with CLT pre-installed. If a custom runner does not, the build-time gate fails loudly with the right command.
- **False-positive on the Doctor warn state** → Only shown on darwin; informational. Low risk.

## Migration Plan

1. Land the postinstall hook + build-time gate + Doctor row.
2. CI runs through the postinstall on every install; no regression.
3. Local contributors with broken native module see the postinstall self-heal on next `pnpm install` or the build script self-heal on next `make`.
4. If `npm rebuild` is insufficient (no CLT), the actionable error message guides them to `xcode-select --install`.

**Rollback:** revert the three files. No persisted state.

## Open Questions

- Should the postinstall hook also handle the case where `macos-alias` is at a version OTHER than `0.2.12`? — Defer; the package has had a single major for years. If it ever changes, the `require.resolve` walk still finds it.
