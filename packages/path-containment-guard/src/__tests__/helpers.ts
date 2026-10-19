import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import type { ResolveEnv } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";

export const ROOTS_VAR = "PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS";
export const DENIED_VAR = "PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS";

/** Fake POSIX filesystem: identity realpath, nothing exists, no symlinks. */
export const fakeEnv = (over: Partial<ResolveEnv> = {}): ResolveEnv => ({
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => p,
  exists: () => false,
  isDirectory: () => false,
  ...over,
});

export const envOf = (roots: unknown, denied?: unknown): Record<string, string> => {
  const e: Record<string, string> = {};
  if (roots !== undefined) e[ROOTS_VAR] = typeof roots === "string" ? roots : JSON.stringify(roots);
  if (denied !== undefined) e[DENIED_VAR] = typeof denied === "string" ? denied : JSON.stringify(denied);
  return e;
};

export interface TmpTree {
  /** realpath of the temp dir (macOS /var → /private/var). */
  real: string;
  p: (...parts: string[]) => string;
  dir: (...parts: string[]) => string;
  file: (rel: string, body?: string) => string;
  link: (rel: string, target: string) => string;
  cleanup: () => void;
}

export function tmpTree(): TmpTree {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pcg-"));
  const real = fs.realpathSync(tmp);
  const p = (...parts: string[]) => nodePath.join(real, ...parts);
  return {
    real,
    p,
    dir: (...parts) => {
      fs.mkdirSync(p(...parts), { recursive: true });
      return p(...parts);
    },
    file: (rel, body = "x") => {
      fs.mkdirSync(nodePath.dirname(p(rel)), { recursive: true });
      fs.writeFileSync(p(rel), body);
      return p(rel);
    },
    link: (rel, target) => {
      fs.mkdirSync(nodePath.dirname(p(rel)), { recursive: true });
      fs.symlinkSync(target, p(rel));
      return p(rel);
    },
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
