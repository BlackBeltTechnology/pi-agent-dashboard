import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envSearchDirs, parseEnvFile, resolveGeminiKey } from "../env.js";

describe("parseEnvFile", () => {
  it("parses KEY=VALUE, ignores comments/blanks, strips quotes and export", () => {
    const body = ["# comment", "", "export GEMINI_API_KEY='abc'", 'GOOGLE_API_KEY="xyz"', "BAD"].join("\n");
    expect(parseEnvFile(body)).toEqual({ GEMINI_API_KEY: "abc", GOOGLE_API_KEY: "xyz" });
  });
});

describe("envSearchDirs", () => {
  it("returns base plus up to two parents, nearest first, deduped", () => {
    const dirs = envSearchDirs("/a/b/c");
    expect(dirs).toEqual(["/a/b/c", "/a/b", "/a"]);
  });
});

describe("resolveGeminiKey", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("prefers cliKey over everything", () => {
    const r = resolveGeminiKey({ cliKey: "flagkey", env: { GEMINI_API_KEY: "envkey" } });
    expect(r).toEqual({ key: "flagkey", source: "--api-key flag" });
  });

  it("falls back to process env when no flag", () => {
    const r = resolveGeminiKey({ env: { GOOGLE_API_KEY: "gkey" }, baseDir: os.tmpdir() });
    expect(r.key).toBe("gkey");
    expect(r.source).toBe("env:GOOGLE_API_KEY");
  });

  it("reads a project-local .env when env is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-env-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=fromfile\n");
    const r = resolveGeminiKey({ env: {}, baseDir: dir, packageDir: dir });
    expect(r.key).toBe("fromfile");
    expect(r.source).toContain(".env (GEMINI_API_KEY)");
  });

  it("returns not-found when nothing resolves", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-env-"));
    tmpDirs.push(dir);
    const r = resolveGeminiKey({ env: {}, baseDir: dir, packageDir: dir });
    expect(r.key).toBeUndefined();
    expect(r.source).toBe("not found");
  });
});
