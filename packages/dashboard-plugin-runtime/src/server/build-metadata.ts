/**
 * Build declaration — the self-description a production client build writes
 * alongside its assets (`packages/client/dist/pi-dashboard-build.json`).
 *
 * It records the schema version, the same plugin-registry hash that is
 * embedded in the bundle, and the fixture policy the build applied. The server
 * reads it to report whether the static artifact it serves agrees with its
 * runtime plugin set (design D4); the sync helper compares two of them
 * directory-to-directory (design D5).
 *
 * Deliberately free of host-dependent fields: no timestamp, path, or host
 * name, so two builds of the same sources produce byte-identical declarations.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D1).
 */

import fs from "node:fs";
import path from "node:path";

/** Filename of the declaration, written into the client build output directory. */
export const BUILD_DECLARATION_FILENAME = "pi-dashboard-build.json";

/** Declaration schema version. Bump only on an incompatible shape change. */
export const BUILD_DECLARATION_SCHEMA_VERSION = 1;

/**
 * Fixture policy a build applied. Closed enum — never host data.
 * `"excluded"` = a production build (`fixture: true` plugins dropped);
 * `"included"` = a dev build.
 */
export type FixturePolicy = "excluded" | "included";

export interface BuildDeclaration {
  schemaVersion: number;
  pluginRegistryHash: string;
  fixturePolicy: FixturePolicy;
}

/**
 * Outcome of reading a declaration. Every variant is non-throwing; only
 * `valid` carries a usable declaration. The distinct failure kinds exist so the
 * server can report *why* an artifact is undescribed without leaking a path.
 */
export type BuildDeclarationRead =
  | { kind: "valid"; declaration: BuildDeclaration }
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "schema-mismatch" }
  | { kind: "hash-missing" }
  | { kind: "policy-unknown" };

/** Absolute path of the declaration file inside build output directory `dir`. */
export function buildDeclarationPath(dir: string): string {
  return path.join(dir, BUILD_DECLARATION_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed declaration object. Returns the read outcome so callers get
 * the same discriminated result from an in-memory object and from disk.
 */
export function validateBuildDeclaration(value: unknown): BuildDeclarationRead {
  if (!isRecord(value)) return { kind: "malformed" };
  if (value.schemaVersion !== BUILD_DECLARATION_SCHEMA_VERSION) {
    return { kind: "schema-mismatch" };
  }
  const hash = value.pluginRegistryHash;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return { kind: "hash-missing" };
  }
  const policy = value.fixturePolicy;
  if (policy !== "excluded" && policy !== "included") {
    return { kind: "policy-unknown" };
  }
  return {
    kind: "valid",
    declaration: {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: hash,
      fixturePolicy: policy,
    },
  };
}

/**
 * Read and validate the build declaration in `dir`. Never throws: an absent,
 * unreadable (EACCES, or a directory in its place), malformed, or
 * schema-incompatible file yields its own outcome.
 */
export function readBuildDeclaration(dir: string): BuildDeclarationRead {
  let raw: string;
  try {
    raw = fs.readFileSync(buildDeclarationPath(dir), "utf-8");
  } catch {
    // Absent and unreadable are the same actionable condition server-side
    // (metadata-missing). The error message is deliberately not surfaced — it
    // embeds an absolute path (design D4).
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "malformed" };
  }

  return validateBuildDeclaration(parsed);
}

/** True when a read produced a usable declaration. */
export function isUsableDeclaration(
  read: BuildDeclarationRead,
): read is { kind: "valid"; declaration: BuildDeclaration } {
  return read.kind === "valid";
}

/**
 * Write a declaration into `dir`, creating the directory if needed. Key order
 * is fixed by the object literal at every call site, so repeated writes are
 * byte-identical.
 */
export function writeBuildDeclaration(dir: string, declaration: BuildDeclaration): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    buildDeclarationPath(dir),
    `${JSON.stringify(declaration, null, 2)}\n`,
    "utf-8",
  );
}
