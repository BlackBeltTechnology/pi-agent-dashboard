/**
 * The HTTP origin a REMOTE bridge uses for its `/api/*` calls (ticket mint,
 * identity challenge, live trust query). The bridge dials the gateway port; the
 * HTTP listener lives on another one.
 *
 * See change: fix-remote-bridge-ticket-origin (D1).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDashboardHttpOrigin } from "../dashboard-http-origin.js";

const GW = "ws://dash.example:9999";
const ok = (origin: string, source: string) => ({ ok: true, origin, source });

describe("resolveDashboardHttpOrigin", () => {
  it("#E1 default topology resolves to the HTTP port", () => {
    expect(resolveDashboardHttpOrigin(GW, {})).toEqual(ok("http://dash.example:8000", "endpoint-host+http-port"));
  });

  it.each([
    [{ PI_DASHBOARD_PORT: "18000", DASHBOARD_PORT: "28000" }, "http://dash.example:18000"],
    [{ DASHBOARD_PORT: "28000" }, "http://dash.example:28000"],
    [{ PI_DASHBOARD_PORT: "abc" }, "http://dash.example:8000"],
    [{ PI_DASHBOARD_PORT: "70000" }, "http://dash.example:8000"],
    [{ PI_DASHBOARD_PORT: "0" }, "http://dash.example:8000"],
  ])("#E2 port precedence %j", (env, origin) => {
    expect(resolveDashboardHttpOrigin(GW, env)).toMatchObject({ ok: true, origin });
  });

  it("#E3 never reads the bridge machine's own dashboard config", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "http-origin-"));
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify({ port: 4321 }));
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(resolveDashboardHttpOrigin(GW, {})).toMatchObject({ ok: true, origin: "http://dash.example:8000" });
    } finally {
      if (prev === undefined) delete process.env.HOME;
      else process.env.HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("#E4 IPv6 keeps its brackets", () => {
    expect(resolveDashboardHttpOrigin("ws://[fd00::1]:9999", {})).toMatchObject({
      ok: true,
      origin: "http://[fd00::1]:8000",
    });
  });

  it.each([
    ["wss://dash.example:8443", "https://dash.example:8443"],
    ["wss://dash.example", "https://dash.example"],
    ["ws://dash.example", "http://dash.example"],
    ["ws://dash.example:80", "http://dash.example"],
    ["wss://dash.example:443", "https://dash.example"],
  ])("#E5 %s keeps its origin", (endpoint, origin) => {
    expect(resolveDashboardHttpOrigin(endpoint, { PI_DASHBOARD_PORT: "18000" })).toEqual(ok(origin, "endpoint-origin"));
  });

  it.each(["http://dash.example:9999", "ws+unix:/tmp/gw.sock", "not a url"])("#E6 %s has no http origin", (endpoint) => {
    expect(resolveDashboardHttpOrigin(endpoint, {})).toMatchObject({ ok: false, cause: "no-http-origin" });
  });

  it("#E7 override wins and contributes only its origin", () => {
    expect(
      resolveDashboardHttpOrigin(GW, { PI_DASHBOARD_HTTP_URL: "https://dash.example/base/path?q=1#f" }),
    ).toEqual(ok("https://dash.example", "PI_DASHBOARD_HTTP_URL"));
  });

  it("#E8 override is scoped via the PI_DASHBOARD_URL host, case-insensitively", () => {
    expect(
      resolveDashboardHttpOrigin("ws://GW.example:9999", {
        PI_DASHBOARD_URL: "ws://gw.example:9999",
        PI_DASHBOARD_HTTP_URL: "https://proxy.example",
      }),
    ).toMatchObject({ ok: true, origin: "https://proxy.example" });
  });

  it("#E9 override does not follow a re-target to another host", () => {
    const res = resolveDashboardHttpOrigin("ws://b.example:9999", {
      PI_DASHBOARD_URL: "ws://a.example:9999",
      PI_DASHBOARD_HTTP_URL: "http://a.example:8000",
    });
    expect(res).toEqual(ok("http://b.example:8000", "endpoint-host+http-port"));
    expect(JSON.stringify(res)).not.toContain("a.example");
  });

  describe("#E10 invalid override fails closed before the scope check", () => {
    const overrides = ["not a url", "ftp://dash.example", "http://u:p@dash.example", "http://:p@dash.example", "javascript:alert(1)"];
    const endpoints = ["ws://dash.example:9999", "ws://other.example:9999"];
    for (const o of overrides) {
      for (const e of endpoints) {
        it(`${o} × ${e}`, () => {
          expect(resolveDashboardHttpOrigin(e, { PI_DASHBOARD_HTTP_URL: o })).toMatchObject({
            ok: false,
            cause: "bad-http-url",
          });
        });
      }
    }
  });

  it.each(["", "   "])("#E11 blank override %j reads as unset", (blank) => {
    expect(resolveDashboardHttpOrigin(GW, { PI_DASHBOARD_HTTP_URL: blank })).toEqual(
      ok("http://dash.example:8000", "endpoint-host+http-port"),
    );
  });

  it("scopes by the override's own hostname too", () => {
    expect(
      resolveDashboardHttpOrigin("ws://proxy.example:9999", { PI_DASHBOARD_HTTP_URL: "https://proxy.example" }),
    ).toMatchObject({ ok: true, origin: "https://proxy.example", source: "PI_DASHBOARD_HTTP_URL" });
  });
});
