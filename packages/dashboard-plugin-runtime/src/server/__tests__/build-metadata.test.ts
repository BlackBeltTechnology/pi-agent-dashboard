/**
 * Build-declaration read/validate/write tests — folds test-plan scenario E9
 * (six non-throwing outcomes) plus a valid round-trip and writer determinism.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_DECLARATION_FILENAME,
  BUILD_DECLARATION_SCHEMA_VERSION,
  type BuildDeclaration,
  buildDeclarationPath,
  isUsableDeclaration,
  readBuildDeclaration,
  writeBuildDeclaration,
} from "../build-metadata.js";

const HASH = "4e1f10fbdbfd764dc7f026c43aabf87f0b79ab5a5b0aa4148cb68918a4ef080c";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-decl-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(dir, name), contents, "utf-8");
}

describe("build-metadata", () => {
  it("round-trips a valid declaration", () => {
    const declaration: BuildDeclaration = {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: HASH,
      fixturePolicy: "excluded",
    };
    writeBuildDeclaration(dir, declaration);

    const read = readBuildDeclaration(dir);
    expect(read.kind).toBe("valid");
    expect(isUsableDeclaration(read)).toBe(true);
    if (isUsableDeclaration(read)) expect(read.declaration).toEqual(declaration);
  });

  it("writes the fixed filename", () => {
    writeBuildDeclaration(dir, {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: HASH,
      fixturePolicy: "included",
    });
    expect(fs.existsSync(path.join(dir, BUILD_DECLARATION_FILENAME))).toBe(true);
    expect(fs.existsSync(buildDeclarationPath(dir))).toBe(true);
  });

  it("is byte-deterministic for the same declaration", () => {
    const declaration: BuildDeclaration = {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: HASH,
      fixturePolicy: "excluded",
    };
    writeBuildDeclaration(dir, declaration);
    const first = fs.readFileSync(buildDeclarationPath(dir), "utf-8");
    writeBuildDeclaration(dir, declaration);
    expect(fs.readFileSync(buildDeclarationPath(dir), "utf-8")).toBe(first);
  });

  it("E9 yields six distinct non-throwing outcomes, only the first usable", () => {
    // 1. absent
    expect(readBuildDeclaration(dir).kind).toBe("missing");

    // 2. malformed JSON
    write(BUILD_DECLARATION_FILENAME, "{ not json");
    expect(readBuildDeclaration(dir).kind).toBe("malformed");

    // 3. wrong schemaVersion
    write(
      BUILD_DECLARATION_FILENAME,
      JSON.stringify({ schemaVersion: 999, pluginRegistryHash: HASH, fixturePolicy: "excluded" }),
    );
    expect(readBuildDeclaration(dir).kind).toBe("schema-mismatch");

    // 4. missing hash
    write(
      BUILD_DECLARATION_FILENAME,
      JSON.stringify({ schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION, fixturePolicy: "excluded" }),
    );
    expect(readBuildDeclaration(dir).kind).toBe("hash-missing");

    // 5. unknown fixturePolicy
    write(
      BUILD_DECLARATION_FILENAME,
      JSON.stringify({
        schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
        pluginRegistryHash: HASH,
        fixturePolicy: "maybe",
      }),
    );
    expect(readBuildDeclaration(dir).kind).toBe("policy-unknown");

    // 6. valid
    writeBuildDeclaration(dir, {
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: HASH,
      fixturePolicy: "excluded",
    });
    expect(readBuildDeclaration(dir).kind).toBe("valid");
  });

  it("treats an unreadable declaration as missing, not throwing", () => {
    // A directory in the file's place is unreadable as a file on every platform.
    fs.mkdirSync(buildDeclarationPath(dir), { recursive: true });
    expect(readBuildDeclaration(dir).kind).toBe("missing");
  });
});
