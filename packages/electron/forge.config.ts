import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveWindowsBuildVersion } from "./src/lib/build-version.js";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { createAfterCopyExtraResources } from "./scripts/relativize-extra-resource-links.mjs";

// fileURLToPath handles Windows drive-letter paths correctly (new URL().pathname gives /C:/... which is invalid)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only include bundled Node.js if it exists (CI downloads it; local builds skip it)
const bundledNodePath = path.resolve(__dirname, "resources/node");
const extraResource = fs.existsSync(bundledNodePath) ? [bundledNodePath] : [];

// Read package version once at config-evaluation time. Consumed by
// deriveWindowsBuildVersion below to build the Windows PE VERSIONINFO triple.
const pkgVersion: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
).version;

// Windows PE VERSIONINFO requires MAJOR.MINOR.BUILD[.REVISION] integers;
// SemVer prereleases like "0.5.3-ci.20260525-141712.feat.abc" (produced by
// ci-electron.yml's slug step) are rejected by @electron/packager's
// `resedit` step. Derive a 4-integer buildVersion from the SemVer triple +
// GITHUB_RUN_NUMBER.
//
// @electron/packager wires the PE VERSIONINFO fields like this
// (see node_modules/@electron/packager/dist/win32.js):
//   productVersion: this.opts.appVersion             // ← no override path
//   fileVersion:    this.opts.buildVersion || appVersion
// Both run through parseVersionString. `buildVersion` only fixes FileVersion;
// to satisfy ProductVersion we must also pin `appVersion` to the 4-integer
// form, but only when building for Windows so darwin / linux artifacts keep
// the full SemVer in CFBundleShortVersionString / Info.plist.
//
// Build-host detection (`process.platform === "win32"`) is correct here
// because the ci-electron matrix builds Windows artifacts only on
// windows-latest runners; cross-builds are not used for win32.
//
// See change: fix-ci-electron-windows-resedit.
const buildVersion = deriveWindowsBuildVersion(
  pkgVersion,
  process.env.GITHUB_RUN_NUMBER,
);
const isWindowsBuildHost = process.platform === "win32";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "PI-Dashboard",
    buildVersion,
    // Windows-only: pin appVersion so ProductVersion (which packager's
    // win32.js hardcodes from appVersion) is also a 4-integer string.
    // On darwin/linux this stays unset, so packager defaults to
    // pkgVersion (= full SemVer slug) for Info.plist visibility.
    ...(isWindowsBuildHost ? { appVersion: buildVersion } : {}),
    // VERSIONINFO `LegalCopyright` (Windows) + `NSHumanReadableCopyright`
    // (macOS Info.plist). Without this override, @electron/packager copies
    // the Electron framework's default string ("Copyright (C) 2015 GitHub,
    // Inc.") into the produced .exe / .app metadata. See packager
    // dist/win32.js:51 (`this.opts.appCopyright || ...framework-default`).
    // Year hardcoded to match LICENSE (avoids non-deterministic builds).
    // See change: fix-ci-electron-windows-resedit.
    appCopyright: "Copyright © 2026 BlackBelt Technology",
    executableName: "pi-dashboard",
    icon: path.resolve(__dirname, "resources/icon"),
    appBundleId: "com.blackbelt-technology.pi-dashboard",
    // macOS: support Ventura (13.0) and newer.
    //
    // Electron dropped macOS 12 at v44, macOS 11 at v38 and macOS 10.15 at v33;
    // the pinned runtime is on the 44 line, so 13.0 is the lowest OS the shipped
    // binary can launch on. The dropped versions are also past Apple's own
    // security window (10.15 EOL 2022-09, 11 EOL 2023-09, 12 EOL 2024-09).
    // Raised 12.0 -> 13.0 by refresh-electron-bundled-components.
    //
    // The 13.0 floor is enforced at THREE points (plus an extractor canary, see
    // scripts/verify-macos-floor.mjs) so a future runner-image
    // upgrade or source-built native module cannot silently raise it:
    //   1. extendInfo.LSMinimumSystemVersion (below) — user-visible min in Info.plist;
    //      Gatekeeper / launchd refuse to launch the app on older OSes.
    //   2. .github/workflows/_electron-build.yml step env
    //      MACOSX_DEPLOYMENT_TARGET=13.0 — every Mach-O the build itself
    //      COMPILES (custom binaries, any source-compiled node-gyp module)
    //      declares 13.0 as its minos.
    //   3. CI verification step that plutil-extracts the produced Info.plist
    //      and otool -l's the inner Mach-O, failing the job on any drift.
    //      NOTE: that binary is the renamed Electron PREBUILT, whose minos is
    //      baked upstream and only copied by the packager — so the otool leg is
    //      an upstream-floor tripwire, not a check on (2). It compares for
    //      EQUALITY: at a 13.0 floor a below-floor value is reachable, unlike
    //      at the old 10.15 target. See scripts/macos-floor.mjs, which is the
    //      single source of truth for the constants and the predicate.
    // See change: upgrade-electron-runtime (supersedes add-darwin-x64-build 6b).
    darwinDarkModeSupport: true,
    extendInfo: {
      LSMinimumSystemVersion: "13.0",
    },
    // macOS universal binary (arm64 + x64)
    ...(process.platform === "darwin" ? { arch: "universal" as any } : {}),
    // @electron/packager >= 20 copies `extraResource` entries with `fs.cp` and no
    // `verbatimSymlinks`, which rewrites every relative symlink (53
    // `server/node_modules/.bin/*` links, `node/bin/npm`) to an ABSOLUTE
    // build-host path; the packaged app then carries dangling links and
    // `codesign --verify --strict` fails ("invalid destination for symbolic link
    // in bundle"). This hook re-relativizes them after ALL entries are copied.
    // Generic over the `extraResource` list below (no hard-coded names), so later
    // resources are covered unchanged. Packager >= 19 hook signature: a single
    // object argument. Guarded on every electron leg by
    // scripts/scan-packaged-symlinks.mjs.
    // Upstream: electron/packager `copyExtraResources` (platform.js) lacks
    // `verbatimSymlinks`; the sibling `copyTemplate` defect is electron/packager#1964
    // (see scripts/relativize-extra-resource-links.mjs for the status of the
    // extra-resource issue).
    // See change: refresh-electron-bundled-components (design D3).
    afterCopyExtraResources: [
      createAfterCopyExtraResources({
        projectDir: __dirname,
        getExtraResources: () => config.packagerConfig?.extraResource,
      }),
    ],
    extraResource: [
      ...extraResource,
      // electron-updater reads app-update.yml from resourcesPath at runtime.
      // electron-builder normally writes it during packaging, but our mac/linux
      // build runs electron-builder in --prepackaged mode (which skips that
      // phase), so we ship it as an extraResource instead. provider/owner/repo
      // are static for this repo. See change: fix-electron-auto-update-pipeline.
      "./resources/app-update.yml",
      "./src/renderer",
      "./resources/dirname-shim.js",
      // Tray icons for macOS (template images) and Windows/Linux
      "./resources/trayTemplate.png",
      "./resources/trayTemplate@2x.png",
      "./resources/icon.png",
      "./resources/icon.ico",
      // Loading-page HTML resource. See change: electron-server-launch-controls.
      "./resources/loading.html",
      // Bundled server (created by scripts/bundle-server.mjs)
      ...(fs.existsSync(path.resolve(__dirname, "resources/server")) ? ["./resources/server"] : []),
      // Bundled Windows git+sh (created by scripts/download-git-windows.mjs on
      // win32 builds only). Lands at app resources/git/. Resolved at runtime
      // by resolveBundledGitDir(). See change: embed-git-bash-on-windows.
      ...(fs.existsSync(path.resolve(__dirname, "resources/git")) ? ["./resources/git"] : []),
      // bundled-extensions + offline-packages resources removed under change:
      // eliminate-electron-runtime-install (task 5.7). pi/openspec/tsx now
      // ship as regular npm deps of the bundled server tree at
      // resources/server/node_modules/; no runtime cache extraction.
    ],
    // macOS signing + notarisation are owned by the `macos-notarization`
    // change (split per fix-electron-auto-update-pipeline D4). That change
    // re-adds osxSign/osxNotarize here with the CI keychain wiring and the
    // current @electron/osx-sign option shape. The previous inline block was
    // dead (no APPLE_IDENTITY set in any workflow) and broke `tsc` after a
    // dependency bump, so it is removed here rather than carried broken.
  },
  makers: [
    // macOS DMG + Linux AppImage are produced by electron-builder (config:
    // electron-builder.yml) in --prepackaged mode, NOT by Forge makers, so the
    // build also emits latest-mac.yml / latest-linux.yml + app-update.yml that
    // electron-updater needs. Forge keeps only the .deb maker.
    // See change: fix-electron-auto-update-pipeline (D1). This supersedes the
    // maker-dmg arch-collision workaround (fix-darwin-dmg-arch-collision) —
    // electron-builder's ${arch} artifactName template disambiguates natively.
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "pi-dashboard",
          bin: "pi-dashboard",
          productName: "PI Dashboard",
          genericName: "Dashboard",
          description: "Monitor and interact with pi agent sessions",
          productDescription: "Web-based dashboard for monitoring and interacting with pi agent sessions remotely. Provides session management, terminal access, file browsing, and real-time event streaming.",
          icon: path.resolve(__dirname, "resources/icon.png"),
          categories: ["Development", "Utility"],
          desktopTemplate: path.resolve(__dirname, "resources/desktop.ejs"),
          maintainer: "Blackbelt Technology",
          homepage: "https://github.com/BlackBeltTechnology/pi-agent-dashboard",
        },
      },
    },
    // Forge has no Windows maker. Windows distribution = ZIP (forge package +
    // zip) plus an NSIS Setup.exe produced by electron-builder as a sidecar
    // step (CI windows-latest). See change: restore-windows-nsis-installer.
    // The 7-Zip SFX portable.exe target was dropped by that change.
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "src/main.ts",
            config: "vite.main.config.ts",
            target: "main",
          },
          {
            entry: "src/preload.ts",
            config: "vite.preload.config.ts",
            target: "preload",
          },
          {
            // Main-window preload: piDashboard only, no wizard bridges.
            // See change: harden-electron-renderer-boundary.
            entry: "src/preload-main.ts",
            config: "vite.preload-main.config.ts",
            target: "preload",
          },
        ],
        renderer: [],
      },
    },
  ],
};

export default config;
