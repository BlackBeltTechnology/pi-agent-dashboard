/**
 * FakeCraft fixture (add-craft-live-control D8, tasks 1.2 / 1.3, test-plan #E21): the test double exists only
 * under PI_DASHBOARD_FIXTURE_PLUGINS=1, and when it exists it is a real prepared tree served under the
 * production CSP whose page API answers.
 */
import fs from "node:fs";
import path from "node:path";
import { clearAppMountRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/server";
// @ts-expect-error jsdom has no bundled types and @types/jsdom is not installed
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCsp } from "../csp.js";
import { fixtureEnabled } from "../fixture.js";
import registerPlugin from "../index.js";
import { cleanupTmp, type FakeHost, makeHost } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTmp();
  clearAppMountRegistry();
});

async function boot(): Promise<FakeHost> {
  const host = makeHost();
  await registerPlugin(host.ctx);
  await host.fastify.ready();
  return host;
}

const mountedIds = (host: FakeHost): string[] => host.serveApp.mock.calls.map((c) => (c[0] as { appId: string }).appId);

describe("E21 fixture gate", () => {
  it("only exactly '1' switches it on", () => {
    expect(fixtureEnabled({ PI_DASHBOARD_FIXTURE_PLUGINS: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", "2"]) expect(fixtureEnabled({ PI_DASHBOARD_FIXTURE_PLUGINS: v })).toBe(false);
  });

  it("without the flag no fakecraft mount, tree or status exists", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "");
    const host = await boot();
    expect(mountedIds(host)).not.toContain("craft-fakecraft");
    expect(fs.existsSync(path.join(host.dataDir, "fakecraft-web"))).toBe(false);
    const res = await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" });
    expect(Object.keys(res.json().apps)).not.toContain("fakecraft");
    expect((await host.fastify.inject({ method: "GET", url: "/apps/craft-fakecraft/index.html" })).statusCode).toBe(404);
    await host.fastify.close();
  });

  it("with =1 the mount, the prepared tree and an ok status exist", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");
    const host = await boot();
    expect(mountedIds(host)).toContain("craft-fakecraft");
    const status = (await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" })).json();
    expect(status.apps.fakecraft).toMatchObject({ status: "ok", version: "1.0.0", enabled: true });
    expect(Object.keys(status.apps)).toContain("vectorcraft");
    const tree = fs.realpathSync(path.join(host.dataDir, "fakecraft-web", "current"));
    const info = JSON.parse(fs.readFileSync(path.join(tree, "craft-build.json"), "utf8"));
    expect(info).toMatchObject({ app: "fakecraft", version: "1.0.0" });
    await host.fastify.close();
  });
});

describe("the fixture under the production CSP", () => {
  it("serves a tree with no inline script, the production CSP, the shim and a profile with control", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");
    const host = await boot();
    const res = await host.fastify.inject({ method: "GET", url: "/apps/craft-fakecraft/index.html", headers: { host: "localhost:8000" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(buildCsp("http://localhost:8000", "fakecraft"));
    const html = res.body;
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
    expect(scripts.length).toBeGreaterThanOrEqual(4); // profile, shim, fakecraft.js, the externalized dispatch
    for (const s of scripts) expect(s[1], "an inline script would be blocked by the CSP").toMatch(/\bsrc=/);
    const profile = /craft-profile-[0-9a-f]+\.js/.exec(html)?.[0] as string;
    const profileSrc = (await host.fastify.inject({ method: "GET", url: `/apps/craft-fakecraft/${profile}` })).body;
    expect(profileSrc).toContain('"control":{"kind":"page-api","global":"fakecraft"}');
    expect(profileSrc).not.toContain("allowedCommands");
    await host.fastify.close();
  });

  it("window.fakecraft.request answers: echo, a read-only ping, document.inspect, an unknown command rejects", async () => {
    vi.stubEnv("PI_DASHBOARD_FIXTURE_PLUGINS", "1");
    const host = await boot();
    const read = async (url: string) => (await host.fastify.inject({ method: "GET", url })).body;
    const html = await read("/apps/craft-fakecraft/index.html");
    const src = await read("/apps/craft-fakecraft/fakecraft.js");
    const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""), { runScripts: "outside-only", url: "http://localhost:8000/apps/craft-fakecraft/index.html" });
    const win = dom.window as unknown as { eval(s: string): unknown; fakecraft: { request(m: string, p?: unknown): Promise<unknown> } };
    win.eval(src);
    const { request } = win.fakecraft;
    await expect(request("engine.execute", { command: "echo", params: { a: 1 } })).resolves.toEqual({ a: 1 });
    await expect(request("engine.execute", { command: "ping" })).resolves.toEqual({ pong: true });
    const before = (await request("document.inspect")) as { digest: string };
    await request("engine.execute", { command: "ping" });
    expect(((await request("document.inspect")) as { digest: string }).digest).toBe(before.digest); // ping is read-only
    await request("engine.execute", { command: "echo", params: {} });
    expect(((await request("document.inspect")) as { digest: string }).digest).not.toBe(before.digest);
    await expect(request("engine.execute", { command: "nope" })).rejects.toThrow(/unknown command/);
    await expect(request("engine.commands")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "sleep" })]));
    await expect(request("engine.execute", { command: "oversize", params: { bytes: 5 } })).resolves.toBe("xxxxx");
    dom.window.close();
    await host.fastify.close();
  });
});
