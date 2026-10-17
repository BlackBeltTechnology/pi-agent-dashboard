/**
 * `pi-obs install` — detect first, print the exact plan, confirm, never a
 * silent download (design D9).
 *   darwin  `brew install --cask obs` (target `/Applications`, required for the
 *           virtual camera); no `brew` → manual obsproject.com instruction.
 *   win32   `winget install --id OBSProject.OBSStudio -e`, or `--portable`: the
 *           GitHub release zip verified against the asset's published SHA-256
 *           `digest` (refused when absent), extracted with zip-slip / symlink
 *           rejection into `<state>/apps/obs/` + `portable_mode.txt`.
 *   linux   `flatpak install --user flathub com.obsproject.Studio`.
 * Non-interactive without `--yes` → plan printed, exit non-zero, nothing run.
 * `--yes` skips only the CLI prompt; the skill MUST ask the user first.
 * See change: add-obs-studio-plugin.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ObsError } from "./errors.js";
import { type Platform, portableRoot } from "./paths.js";
import { extractZip } from "./zip.js";

const MANUAL_INSTRUCTION = "Download OBS Studio from https://obsproject.com/download and install it (macOS: drag OBS.app into /Applications), then run `pi-obs doctor`.";

export type InstallPlan =
  | { kind: "command"; argv: string[]; target: string }
  | { kind: "portable"; target: string }
  | { kind: "manual"; instruction: string };

export function planInstall(platform: Platform, has: (cmd: string) => boolean, opts: { portable?: boolean; state: string }): InstallPlan {
  if (platform === "darwin") {
    return has("brew") ? { kind: "command", argv: ["brew", "install", "--cask", "obs"], target: "/Applications/OBS.app" } : { kind: "manual", instruction: MANUAL_INSTRUCTION };
  }
  if (platform === "win32") {
    if (opts.portable) return { kind: "portable", target: portableRoot(opts.state) };
    return has("winget") ? { kind: "command", argv: ["winget", "install", "--id", "OBSProject.OBSStudio", "-e"], target: "Program Files (winget)" } : { kind: "manual", instruction: MANUAL_INSTRUCTION };
  }
  return has("flatpak")
    ? { kind: "command", argv: ["flatpak", "install", "--user", "flathub", "com.obsproject.Studio"], target: "~/.local/share/flatpak (per user)" }
    : { kind: "manual", instruction: MANUAL_INSTRUCTION };
}

export function describePlan(p: InstallPlan): string {
  if (p.kind === "command") return `Will run: ${p.argv.join(" ")}  (target: ${p.target})`;
  if (p.kind === "portable") return `Will download the latest OBS Studio Windows zip from GitHub, verify its published SHA-256 digest, and extract it to ${p.target}`;
  return p.instruction;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
}

/** Pick the portable Windows zip from a GitHub release's assets. */
function pickPortableAsset(assets: readonly ReleaseAsset[]): ReleaseAsset | undefined {
  return assets.find((a) => /windows.*\.zip$/i.test(a.name) && !/installer|pdb|debug/i.test(a.name));
}

export interface PortableDeps {
  state: string;
  fetchJson: (url: string) => Promise<{ assets?: ReleaseAsset[] }>;
  fetchBytes: (url: string) => Promise<Buffer>;
}

const RELEASES_URL = "https://api.github.com/repos/obsproject/obs-studio/releases/latest";

/** Download → digest check → safe extract → `portable_mode.txt`. Nothing is written before both checks pass. */
export async function installPortable(d: PortableDeps): Promise<{ root: string; files: number }> {
  const release = await d.fetchJson(RELEASES_URL);
  const asset = pickPortableAsset(release.assets ?? []);
  if (!asset) throw new ObsError("not-found", "the latest OBS release has no portable Windows zip asset");
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1]?.toLowerCase();
  if (!digest) throw new ObsError("refused", `${asset.name} carries no published SHA-256 digest; refusing an unverifiable download`);
  const bytes = await d.fetchBytes(asset.browser_download_url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== digest) throw new ObsError("refused", `${asset.name} SHA-256 mismatch; nothing was extracted`);
  const root = portableRoot(d.state);
  const files = extractZip(bytes, root);
  fs.writeFileSync(path.join(root, "portable_mode.txt"), "");
  return { root, files };
}
