/**
 * Stamp comparison + status evaluation: #E10 decision table, #E11 validate memo.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareStamp,
  computeWorkflowSchemaStatus,
  evaluateSchemaStatus,
  parseStamp,
} from "../openspec/workflow-schema.js";
import { makeFakeCli, mkRepo, stubDeps, writeSchemaDir, write } from "./helpers/workflow-schema-fixtures.js";
import type { Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";

const roots: string[] = [];
const repo = (...a: Parameters<typeof mkRepo>): string => {
  const r = mkRepo(...a);
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const LOCAL = { base: "1.11.0", patch: 1 };

describe("compareStamp / evaluateSchemaStatus", () => {
  it.each([
    [{ base: "1.11.0", patch: 1 }, "current"],
    [{ base: "1.10.0", patch: 1 }, "outdated"],
    [{ base: "1.11.0", patch: 0 }, "outdated"],
    [{ base: "1.12.0", patch: 1 }, "newer"],
    [{ base: "1.11.0", patch: 2 }, "newer"],
    [{ base: "1.12.0", patch: 0 }, "conflict"],
    [{ base: "1.10.0", patch: 2 }, "conflict"],
  ] as const)("#E10 stamp %j vs local (1.11.0,1) → %s", async (stamp, expected) => {
    expect(compareStamp(stamp, LOCAL)).toBe(expected);
    // and through the filesystem evaluation (validate passes → status unchanged)
    const root = repo();
    writeSchemaDir(root, stamp);
    const fake = makeFakeCli();
    expect(await evaluateSchemaStatus(root, "1.11.0", stubDeps(fake))).toBe(expected);
  });

  it("#E10 a directory without a stamp is unmanaged", async () => {
    const root = repo();
    writeSchemaDir(root, null);
    expect(await evaluateSchemaStatus(root, "1.11.0", stubDeps(makeFakeCli()))).toBe("unmanaged");
  });

  it("#E10 a symlinked directory is unmanaged", async () => {
    const root = repo();
    const elsewhere = repo();
    const target = writeSchemaDir(elsewhere, { base: "1.11.0", patch: 1 });
    fs.mkdirSync(path.join(root, "openspec", "schemas"), { recursive: true });
    fs.symlinkSync(target, path.join(root, "openspec", "schemas", "pi-spec-driven"));
    expect(await evaluateSchemaStatus(root, "1.11.0", stubDeps(makeFakeCli()))).toBe("unmanaged");
  });

  it("#E10 no directory is none", async () => {
    expect(await evaluateSchemaStatus(repo(), "1.11.0", stubDeps(makeFakeCli()))).toBe("none");
  });

  it("#E10 a stamp previousDefault that is not a kebab-case id is treated as absent", () => {
    const text = "x-pi-dashboard:\n  derivedFrom: spec-driven@1.11.0\n  patch: 1\n  previousDefault: pi-spec-driven\n";
    expect(parseStamp(text)).toEqual({ base: "1.11.0", patch: 1, previousDefault: null });
  });

  it("#E11 a newer stamp whose local validate fails is incompatible; validate runs once through the semaphore", async () => {
    const root = repo();
    writeSchemaDir(root, { base: "1.12.0", patch: 2 });
    const fake = makeFakeCli({ localValidateFails: true });
    let semRuns = 0;
    const semaphore: Semaphore = {
      run: (fn) => {
        semRuns++;
        return fn();
      },
      setMax: () => undefined,
      size: () => 0,
    };
    const deps = stubDeps(fake, { semaphore });
    for (let i = 0; i < 3; i++) {
      expect(await evaluateSchemaStatus(root, "1.11.0", deps)).toBe("incompatible");
    }
    expect(fake.count("validate")).toBe(1);
    expect(semRuns).toBe(1);
    // a different CLI version is a different memo key
    await evaluateSchemaStatus(root, "1.11.1", deps);
    expect(fake.count("validate")).toBe(2);
  });
});

describe("computeWorkflowSchemaStatus (poll-side status, no CLI)", () => {
  const status = (root: string, packageSchemasDir: string | null, user = "/nonexistent-user-schemas") =>
    computeWorkflowSchemaStatus(root, { localVersion: "1.11.0", packageSchemasDir, userSchemasDirPath: user });

  it("reports configured, generated, affected and unpinned changes from files alone", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 1 });
    write(root, "openspec/changes/a/proposal.md", "x");
    write(root, "openspec/changes/b/.openspec.yaml", "schema: pi-spec-driven\n");
    write(root, "openspec/changes/c/.openspec.yaml", "schema: spec-driven\n");
    write(root, "openspec/changes/archive/old/.openspec.yaml", "schema: pi-spec-driven\n");
    expect(await status(root, "/pkg")).toEqual({
      configured: "pi-spec-driven",
      generated: "current",
      missing: false,
      unpinnedChanges: ["a"],
      affectedChanges: ["a", "b"],
    });
  });

  it("flags a configured schema that resolves nowhere as missing; computes no unpinned list otherwise", async () => {
    const root = repo({ config: "schema: team-flow\n" });
    write(root, "openspec/changes/a/proposal.md", "x");
    const s = await status(root, "/pkg");
    expect(s.missing).toBe(true);
    expect(s.unpinnedChanges).toEqual([]);
    expect(s.affectedChanges).toEqual([]);
    const pkg = repo({ config: null });
    write(pkg, "schemas/team-flow/schema.yaml", "name: team-flow\n");
    expect((await status(root, path.join(pkg, "schemas"))).missing).toBe(false);
  });

  it("with the schema dir absent, affectedChanges still comes from files", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    write(root, "openspec/changes/a/proposal.md", "x");
    write(root, "openspec/changes/b/.openspec.yaml", "schema: pi-spec-driven\n");
    write(root, "openspec/changes/c/.openspec.yaml", "schema: spec-driven\n");
    const s = await status(root, "/pkg");
    expect(s.generated).toBe("none");
    expect(s.missing).toBe(true);
    expect(s.affectedChanges).toEqual(["a", "b"]);
  });
});
