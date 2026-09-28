/**
 * Shared fakes for the pi-ai compatibility seam tests.
 *
 * Also resolves the REAL ≥0.85 runtime when one is installed, so the factory
 * branch is exercised against the actual module rather than only fixtures.
 * Every such test self-skips when no ≥0.85 pi-ai is resolvable, which is what
 * keeps CI green while the pin is still `^0.75.5` (migration plan step 1).
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LEGACY_MEMBERS } from "../detect.js";

/** A module exposing all seven legacy global members. */
export function legacyFake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const mod: Record<string, unknown> = {};
  for (const m of LEGACY_MEMBERS) mod[m] = () => undefined;
  return { ...mod, ...overrides };
}

/** A module exposing only the factory markers. */
export function factoryFake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { createModels: () => ({}), createProvider: () => ({}), ...overrides };
}

/** Async-iterable stub so a fake `streamSimple` satisfies the contract. */
export async function* emptyStream(): AsyncIterable<any> {
  // yields nothing
}

// ── real-runtime discovery ────────────────────────────────────────────────

export interface RealPiAi {
  path: string;
  version: string;
  module: Record<string, any>;
}

function versionAtLeast(version: string, major: number, minor: number): boolean {
  const [maj, min] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(maj) || Number.isNaN(min)) return false;
  return maj > major || (maj === major && min >= minor);
}

/** Read the package version that owns a `.../dist/index.js` entry. */
export function piAiVersionFor(entryPath: string): string | null {
  const pkg = join(dirname(dirname(entryPath)), "package.json");
  if (!existsSync(pkg)) return null;
  try {
    return JSON.parse(readFileSync(pkg, "utf-8")).version ?? null;
  } catch {
    return null;
  }
}

let cached: RealPiAi | null | undefined;

/**
 * Resolve a ≥0.85 pi-ai the same way production does (the shared tool
 * registry), returning null when the resolved copy is older. Once the pin
 * moves to `^0.86.1` this stops returning null and every guarded test runs.
 */
export async function resolveFactoryPiAi(): Promise<RealPiAi | null> {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const { getDefaultRegistry } = await import("../../tool-registry/index.js");
    const result = await getDefaultRegistry().resolveModule<Record<string, any>>("pi-ai");
    const path = result.resolution.path;
    if (!path) return cached;
    const version = piAiVersionFor(path);
    if (!version || !versionAtLeast(version, 0, 85)) return cached;
    cached = { path, version, module: result.module };
  } catch {
    cached = null;
  }
  return cached;
}

/** Import an absolute path as ESM. */
export function importAbs(absPath: string): Promise<any> {
  return import(pathToFileURL(absPath).href);
}
