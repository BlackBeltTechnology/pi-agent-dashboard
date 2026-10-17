/**
 * Detect an installed OBS per OS (design D9) without modifying it:
 *   darwin `/Applications/OBS.app`, then `~/Applications/OBS.app` (usable, but
 *          the virtual camera needs `/Applications`, spike F8);
 *   win32  registry `HKLM\SOFTWARE\OBS Studio` (default value = install dir),
 *          then the portable copy under the state dir;
 *   linux  `obs` on PATH, then `flatpak info com.obsproject.Studio`.
 * Version below 28 → `unsupported-version`. Pure over injected `exists`,
 * `readFile` and `run`. See change: add-obs-studio-plugin.
 */
import path from "node:path";
import type { HostEnv } from "./paths.js";
import { portableRoot } from "./paths.js";

export type RunFn = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>;

export interface DetectDeps {
  host: HostEnv;
  state: string;
  exists: (p: string) => boolean;
  readFile: (p: string) => string;
  run: RunFn;
}

export interface Installation {
  found: boolean;
  path?: string;
  /** Binary to launch (win32 `obs64.exe`, linux `obs`) or the `.app` (darwin). */
  executable?: string;
  version?: string;
  arch?: string;
  variant?: "app" | "user-app" | "registry" | "portable" | "path" | "flatpak";
  supported?: boolean;
  warnings: string[];
}

const MIN_MAJOR = 28;

function majorOf(version: string | undefined): number | undefined {
  const m = /^(\d+)\./.exec(version ?? "");
  return m ? Number(m[1]) : undefined;
}

function finish(i: Omit<Installation, "supported" | "warnings"> & { warnings?: string[] }): Installation {
  const major = majorOf(i.version);
  return { ...i, warnings: i.warnings ?? [], supported: major === undefined ? true : major >= MIN_MAJOR };
}

function plistVersion(xml: string): string | undefined {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)?.[1];
}

async function detectDarwin(d: DetectDeps): Promise<Installation> {
  const candidates: Array<[string, Installation["variant"]]> = [
    ["/Applications/OBS.app", "app"],
    [path.join(d.host.home, "Applications", "OBS.app"), "user-app"],
  ];
  for (const [app, variant] of candidates) {
    if (!d.exists(app)) continue;
    let version: string | undefined;
    try {
      version = plistVersion(d.readFile(path.join(app, "Contents", "Info.plist")));
    } catch {
      /* unreadable plist: version unknown */
    }
    const lipo = await d.run("lipo", ["-archs", path.join(app, "Contents", "MacOS", "OBS")]).catch(() => ({ code: 1, stdout: "" }));
    const warnings = variant === "user-app" ? ["OBS is outside /Applications: the virtual camera is unavailable until it is moved there"] : [];
    return finish({ found: true, path: app, executable: app, version, arch: lipo.code === 0 ? lipo.stdout.trim() || undefined : undefined, variant, warnings });
  }
  return { found: false, warnings: [] };
}

async function detectWin32(d: DetectDeps): Promise<Installation> {
  const reg = await d.run("reg", ["query", "HKLM\\SOFTWARE\\OBS Studio", "/ve"]).catch(() => ({ code: 1, stdout: "" }));
  const dir = reg.code === 0 ? /REG_SZ\s+(.+)$/m.exec(reg.stdout)?.[1]?.trim() : undefined;
  if (dir) {
    const exe = path.win32.join(dir, "bin", "64bit", "obs64.exe");
    if (d.exists(exe)) return finish({ found: true, path: dir, executable: exe, variant: "registry", arch: "x64" });
  }
  const root = portableRoot(d.state);
  const exe = path.join(root, "bin", "64bit", "obs64.exe");
  if (d.exists(exe)) return finish({ found: true, path: root, executable: exe, variant: "portable", arch: "x64" });
  return { found: false, warnings: [] };
}

async function detectLinux(d: DetectDeps): Promise<Installation> {
  const which = await d.run("which", ["obs"]).catch(() => ({ code: 1, stdout: "" }));
  if (which.code === 0 && which.stdout.trim()) {
    const exe = which.stdout.trim().split("\n")[0];
    const v = await d.run(exe, ["--version"]).catch(() => ({ code: 1, stdout: "" }));
    return finish({ found: true, path: exe, executable: exe, variant: "path", version: /(\d+\.\d+(?:\.\d+)?)/.exec(v.stdout)?.[1] });
  }
  const fp = await d.run("flatpak", ["info", "com.obsproject.Studio"]).catch(() => ({ code: 1, stdout: "" }));
  if (fp.code === 0) {
    return finish({ found: true, path: "com.obsproject.Studio", executable: "flatpak", variant: "flatpak", version: /Version:\s*(\S+)/.exec(fp.stdout)?.[1] });
  }
  return { found: false, warnings: [] };
}

export function detectObs(d: DetectDeps): Promise<Installation> {
  if (d.host.platform === "darwin") return detectDarwin(d);
  if (d.host.platform === "win32") return detectWin32(d);
  return detectLinux(d);
}

/** argv to start OBS minimized (design D5 step 6) and the spawn cwd. */
export function launchArgv(inst: Installation, platform: HostEnv["platform"]): { argv: string[]; cwd?: string } {
  const flags = ["--minimize-to-tray", "--disable-updater"];
  if (platform === "darwin") return { argv: ["open", "-a", inst.executable ?? "OBS", "--args", ...flags] };
  if (platform === "win32") {
    const exe = inst.executable ?? "obs64.exe";
    return { argv: [exe, ...flags, ...(inst.variant === "portable" ? ["--portable"] : [])], cwd: path.win32.dirname(exe) };
  }
  if (inst.variant === "flatpak") return { argv: ["flatpak", "run", "com.obsproject.Studio", "--minimize-to-tray"] };
  return { argv: [inst.executable ?? "obs", ...flags] };
}
