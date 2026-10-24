/**
 * The REAL server wires the baseline CSP report sink: reachable without credentials, counted,
 * surfaced in `/api/health`, flushed on graceful stop. The vitest `setup-home` file isolates HOME,
 * so the counter file lands under a throwaway `~/.pi/dashboard/`.
 *
 * See change: harden-cors-and-csp-reporting (D8, test-plan WX3 L1 counterpart);
 * add-trusted-types-shadow-enforce (test-plan #E22).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe("createServer wires the CSP report sink", () => {
  it("accepts a report, shows it in /api/health, answers 405 to GET, flushes on stop", async () => {
    handle = await createTestServer();
    const base = `http://127.0.0.1:${handle.httpPort}`;
    const post = await fetch(`${base}/__pi/csp-report/strict`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem" } }),
    });
    expect(post.status).toBe(204);
    const get = await fetch(`${base}/__pi/csp-report/strict`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const health = (await (await fetch(`${base}/api/health`)).json()) as { cspReports?: { counts: Record<string, Record<string, number>>; dropped: number } };
    expect(health.cspReports?.counts.strict?.["script-src-elem"]).toBe(1);
    expect(health.cspReports?.dropped).toBe(0);

    await handle.stop();
    handle = undefined;
    const file = path.join(os.homedir(), ".pi", "dashboard", "csp-reports.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).counts.strict["script-src-elem"].count).toBe(1);
  }, 60_000);

  it("E22: the shadow aggregate of a client report reaches /api/health (store built before the routes)", async () => {
    handle = await createTestServer();
    const base = `http://127.0.0.1:${handle.httpPort}`;
    const post = await fetch(`${base}/api/csp-violations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: [], shadow: { "would-block-script": 1 } }),
    });
    expect(post.status).toBe(200);
    const health = (await (await fetch(`${base}/api/health`)).json()) as { cspReports?: { ttShadow?: Record<string, number> } };
    expect(health.cspReports?.ttShadow?.["would-block-script"]).toBe(1);
  }, 60_000);
});
