/**
 * Staged swap fault injection on `update`: #E5 rollback, #E6 restore failure,
 * #E7 backup delete failure, #E8 Windows rename retry.
 * See change: add-pi-spec-driven-schema.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateWorkflowSchema,
  resolveDeps,
  runWorkflowSchemaAction,
  type FsOps,
} from "../openspec/workflow-schema.js";
import { listDirNames, makeFakeCli, mkRepo, snapshotTree, stubDeps, type FakeCli } from "./helpers/workflow-schema-fixtures.js";

let root: string;
let fake: FakeCli;
const realFs = resolveDeps().fs;
const schemasDir = (): string => path.join(root, "openspec", "schemas");
const eperm = (): NodeJS.ErrnoException => Object.assign(new Error("EPERM"), { code: "EPERM" });
const isStagingToTarget = (from: string, to: string): boolean =>
  path.basename(from).startsWith(".fork-staging-") && path.basename(to) === "pi-spec-driven";
const isRestore = (from: string, to: string): boolean =>
  path.basename(from).includes(".fork-backup-") && path.basename(to) === "pi-spec-driven";

beforeEach(async () => {
  root = mkRepo();
  fake = makeFakeCli();
  const g = await generateWorkflowSchema({ root, previousDefault: "spec-driven" }, stubDeps(fake));
  expect(g.ok).toBe(true);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const update = (fsOver: Partial<FsOps>, extra: Parameters<typeof stubDeps>[1] = {}) =>
  runWorkflowSchemaAction(
    { cwd: root, action: "update" },
    stubDeps(fake, { fs: { ...realFs, ...fsOver }, ...extra }),
  );

describe("staged swap", () => {
  it("#E5 a failing final rename restores the previous directory byte-identically", async () => {
    const before = snapshotTree(root);
    const res = await update({
      rename: async (from, to) => {
        if (isStagingToTarget(from, to)) throw Object.assign(new Error("EIO"), { code: "EIO" });
        return realFs.rename(from, to);
      },
    });
    expect(res.ok).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
    expect(listDirNames(schemasDir())).toEqual(["pi-spec-driven"]);
  });

  it("#E6 a restore that also fails leaves the backup in place and names it in the error", async () => {
    let restoreAttempts = 0;
    const sleeps: number[] = [];
    const res = await update(
      {
        rename: async (from, to) => {
          if (isStagingToTarget(from, to)) throw eperm();
          if (isRestore(from, to)) {
            restoreAttempts++;
            throw eperm();
          }
          return realFs.rename(from, to);
        },
      },
      { platform: "win32", sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(res.ok).toBe(false);
    expect(restoreAttempts).toBe(6);
    const backups = listDirNames(schemasDir()).filter((n) => n.startsWith("pi-spec-driven.fork-backup-"));
    expect(backups).toHaveLength(1);
    expect(res.error).toContain(backups[0]);
    expect(listDirNames(schemasDir()).filter((n) => n.startsWith(".fork-staging-"))).toEqual([]);
  });

  it("#E7 a failing backup delete keeps the new schema and warns without rolling back", async () => {
    // make the existing schema outdated so the new one is distinguishable
    const yaml = path.join(schemasDir(), "pi-spec-driven", "schema.yaml");
    fs.writeFileSync(yaml, fs.readFileSync(yaml, "utf8").replace("patch: 1", "patch: 0"));
    const res = await update({
      rm: async (target) => {
        if (path.basename(target).includes(".fork-backup-")) throw new Error("EBUSY backup");
        return realFs.rm(target);
      },
    });
    expect(res.ok).toBe(true);
    expect(res.warnings?.some((w) => w.includes("backup"))).toBe(true);
    expect(fs.readFileSync(yaml, "utf8")).toContain("patch: 1");
    expect(res.status).toBe("current");
  });

  it("#E8 five EPERM failures then success swaps within the 2 s retry window", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const res = await update(
      {
        rename: async (from, to) => {
          if (isStagingToTarget(from, to) && n++ < 5) throw eperm();
          return realFs.rename(from, to);
        },
      },
      { platform: "win32", sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(res.ok).toBe(true);
    expect(n).toBe(6);
    expect(sleeps).toHaveLength(5);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2000);
    expect(listDirNames(schemasDir())).toEqual(["pi-spec-driven"]);
  });

  it("#E8 six EPERM failures roll back; previous directory byte-identical", async () => {
    const before = snapshotTree(root);
    let n = 0;
    const res = await update(
      {
        rename: async (from, to) => {
          if (isStagingToTarget(from, to)) {
            n++;
            throw eperm();
          }
          return realFs.rename(from, to);
        },
      },
      { platform: "win32" },
    );
    expect(res.ok).toBe(false);
    expect(n).toBe(6);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E8 does not retry on non-Windows platforms", async () => {
    let n = 0;
    const res = await update(
      {
        rename: async (from, to) => {
          if (isStagingToTarget(from, to)) {
            n++;
            throw eperm();
          }
          return realFs.rename(from, to);
        },
      },
      { platform: "linux" },
    );
    expect(res.ok).toBe(false);
    expect(n).toBe(1);
  });
});
