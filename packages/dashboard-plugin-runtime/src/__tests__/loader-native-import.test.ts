/**
 * The plugin loader must import a server entry by `file://` URL, never by raw
 * filesystem path. jiti accepted raw paths; the Node-native ESM loader does
 * not: on Windows a raw `D:\…` path is rejected (`Received protocol 'd:'`,
 * win32 CI run 37357886926), and on every OS a raw path is parsed as a URL,
 * so a `#` in a directory name turns the rest of the path into a fragment.
 * The `#` case is the cross-platform reproduction.
 *
 * Runs `loadServerEntries` in a child process under the server's real loader
 * (subprocess harness as in packages/server/src/lib/__tests__/purify-jiti.test.ts);
 * vitest's own module transform would mask the failure.
 * See change: fix-appimage-cold-boot-latency; strip-only-native-ts-loader (test-plan #E27, #E28).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const register = pathToFileURL(path.resolve(here, "../../../shared/src/platform/native-ts-register.mjs")).href;
const fixture = path.join(here, "fixtures", "load-server-entries-native.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("loadServerEntries under the native TS loader", () => {
  it("loads a server entry whose path contains '#'", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-root-#-"));
    dirs.push(root);
    const pkgDir = path.join(root, "packages", "hash-dir-plugin");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "hash-dir-plugin", "pi-dashboard-plugin": { id: "hash-dir-plugin", displayName: "H", server: "./server.mjs", claims: [] } }),
    );
    fs.writeFileSync(path.join(pkgDir, "server.mjs"), "export default async function registerPlugin() {}\n");

    const res = spawnSync(process.execPath, ["--import", register, fixture, root], { encoding: "utf8", timeout: 60_000 });
    expect(res.stderr).not.toMatch(/ERR_/);
    const status = JSON.parse(res.stdout.trim().split("\n").at(-1) ?? "null");
    expect(status?.error ?? null).toBeNull();
    expect(status?.loaded).toBe(true);
  }, 90_000);
});

/**
 * Strip-only means a third-party plugin written with non-erasable syntax (or a
 * type-only import without `import type`) fails to load — in isolation: the
 * error names the file, the loader does not throw, and other plugins still load.
 */
describe("loadServerEntries isolates a plugin that strip-only cannot load", () => {
  const isolationFixture = path.join(here, "fixtures", "load-server-entries-isolation.ts");

  function plugin(root: string, id: string, files: Record<string, string>): void {
    const dir = path.join(root, "packages", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: id, "pi-dashboard-plugin": { id, displayName: id, server: "./server.ts", claims: [] } }),
    );
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  }

  function loadAll(root: string, ids: string[]): Record<string, { loaded: boolean; error?: string } | null> {
    const res = spawnSync(process.execPath, ["--import", register, isolationFixture, root, ...ids], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, res.stderr).toBe(0);
    return JSON.parse(res.stdout.trim().split("\n").at(-1) ?? "null");
  }

  const OK = "export default async function registerPlugin(): Promise<void> {}\n";

  it("E27: a parameter-property plugin fails naming its file; a valid plugin still loads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-iso-"));
    dirs.push(root);
    plugin(root, "bad-pp", {
      "server.ts": "class K { constructor(public v: number) {} }\nexport default async function registerPlugin(): Promise<void> { new K(1); }\n",
    });
    plugin(root, "good-one", { "server.ts": OK });
    const status = loadAll(root, ["bad-pp", "good-one"]);
    expect(status["good-one"]?.loaded).toBe(true);
    expect(status["bad-pp"]?.loaded).toBe(false);
    expect(status["bad-pp"]?.error).toContain(path.join("bad-pp", "server.ts"));
  }, 90_000);

  it("E28: an untyped type-only import fails the plugin (link-time SyntaxError); others load", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-iso-"));
    dirs.push(root);
    plugin(root, "bad-import", {
      "types.ts": "export type OnlyAType = { a: number };\n",
      "server.ts": `import { OnlyAType } from "./types.js";\nexport default async function registerPlugin(): Promise<void> { const x: OnlyAType = { a: 1 }; void x; }\n`,
    });
    plugin(root, "good-one", { "server.ts": OK });
    const status = loadAll(root, ["bad-import", "good-one"]);
    expect(status["good-one"]?.loaded).toBe(true);
    expect(status["bad-import"]?.loaded).toBe(false);
    expect(status["bad-import"]?.error).toMatch(/OnlyAType/);
  }, 90_000);
});
