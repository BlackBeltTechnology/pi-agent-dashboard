/**
 * build-image.sh tagging (change: fix-doc-engine-arm64-chromium, D8).
 * A stub `docker` on PATH logs argv; nothing is built.
 */
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine");
const SCRIPT = join(ENGINE, "build-image.sh");
let tmp: string;
let version: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "build-image-"));
  version = (await readFile(join(ENGINE, "IMAGE_VERSION"), "utf8")).trim();
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function run(env: Record<string, string | undefined>, dockerRc = 0) {
  const dir = await mkdtemp(join(tmp, "case-"));
  const log = join(dir, "docker.log");
  const stub = join(dir, "docker");
  await writeFile(stub, `#!/bin/sh\necho "$@" >> "${log}"\nexit ${dockerRc}\n`);
  chmodSync(stub, 0o755);
  const e: Record<string, string | undefined> = { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const r = spawnSync("bash", [SCRIPT], { env: e as NodeJS.ProcessEnv, encoding: "utf8" });
  let calls = "";
  try {
    calls = await readFile(log, "utf8");
  } catch {}
  return { r, calls };
}

describe("build-image.sh tagging", () => {
  it("E6: default builds <version> and :latest in one docker build", async () => {
    const { r, calls } = await run({ IMAGE_TAG: undefined });
    expect(r.status).toBe(0);
    const builds = calls.split("\n").filter((l) => l.startsWith("build"));
    expect(builds).toHaveLength(1);
    expect(builds[0]).toContain(`-t pi-doc-engine:${version}`);
    expect(builds[0]).toContain("-t pi-doc-engine:latest");
  });

  it("E7: IMAGE_TAG override builds only that tag", async () => {
    const { r, calls } = await run({ IMAGE_TAG: "pi-doc-engine:dev" });
    expect(r.status).toBe(0);
    expect(calls).toContain("-t pi-doc-engine:dev");
    expect(calls).not.toContain(":latest");
  });

  it("E8a: explicit default tag still gets no :latest", async () => {
    const { r, calls } = await run({ IMAGE_TAG: `pi-doc-engine:${version}` });
    expect(r.status).toBe(0);
    expect(calls).toContain(`-t pi-doc-engine:${version}`);
    expect(calls).not.toContain(":latest");
  });

  it("E8b: empty IMAGE_TAG is treated as unset", async () => {
    const { r, calls } = await run({ IMAGE_TAG: "" });
    expect(r.status).toBe(0);
    expect(calls).toContain(`-t pi-doc-engine:${version}`);
    expect(calls).toContain("-t pi-doc-engine:latest");
  });

  it("E8c: docker failure → non-zero exit and no Built line", async () => {
    const { r } = await run({ IMAGE_TAG: undefined }, 1);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/^Built /m);
  });
});

