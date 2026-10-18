/**
 * Theme names pi can resolve, for the pi settings page's Terminal theme control.
 *
 * Built-ins (`system`, `dark`, `light`) plus the global and package theme files
 * pi resolves. pi identifies a theme by the `name` field INSIDE the file (pi
 * `docs/themes.md`), so each file is read; the basename is only a fallback.
 * Unreadable / unparseable files are skipped, `system` is reserved, names with
 * `/` are dropped (the `light/dark` pair form uses it). Project-local themes are
 * out of scope — the editor targets the GLOBAL file. Any scanner failure or a
 * timeout yields the built-ins only: the settings read never fails on themes.
 *
 * See change: pi-settings-full-coverage (design D6).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export const BUILTIN_PI_THEMES = ["system", "dark", "light"] as const;

/** Bound on pi's resolver (it has its own 5 s budget; the settings read must not wait that long). */
const SCAN_TIMEOUT_MS = 3_000;

export type ScanThemes = () => Promise<Pick<PiResourcesResult, "global" | "packages">>;

/** Theme name declared by a file, falling back to its basename; `null` when unusable. */
function themeNameOf(file: string): string | null {
  let declared: unknown;
  try {
    declared = (JSON.parse(readFileSync(file, "utf-8")) as { name?: unknown }).name;
  } catch {
    return null;
  }
  const name = typeof declared === "string" && declared.trim() ? declared.trim() : basename(file).replace(/\.[^.]+$/, "");
  return name === "system" || name.includes("/") ? null : name;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("theme scan timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

export async function listPiThemes(scan: ScanThemes): Promise<string[]> {
  const names = new Set<string>(BUILTIN_PI_THEMES);
  try {
    const found = await withTimeout(scan(), SCAN_TIMEOUT_MS);
    const files: PiResource[] = [...found.global.themes, ...found.packages.flatMap((p) => p.resources.themes)];
    for (const f of files) {
      if (f.enabled === false) continue;
      const name = themeNameOf(f.filePath);
      if (name) names.add(name);
    }
  } catch {
    return [...BUILTIN_PI_THEMES].sort();
  }
  return [...names].sort();
}
