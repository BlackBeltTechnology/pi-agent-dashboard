/**
 * A pool-port origin is preview-shaped BEFORE any static exemption (D4): with `portPool 8100-8199`, `trustedNetworks ∋ <ip>` and
 * the same IP in `allowedHosts` / the bind address, the origins on 8100, 8101 and 8199 are denied by classify, the mutation gate
 * and the WS gate — whether or not a listener is open — while 8099, 8200 and 8000 stay allowed. The static `ip-address`
 * admission row admits the IP literal but never exempts a pool-port origin.
 *
 * See change: serve-live-previews-on-capability-origin (D4; test-plan #E134).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CorsOriginOptions,
  classifyCorsOrigin,
  isCorsOriginAllowed,
  isMutationOriginTrusted,
  isOriginAdmitted,
  isWsOriginTrusted,
} from "../auth/cors-origin.js";
import { classifyAdmittedHostname } from "../auth/host-admission.js";
import { resetConfigSnapshot } from "../config-snapshot.js";

const IP = "192.168.16.242";
let tmp: string;
let origHome: string | undefined;

function configure(liveServer: object): void {
  fs.mkdirSync(path.join(tmp, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".pi", "dashboard", "config.json"), JSON.stringify({ liveServer }));
  resetConfigSnapshot();
}
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-e134-"));
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
  trustedNetworks: [IP],
  // the same IP is ALSO a static admission row twice over (allowedHosts + the bind address)
  allowedHosts: [IP],
  bindHost: IP,
  ...over,
});

/** The decision of all three gates for `origin`, as a request to the dashboard's own Host would see them. */
function decide(origin: string, over: Partial<CorsOriginOptions> = {}) {
  const o = opts(over);
  const host = `${IP}:8000`;
  return {
    kind: classifyCorsOrigin(origin, o).kind,
    cors: isCorsOriginAllowed(origin, o),
    admitted: isOriginAdmitted(origin, host, o),
    mutation: isMutationOriginTrusted(origin, host, o),
    ws: isWsOriginTrusted(origin, host, "browser", o),
    wsTerminal: isWsOriginTrusted(origin, host, "terminal", o),
  };
}

describe("T.E134 / #E134 — pool-port origin is preview-shaped before the static exemption", () => {
  it("portPool 8100-8199: 8100 / 8101 / 8199 denied by classify + mutation gate + WS gate; 8099 / 8200 / 8000 allowed", () => {
    configure({ previewOrigins: { portPool: "8100-8199" } });
    for (const port of [8100, 8101, 8199]) {
      const d = decide(`http://${IP}:${port}`);
      expect(d, `:${port}`).toEqual({ kind: "preview", cors: false, admitted: false, mutation: false, ws: false, wsTerminal: false });
    }
    for (const port of [8099, 8200, 8000]) {
      const d = decide(`http://${IP}:${port}`);
      expect(d, `:${port}`).toMatchObject({ kind: "trusted-network", cors: true, admitted: true, mutation: true, ws: true, wsTerminal: true });
    }
  });

  it("the static `ip-address` row admits the IP literal (and the bind / allowedHosts rows too) yet never exempts a pool-port origin", () => {
    configure({ previewOrigins: { portPool: "8100-8199" } });
    const admission = { allowedHosts: [IP], bindHost: IP };
    expect(classifyAdmittedHostname(IP, admission)).toBe("ip-address"); // first-match: the IP-literal row
    expect(classifyAdmittedHostname(IP, {})).toBe("ip-address");
    // …and still: the same origin by every spelling of the IP-literal row is preview-shaped on a pool port
    for (const origin of [`http://${IP}:8100`, `http://${IP}:8150`, `http://${IP}:8199`]) {
      expect(classifyCorsOrigin(origin, opts()).kind, origin).toBe("preview");
      // same-origin-by-Host (the page IS served from that very host:port) is not an exemption either
      expect(isMutationOriginTrusted(origin, `${IP}:${origin.split(":")[2]}`, opts({ hostGateMode: "report" })), origin).toBe(false);
      expect(isMutationOriginTrusted(origin, `${IP}:${origin.split(":")[2]}`, opts({ hostGateMode: "enforce" })), origin).toBe(false);
    }
  });

  it("listener open or not: the verdict is the same with a real listener bound on a pool port", async () => {
    // a 100-port run of FREE ports; one of them gets a real listener, the verdicts must not move
    let base = 26_000 + Math.floor(Math.random() * 15_000);
    for (;;) {
      const probe = net.createServer();
      const ok = await new Promise<boolean>((res) => {
        probe.once("error", () => res(false));
        probe.listen(base, "127.0.0.1", () => res(true));
      });
      await new Promise<void>((r) => probe.close(() => r()));
      if (ok) break;
      base += 101;
    }
    configure({ previewOrigins: { portPool: `${base}-${base + 99}` } });
    const closed = [base, base + 1, base + 99].map((p) => decide(`http://${IP}:${p}`));
    const neighbours = [base - 1, base + 100, 8000].map((p) => decide(`http://${IP}:${p}`));
    const listener = net.createServer();
    await new Promise<void>((res) => listener.listen(base + 1, "127.0.0.1", () => res()));
    try {
      const open = [base, base + 1, base + 99].map((p) => decide(`http://${IP}:${p}`));
      expect(open).toEqual(closed);
      for (const d of open) expect(d).toEqual({ kind: "preview", cors: false, admitted: false, mutation: false, ws: false, wsTerminal: false });
      for (const d of neighbours) expect(d).toMatchObject({ kind: "trusted-network", mutation: true, ws: true });
      expect([base - 1, base + 100, 8000].map((p) => decide(`http://${IP}:${p}`))).toEqual(neighbours);
    } finally {
      await new Promise<void>((r) => listener.close(() => r()));
    }
  });
});
