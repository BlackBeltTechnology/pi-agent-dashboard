import type { ForgeConfig } from "@electron-forge/shared-types";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// fileURLToPath handles Windows drive-letter paths correctly (new URL().pathname gives /C:/... which is invalid)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only include bundled Node.js if it exists (CI downloads it; local builds skip it)
const bundledNodePath = path.resolve(__dirname, "resources/node");
const extraResource = fs.existsSync(bundledNodePath) ? [bundledNodePath] : [];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "PI-Dashboard",
    executableName: "pi-dashboard",
    icon: path.resolve(__dirname, "resources/icon"),
    appBundleId: "com.blackbelt-technology.pi-dashboard",
    // macOS: support Catalina (10.15) and newer (requires Electron 32.x)
    darwinDarkModeSupport: true,
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
      // Bundled server (created by scripts/bundle-server.sh)
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
      name: "@electron-forge/maker-dmg",
      config: {
        name: "PI Dashboard",
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
    {
      name: "@felixrieseberg/electron-forge-maker-nsis",
      config: {
        oneClick: true,
        perMachine: false,
        // Inject publish:never into electron-builder config via getAppBuilderConfig
        getAppBuilderConfig: async () => ({ publish: null }),
      },
    },
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
