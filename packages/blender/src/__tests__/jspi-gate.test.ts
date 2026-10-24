/**
 * X21 (ci, real Node 22 legs): with the REAL JSPI probe and an empty cache, `blender_scene` is
 * `jspi-unavailable` and nothing is downloaded. On a JSPI-capable Node (24+) this leg does not apply and
 * the test skips itself (X22 in real-lifecycle covers that side).
 *
 * See change: add-blender-wasm-mcp (task 5.15, test-plan X21).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeJspi } from "../host/probe.js";
import { startServer } from "./helpers/mcp-client.js";

const probe = await probeJspi();
const dirs: string[] = [];
let client: ReturnType<typeof startServer> | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("jspi gate (real probe)", () => {
  it.skipIf(probe.mode !== "unavailable")(`X21: ${probe.mode === "unavailable" ? "" : `[skipped: the real probe reports JSPI "${probe.mode}" on Node ${probe.node}; the unavailable leg runs on Node 22] `}blender_scene is jspi-unavailable and nothing is downloaded`, async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "blender-gate-home-")));
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "blender-gate-root-")));
    dirs.push(home, root);
    client = startServer({ cwd: root, env: { BLENDER_WASM_HOME: home, BLENDER_WASM_DIR: "" } });
    const r = await client.call("blender_scene");
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("jspi-unavailable");
    expect(String(r.data.message)).toContain(process.version);
    expect(String(r.data.message)).toContain("Node 24 or newer");
    expect(fs.readdirSync(home)).toEqual([]);
  }, 120_000);
});
