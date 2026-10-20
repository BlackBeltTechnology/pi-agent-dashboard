/** Types for `manifest.mjs`. See change: electron-runtime-overlay-updates. */

export type RuntimeOrigin = "bundled" | "npm" | "github";

/** How a bundle's third-party tree was installed. */
export type RuntimeInstallMode = "release-lock" | "floating";

export interface RuntimeManifest {
  /** Runtime release version X (lockstep version of every first-party package). */
  version: string;
  /** Lowest Electron shell version that may host this runtime. */
  minShellVersion: string;
  /** The server's `engines.node` range; the shell's bundled Node must satisfy it. */
  nodeEngines: string;
  origin: RuntimeOrigin;
  /** Asset sha512 (github) or lock integrity (npm); informational. */
  integrity?: string;
  /** pi (coding-agent) version locked by this runtime. */
  piVersion?: string;
  /** Bundle only: `release-lock` = installed from the published runtime lock; `floating` = declared ranges. Absent in source-only bundles / overlays. */
  installMode?: RuntimeInstallMode;
  /** Bundle only: the runtime lock version X installed from (present with `installMode: "release-lock"`). */
  lockVersion?: string;
}

export const RUNTIME_MANIFEST_FILE: "runtime-manifest.json";
export function parseRuntimeManifest(raw: unknown): RuntimeManifest | null;
export function readRuntimeManifest(runtimeRoot: string): RuntimeManifest | null;
export function writeRuntimeManifest(runtimeRoot: string, manifest: RuntimeManifest): void;
