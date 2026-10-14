/**
 * `pi-craft launcher status|install` — the only code that fetches a desktop
 * installer. `install` downloads the Craft Launcher installer for the host from
 * `storytold/craft-launcher`, verifies it against that release's
 * `SHA256SUMS.txt` (fail closed, file deleted on mismatch), and hands it to the OS.
 *
 * See change: add-craft-apps-core (design D3).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { launcherAppState } from "./launcher.js";
import { apiJson, craftRoot, downloadVerified, type ProvisionDeps, ProvisionError } from "./provision.js";
import { CRAFT_APPS } from "./registry.js";

export const LAUNCHER_REPO = "storytold/craft-launcher";

export interface InstallerAsset {
  name: string;
  /** How the OS takes over: macOS opens the dmg, Windows runs msiexec, Linux gets an executable AppImage. */
  handoff: "open-dmg" | "msiexec" | "appimage";
}

/** Installer for the host. Release asset names use the `artcraft-launcher-` prefix (probed on v0.4.1). */
export function installerAsset(platform: string, arch: string, version: string): InstallerAsset {
  const p = `artcraft-launcher-${version}`;
  if (platform === "darwin") return { name: `${p}-macos-universal.dmg`, handoff: "open-dmg" };
  if (platform === "win32") {
    const a = ({ x64: "x64", arm64: "arm64", ia32: "x86" } as Record<string, string>)[arch];
    if (a) return { name: `${p}-windows-${a}.msi`, handoff: "msiexec" };
  }
  if (platform === "linux") {
    const a = ({ x64: "x86_64", arm64: "aarch64" } as Record<string, string>)[arch];
    if (a) return { name: `${p}-linux-${a}.AppImage`, handoff: "appimage" };
  }
  throw new ProvisionError(`unsupported platform: ${platform}/${arch} has no Craft Launcher installer`);
}

export interface LauncherInstallReport {
  version: string;
  asset: string;
  file: string;
  handoff: InstallerAsset["handoff"];
}

export async function installLauncher(deps: ProvisionDeps): Promise<LauncherInstallReport> {
  const release = await apiJson(deps, `${deps.apiBase}/repos/${LAUNCHER_REPO}/releases/latest`);
  const version = release.tag_name.replace(/^v/, "");
  const asset = installerAsset(deps.platform, deps.arch, version);
  const dir = path.join(craftRoot(deps), "craft-launcher", version);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, asset.name);
  try {
    await downloadVerified(deps, release, asset.name, file);
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
  if (asset.handoff === "open-dmg") await deps.exec("open", [file]);
  else if (asset.handoff === "msiexec") await deps.exec("msiexec", ["/i", file]);
  else fs.chmodSync(file, 0o755);
  return { version, asset: asset.name, file, handoff: asset.handoff };
}

/** Per-app launcher state for `pi-craft launcher status` (no network). */
export function launcherStatus(deps: Pick<ProvisionDeps, "env" | "platform" | "homedir">) {
  return CRAFT_APPS.map((app) => launcherAppState(app, deps));
}
