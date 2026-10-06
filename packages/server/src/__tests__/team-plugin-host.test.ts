/**
 * team-plugin on the REAL host: the plugin loads, `/apps/team/` is served by
 * explicit routes that beat the host's SPA fallback (and the dashboard's own
 * deep links are unaffected), and the API answers as the local operator when
 * identity is inactive. See change: add-team-plugin (test-plan #E37 host side, #X13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

let server: DashboardServer;
let base = "";
let teamHome = "";
let prevHome: string | undefined;

beforeAll(async () => {
  teamHome = fs.mkdtempSync(path.join(os.tmpdir(), "team-host-"));
  prevHome = process.env.PI_TEAM_HOME;
  process.env.PI_TEAM_HOME = teamHome;
  server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  base = `http://127.0.0.1:${server.httpPort()}`;
}, 60_000);

afterAll(async () => {
  await server?.stop();
  if (prevHome === undefined) delete process.env.PI_TEAM_HOME;
  else process.env.PI_TEAM_HOME = prevHome;
  fs.rmSync(teamHome, { recursive: true, force: true });
});

describe("team-plugin on the host", () => {
  it("/apps/team redirects to /apps/team/ and the app route is the team app (or its 503 page), never the dashboard shell", async () => {
    const redirect = await fetch(`${base}/apps/team`, { redirect: "manual" });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe("/apps/team/");
    const page = await fetch(`${base}/apps/team/`);
    const body = await page.text();
    if (page.status === 200) expect(body).toContain("<title>AI Team</title>");
    else {
      expect(page.status).toBe(503);
      expect(body).toContain("team app build missing");
    }
  });

  it("dashboard deep links are not claimed by the team routes", async () => {
    const res = await fetch(`${base}/session/abc`);
    const body = await res.text();
    expect(body).not.toContain("team app build missing");
    expect(body).not.toContain("<title>AI Team</title>");
  });

  it("with identity inactive the API serves the local operator (single-user mode)", async () => {
    const res = await fetch(`${base}/api/plugins/team/me`);
    expect(res.status).toBe(200);
    const me = (await res.json()) as { mode: string; admin: boolean; uk: string };
    expect(me).toMatchObject({ mode: "single", admin: true, uk: "local" });
  });

  it("the plugin is loaded", async () => {
    const res = await fetch(`${base}/api/plugins`);
    const text = await res.text();
    expect(text).toContain('"team"');
  });
});
