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

const BUILTIN_PI_THEMES = ["system", "dark", "light"] as const;

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

/** `degraded`: the scan failed or timed out, so only the built-ins are listed. */
async function scanThemeNames(scan: ScanThemes): Promise<{ names: string[]; degraded: boolean }> {
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
    return { names: [...BUILTIN_PI_THEMES].sort(), degraded: true };
  }
  return { names: [...names].sort(), degraded: false };
}

export interface ThemeLister {
  list(): Promise<string[]>;
  /** Drop the cached list (a settings write can change `packages` / `themes`). */
  invalidate(): void;
}

/** A good result is reused this long; a degraded one is retried sooner. */
const TTL_MS = 30_000;
const DEGRADED_TTL_MS = 5_000;

/**
 * Theme lister with a short cache and in-flight de-duplication. The scan runs pi's
 * package resolver plus synchronous fs walks, so repeating it on every
 * `GET /api/pi-settings` would add event-loop latency to a hot read.
 */
export function createThemeLister(scan: ScanThemes, now: () => number = Date.now): ThemeLister {
  let cached: { names: string[]; until: number } | null = null;
  let inflight: Promise<string[]> | null = null;
  return {
    list() {
      if (cached && now() < cached.until) return Promise.resolve(cached.names);
      if (inflight !== null) return inflight;
      const run = scanThemeNames(scan).then(({ names, degraded }) => {
        cached = { names, until: now() + (degraded ? DEGRADED_TTL_MS : TTL_MS) };
        return names;
      });
      inflight = run.finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
