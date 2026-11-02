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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

// A throwaway production client dir so `GET /` serves a real shell (index.html) in the Trusted Types wiring tests.
const clientDist = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock("../lib/client-dist.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/client-dist.js")>();
  return {
    ...actual,
    resolveStaticClientDir: (...args: Parameters<typeof actual.resolveStaticClientDir>) =>
      clientDist.dir ?? actual.resolveStaticClientDir(...args),
  };
});

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

describe("createServer resolves the Trusted Types mode once (test-plan #E4, #X1)", () => {
  const TT = "require-trusted-types-for 'script'";
  const KEY = "PI_DASHBOARD_TRUSTED_TYPES";
  let savedEnv: string | undefined;
  let warned: string[] = [];
  let warnSpy: { mockRestore: () => void };

  beforeEach(() => {
    savedEnv = process.env[KEY];
    delete process.env[KEY];
    clientDist.dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-wiring-client-"));
    fs.writeFileSync(path.join(clientDist.dir, "index.html"), "<!doctype html><html><head></head><body>SPA</body></html>");
    warned = [];
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warned.push(String(args[0]));
    });
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[KEY];
    else process.env[KEY] = savedEnv;
    warnSpy.mockRestore();
    if (clientDist.dir) fs.rmSync(clientDist.dir, { recursive: true, force: true });
    clientDist.dir = null;
  });

  function writeConfig(security: unknown): void {
    const dir = path.join(os.homedir(), ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ security }));
  }

  async function bootAndGetRoot(): Promise<Response> {
    handle = await createTestServer({ dev: false });
    const base = `http://127.0.0.1:${handle.httpPort}`;
    const res = await proofFetch(`${base}/`);
    await proofFetch(`${base}/`); // a second request must not warn again
    return res;
  }

  const ttWarnings = () => warned.filter((m) => m.includes("Trusted Types"));
  const headerValues = (res: Response, name: string) => (res.headers.get(name) ?? "").split(/,(?=\s*(?:default-src|require-trusted-types-for))/);

  it("E4: env beats a mistyped config value; directive only report-only, meta report, one config warning at startup", async () => {
    writeConfig({ trustedTypes: "enforced" });
    process.env[KEY] = "report";
    const res = await bootAndGetRoot();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta name="pi-trusted-types" content="report">');
    expect(res.headers.get("content-security-policy") ?? "").not.toContain(TT);
    expect(headerValues(res, "content-security-policy-report-only").some((v) => v.includes(TT))).toBe(true);
    const w = ttWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("security.trustedTypes");
    expect(w[0]).not.toContain("enforced");
  }, 60_000);

  it.each([[{}], [5]])("X1: config security.trustedTypes = %j cannot crash startup", async (bad) => {
    writeConfig({ trustedTypes: bad });
    const res = await bootAndGetRoot();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta name="pi-trusted-types" content="report">');
    expect(res.headers.get("content-security-policy") ?? "").not.toContain(TT);
    const w = ttWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("security.trustedTypes");
  }, 60_000);

  it("config `enforce` is honoured when no env is set", async () => {
    writeConfig({ trustedTypes: "enforce" });
    const res = await bootAndGetRoot();
    expect(await res.text()).toContain('<meta name="pi-trusted-types" content="enforce">');
    expect(res.headers.get("content-security-policy") ?? "").toContain(TT);
    expect(ttWarnings()).toHaveLength(0);
  }, 60_000);
});
