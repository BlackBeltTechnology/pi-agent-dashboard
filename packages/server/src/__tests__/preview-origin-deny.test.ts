/**
 * A preview origin never gains dashboard trust: CORS, mutation gate, WS gate, plugin allow-lists.
 * See change: serve-live-previews-on-capability-origin (D4; test-plan #E18, #E47, #E133-#E135, #E141).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CorsOriginOptions,
  classifyCorsOrigin,
  isMutationOriginTrusted,
  isOriginAdmitted,
  isPluginWsOriginAdmitted,
  isWsOriginTrusted,
} from "../auth/cors-origin.js";
import { resetConfigSnapshot } from "../config-snapshot.js";

const L = "k7q4mzxa2bcdefghijklmnopqr";
let tmp: string;
let origHome: string | undefined;

function configure(liveServer: object): void {
  fs.mkdirSync(path.join(tmp, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".pi", "dashboard", "config.json"), JSON.stringify({ liveServer }));
  resetConfigSnapshot();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "po-deny-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
});
afterEach(() => {
  process.env.HOME = origHome;
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const opts = (over: Partial<CorsOriginOptions> = {}): CorsOriginOptions => ({
  configuredOrigins: [],
  trustedNetworks: ["192.168.16.242", "127.0.0.1", "0.0.0.0/0"],
  ...over,
});
const previewConfig = {
  previewOrigins: {
    wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] },
    portPool: "8100-8199",
    ipDnsSuffix: "sslip.io",
  },
};

describe("classifyCorsOrigin: preview-deny first (E133, E134, E135, E18)", () => {
  it("E133: no allowance for any preview origin, whatever the allow-lists say", () => {
    configure(previewConfig);
    const origins = [
      `http://${L}.localhost:8000`,
      `https://${L}.preview.example.com`,
      `http://${L}.192-168-1-5.sslip.io:8000`,
      "http://192.168.16.242:8101",
    ];
    for (const origin of origins) {
      const a = classifyCorsOrigin(origin, opts({ configuredOrigins: [origin], getLiveTunnelOrigins: () => [origin], getTunnelUrl: () => origin }));
      expect(a, origin).toEqual({ allowed: false, revocable: false, kind: "preview" });
    }
  });

  it("E134: pool-port origin is denied before the static IP exemption; neighbours are not", () => {
    configure(previewConfig);
    for (const port of [8100, 8101, 8199]) {
      expect(classifyCorsOrigin(`http://192.168.16.242:${port}`, opts()).kind).toBe("preview");
    }
    for (const port of [8099, 8200, 8000]) {
      expect(classifyCorsOrigin(`http://192.168.16.242:${port}`, opts())).toMatchObject({ allowed: true, kind: "trusted-network" });
    }
  });

  it("E135: every spelling of the pool origin is denied; port 80 / https 443 are trusted-network", () => {
    configure(previewConfig);
    for (const o of ["http://[::ffff:192.168.16.242]:8101", "http://192.168.16.242:8101", "http://192.168.16.242.:8101", "http://[::ffff:c0a8:10f2]:8101"]) {
      expect(classifyCorsOrigin(o, opts()).kind, o).toBe("preview");
    }
    expect(classifyCorsOrigin("http://192.168.16.242", opts())).toMatchObject({ allowed: true, kind: "trusted-network" });
    expect(classifyCorsOrigin("https://192.168.16.242", opts())).toMatchObject({ allowed: true, kind: "trusted-network" });
  });

  it("E18: an invalid pool (`80-90`) shapes nothing: the :80 origin keeps the trusted-network path", () => {
    configure({ previewOrigins: { portPool: "80-90" } });
    expect(classifyCorsOrigin("http://192.168.16.242:80", opts())).toMatchObject({ allowed: true, kind: "trusted-network" });
    expect(classifyCorsOrigin("http://192.168.16.242:85", opts())).toMatchObject({ allowed: true, kind: "trusted-network" });
  });

  it("`.localhost` label hosts are denied even with no preview config at all; plain loopback is untouched", () => {
    expect(classifyCorsOrigin(`http://${L}.localhost:8000`, opts()).kind).toBe("preview");
    expect(classifyCorsOrigin("http://localhost:8000", opts())).toMatchObject({ allowed: true, kind: "loopback" });
    expect(classifyCorsOrigin("http://127.0.0.1:8000", opts())).toMatchObject({ allowed: true, kind: "loopback" });
    expect(classifyCorsOrigin("http://myapp.localhost:8000", opts()).kind).not.toBe("preview");
    expect(classifyCorsOrigin(undefined, opts()).kind).toBe("same-origin");
    expect(classifyCorsOrigin("null", opts()).kind).toBe("opaque");
  });

  it("E42: enabled:false keeps every configured preview form denied", () => {
    configure({ previewOrigins: { ...previewConfig.previewOrigins, enabled: false } });
    expect(classifyCorsOrigin(`https://${L}.preview.example.com`, opts()).kind).toBe("preview");
    expect(classifyCorsOrigin("http://192.168.16.242:8150", opts()).kind).toBe("preview");
  });
});

describe("admission gates (E47, E141)", () => {
  const host = "localhost:8000";
  it("mutation gate, WS gate and the generic admission refuse a preview Origin, same-origin-by-Host included", () => {
    configure(previewConfig);
    for (const mode of ["report", "enforce"] as const) {
      const o = opts({ hostGateMode: mode, allowedHosts: [`${L}.localhost`] });
      const live = `http://${L}.localhost:8000`;
      expect(isMutationOriginTrusted(live, host, o), mode).toBe(false);
      expect(isMutationOriginTrusted(live, `${L}.localhost:8000`, o), `${mode} same-origin-by-Host`).toBe(false);
      expect(isOriginAdmitted(live, host, o)).toBe(false);
      for (const scope of ["browser", "terminal", "bridge", null, "live"] as const) {
        expect(isWsOriginTrusted(live, host, scope as never, o, true), `${mode} ${scope}`).toBe(false);
      }
      expect(isMutationOriginTrusted("http://192.168.16.242:8101", host, o)).toBe(false);
      expect(isMutationOriginTrusted("http://192.168.16.242:8000", host, o)).toBe(true);
      expect(isMutationOriginTrusted("http://localhost:8000", host, o)).toBe(true);
    }
  });

  it("a plugin allow-list cannot re-admit a preview origin", () => {
    configure(previewConfig);
    const live = `http://${L}.localhost:8000`;
    expect(isPluginWsOriginAdmitted(live, host, [live], opts())).toBe(false);
    expect(isPluginWsOriginAdmitted("chrome-extension://abc", host, ["chrome-extension://abc"], opts())).toBe(true);
  });

  it("E140: an operator-listed non-label name keeps working", () => {
    configure(previewConfig);
    const o = opts({ hostGateMode: "enforce", allowedHosts: ["dash.localhost"] });
    expect(isMutationOriginTrusted("http://dash.localhost:8000", "dash.localhost:8000", o)).toBe(true);
  });
});
