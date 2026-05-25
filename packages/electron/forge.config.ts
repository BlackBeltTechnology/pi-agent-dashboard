import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveWindowsBuildVersion } from "./src/lib/build-version.js";

// fileURLToPath handles Windows drive-letter paths correctly (new URL().pathname gives /C:/... which is invalid)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only include bundled Node.js if it exists (CI downloads it; local builds skip it)
const bundledNodePath = path.resolve(__dirname, "resources/node");
const extraResource = fs.existsSync(bundledNodePath) ? [bundledNodePath] : [];

// Read package version once at config-evaluation time. Used by the DMG
// maker below to compose an arch-tagged artifact basename so each macOS
// matrix leg lands a distinct release asset (see DMG maker comment).
// See change: fix-darwin-dmg-arch-collision (D1).
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
    // macOS: support Catalina (10.15) and newer.
    //
    // The 10.15 floor is enforced at THREE points so a future runner-image
    // upgrade or source-built native module cannot silently raise it:
    //   1. extendInfo.LSMinimumSystemVersion (below) — user-visible min in Info.plist;
    //      Gatekeeper / launchd refuse to launch the app on older OSes.
    //   2. .github/workflows/publish.yml step env MACOSX_DEPLOYMENT_TARGET=10.15 —
    //      every Mach-O the build produces (Electron framework, custom binaries,
    //      any source-compiled node-gyp module) declares 10.15 as its minos.
    //   3. CI verification step that greps the produced Info.plist + otool -l
    //      output and fails the job on any drift.
    // See change: add-darwin-x64-build (Tasks group 6b, post-impl extension).
    darwinDarkModeSupport: true,
    extendInfo: {
      LSMinimumSystemVersion: "10.15",
    },
    // macOS universal binary (arm64 + x64)
    ...(process.platform === "darwin" ? { arch: "universal" as any } : {}),
    extraResource: [
      ...extraResource,
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
      // bundled-extensions + offline-packages resources removed under change:
      // eliminate-electron-runtime-install (task 5.7). pi/openspec/tsx now
      // ship as regular npm deps of the bundled server tree at
      // resources/server/node_modules/; no runtime cache extraction.
    ],
    // macOS code signing — requires APPLE_IDENTITY env var in CI
    ...(process.env.APPLE_IDENTITY ? {
      osxSign: {
        identity: process.env.APPLE_IDENTITY,
        hardenedRuntime: true,
        entitlements: "entitlements.plist",
        "entitlements-inherit": "entitlements.plist",
      },
      osxNotarize: {
        appleId: process.env.APPLE_ID || "",
        appleIdPassword: process.env.APPLE_ID_PASSWORD || "",
        teamId: process.env.APPLE_TEAM_ID || "",
      },
    } : {}),
  },
  makers: [
    {
      // DMG `name` is composed at config-evaluation time as
      // `PI-Dashboard-darwin-${process.arch}-${pkgVersion}` so each
      // macOS matrix leg (`darwin/arm64` on `macos-14`, `darwin/x64` on
      // `macos-15-intel`) produces a distinct artifact basename. Without
      // this disambiguation, both legs emit `PI Dashboard.dmg` and
      // `softprops/action-gh-release@v2` silently overwrites one with
      // the other on upload (it dedups release assets by basename).
      //
      // The `process.arch`-vs-`matrix.arch` contract: forge invokes this
      // file in the host Node process, so `process.arch` is the host
      // arch. On every supported build path, host arch == target arch:
      //   - macos-14 runner    → process.arch === "arm64"
      //   - macos-15-intel     → process.arch === "x64"
      //   - local --mac-both   → x64 leg wraps the sub-process in
      //                          `arch -x86_64`, so the wrapped Node
      //                          sees process.arch === "x64".
      // `@electron-forge/maker-dmg` does not implement electron-builder's
      // `${version}` placeholder substitution, so the version is
      // composed in JS rather than declared as a template string.
      // See change: fix-darwin-dmg-arch-collision (D1).
      name: "@electron-forge/maker-dmg",
      config: {
        name: `PI-Dashboard-darwin-${process.arch}-${pkgVersion}`,
        title: "PI Dashboard",
        icon: path.resolve(__dirname, "resources/icon.icns"),
        format: "ULFO",
      },
    },
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
    // AppImage is only supported on x64 (appimagetool has no arm64 build)
    ...(!process.env.SKIP_APPIMAGE ? [{
      name: "@pengx17/electron-forge-maker-appimage",
      config: {},
    }] : []),
    // NSIS installer removed — see change: simplify-electron-bootstrap-derived-state.
    // Windows distribution is ZIP + portable.exe only.
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
        ],
        renderer: [],
      },
    },
  ],
};

export default config;
