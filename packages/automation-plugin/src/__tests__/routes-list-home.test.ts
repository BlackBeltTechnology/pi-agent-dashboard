/**
 * /list must not duplicate global automations as folder entries when cwd = $HOME.
 * See change: fix-home-folder-scope-double-arm.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountAutomationRoutes } from "../server/routes.js";

const YAML = () => `on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./prompt.md }
model: "@fast"
`;
let H: string;
let R: string;
let realHome: string | undefined;

function writeAuto(base: string, name: string) {
  const d = path.join(base, ".pi", "automation", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "automation.yaml"), YAML());
  fs.writeFileSync(path.join(d, "prompt.md"), "hi");
}

beforeEach(() => {
  realHome = process.env.HOME;
  H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "list-home-")));
  R = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "list-repo-")));
  process.env.HOME = H;
  writeAuto(H, "nightly");
  writeAuto(R, "build");
});
afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(H, { recursive: true, force: true });
  fs.rmSync(R, { recursive: true, force: true });
});

async function list(cwd: string, hooks: Parameters<typeof mountAutomationRoutes>[1] = {}) {
  const app = Fastify();
  mountAutomationRoutes(app, hooks);
  await app.ready();
  const res = await app.inject({ method: "GET", url: `/api/plugins/automation/list?cwd=${encodeURIComponent(cwd)}` });
  await app.close();
  return (res.json() as { automations: Array<{ name: string; scope: string }> }).automations;
}

describe("GET /list with cwd = $HOME", () => {
  it("E7 lists each global automation once", async () => {
    const a = (await list(H)).filter((x) => x.name === "nightly");
    expect(a).toHaveLength(1);
    expect(a[0].scope).toBe("global");
  });
  it("E8 keeps the armed folder copy when global scanning is off", async () => {
    const a = await list(H, { scanGlobalScope: () => false });
    expect(a.some((x) => x.name === "nightly" && x.scope === "folder")).toBe(true);
  });
  it("E9 non-home cwd unaffected", async () => {
    const a = await list(R);
    expect(a.filter((x) => x.name === "build" && x.scope === "folder")).toHaveLength(1);
    expect(a.filter((x) => x.name === "nightly" && x.scope === "global")).toHaveLength(1);
  });
});
