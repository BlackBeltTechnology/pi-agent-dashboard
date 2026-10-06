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
 * See change: fix-appimage-cold-boot-latency.
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
