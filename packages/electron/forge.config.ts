import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "PI-Dashboard",
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
      // Bundled first-party recommended extensions (created by scripts/bundle-recommended-extensions.mjs
      // when BUNDLE_RECOMMENDED_EXTENSIONS=1; absent on feature-branch / local builds)
      ...(fs.existsSync(path.resolve(__dirname, "resources/bundled-extensions")) ? ["./resources/bundled-extensions"] : []),
      // Offline npm cache for pi + openspec + tsx (created by scripts/bundle-offline-packages.mjs).
      // Presence of the manifest file gates inclusion — dev/local forge builds skip silently.
      ...(fs.existsSync(path.resolve(__dirname, "resources/offline-packages/manifest.json")) ? ["./resources/offline-packages"] : []),
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
