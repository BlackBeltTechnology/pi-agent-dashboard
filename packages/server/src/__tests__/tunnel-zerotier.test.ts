import { describe, expect, it } from "vitest";
import type { CmdRunner } from "../tunnel-providers/tailscale.js";
import {
  deriveMeshEndpoint,
  isNetworkAuthorized,
  parseAssignedIpv4,
  ZeroTierProvider,
} from "../tunnel-providers/zerotier.js";

const NETID = "8056c2e21c000001";
const LISTNETWORKS = [
  { nwid: NETID, name: "my-net", status: "OK", assignedAddresses: ["10.147.20.5/24", "fdff::1/88"] },
];
const listJson = JSON.stringify(LISTNETWORKS);

function runner(map: Record<string, CmdResult>): CmdRunner {
  return (args) => map[args.join(" ")] ?? { code: 0, stdout: "", stderr: "" };
}
type CmdResult = { code: number; stdout: string; stderr: string };

describe("zerotier pure helpers (5.1/5.3)", () => {
  it("parseAssignedIpv4 strips the CIDR suffix and picks IPv4", () => {
    expect(parseAssignedIpv4(LISTNETWORKS, NETID)).toBe("10.147.20.5");
    expect(parseAssignedIpv4(LISTNETWORKS, "unknown")).toBeNull();
  });

  it("isNetworkAuthorized requires OK status + assigned IPv4", () => {
    expect(isNetworkAuthorized(LISTNETWORKS, NETID)).toBe(true);
    expect(isNetworkAuthorized([{ nwid: NETID, status: "REQUESTING_CONFIGURATION", assignedAddresses: [] }], NETID)).toBe(false);
  });

  it("deriveMeshEndpoint is a no-TLS, no-name mesh IP (5.3)", () => {
    expect(deriveMeshEndpoint("10.147.20.5", 8000)).toEqual({
      kind: "mesh",
      url: "http://10.147.20.5:8000",
      tls: false,
    });
  });
});

describe("ZeroTierProvider (5.1/5.2)", () => {
  it("is private-only: rejects public mode (5.2)", () => {
    const p = new ZeroTierProvider({ networkId: NETID, run: runner({}) });
    expect(p.supportsMode("public")).toBe(false);
    expect(p.supportsMode("private")).toBe(true);
  });

  it("connect joins the network and yields a mesh endpoint (5.1)", async () => {
    const calls: string[][] = [];
    const run: CmdRunner = (args) => {
      calls.push(args);
      if (args.join(" ") === "-j listnetworks") return { code: 0, stdout: listJson, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const p = new ZeroTierProvider({ networkId: NETID, run });
    const { endpoints } = await p.connect(8000, "private");
    expect(calls).toContainEqual(["join", NETID]);
    expect(endpoints).toEqual([{ kind: "mesh", url: "http://10.147.20.5:8000", tls: false }]);
    expect(p.status().active).toBe(true);
  });

  it("connect refuses public mode", async () => {
    const p = new ZeroTierProvider({ networkId: NETID, run: runner({}) });
    await expect(p.connect(8000, "public")).rejects.toThrow(/private-only/);
  });

  it("connect without a configured networkId rejects (no join attempted)", async () => {
    const calls: string[][] = [];
    const p = new ZeroTierProvider({ run: (a) => { calls.push(a); return { code: 0, stdout: "", stderr: "" }; } });
    await expect(p.connect(8000, "private")).rejects.toThrow(/networkId not configured/);
    expect(calls).toEqual([]);
  });

  it("no assigned IP (unauthorized node) yields no endpoints", async () => {
    const run: CmdRunner = (args) =>
      args.join(" ") === "-j listnetworks"
        ? { code: 0, stdout: JSON.stringify([{ nwid: NETID, status: "ACCESS_DENIED", assignedAddresses: [] }]), stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    const p = new ZeroTierProvider({ networkId: NETID, run });
    const { endpoints } = await p.connect(8000, "private");
    expect(endpoints).toEqual([]);
    expect(p.status().active).toBe(false);
  });

  it("disconnect issues the destructive leave", async () => {
    const calls: string[][] = [];
    const p = new ZeroTierProvider({ networkId: NETID, run: (a) => { calls.push(a); return { code: 0, stdout: "", stderr: "" }; } });
    await p.disconnect(8000);
    expect(calls).toContainEqual(["leave", NETID]);
  });
});
