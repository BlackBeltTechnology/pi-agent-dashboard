import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVeoKey } from "../env.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("resolveVeoKey", () => {
  it("prefers VEO_API_KEY over GEMINI_API_KEY in the environment", () => {
    const r = resolveVeoKey({ env: { GEMINI_API_KEY: "g", VEO_API_KEY: "v" }, baseDir: os.tmpdir() });
    expect(r.key).toBe("v");
    expect(r.source).toBe("env:VEO_API_KEY");
  });

  it("reads a project-local .env when env is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "veo-env-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, ".env"), "VEO_API_KEY=fromfile\n");
    const r = resolveVeoKey({ env: {}, baseDir: dir, packageDir: dir });
    expect(r.key).toBe("fromfile");
  });

  it("returns not-found when nothing resolves", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "veo-env-"));
    tmpDirs.push(dir);
    const r = resolveVeoKey({ env: {}, baseDir: dir, packageDir: dir });
    expect(r.key).toBeUndefined();
    expect(r.source).toBe("not found");
  });
});
