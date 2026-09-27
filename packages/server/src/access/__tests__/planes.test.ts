import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { __resetAccessGrants, listGrants } from "../access-grants.js";
import { AccessPlaneRegistry } from "../access-plane.js";
import { GrantCoordinator } from "../grant-coordinator.js";
import { createCorsPlane, createCwdPlane, createFilesystemPlane, createNetworkPlane } from "../planes.js";

/**
 * The four registered planes (change: add-access-grant-dialog, tasks 5.2-5.4;
 * test-plan #E13, #E47, #E48).
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-planes-"));
  process.env.PI_ACCESS_GRANTS_STORE = path.join(dir, "access-grants.json");
  __resetAccessGrants();
});

afterEach(() => {
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  fs.rmSync(dir, { recursive: true, force: true });
});

const mk = (...segs: string[]): string => {
  const p = path.join(dir, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return fs.realpathSync(p);
};

describe("5.2 filesystem plane: the path-grant store's own canonical form", () => {
  const plane = createFilesystemPlane();

  it("#E13 /a/b and /a/b/ are one subject", () => {
    const d = mk("a", "b");
    expect(plane.subjectOf(`${d}/`)).toBe(plane.subjectOf(d));
  });

  it("the verdict subject and the created grant's subject are byte-identical", async () => {
    const d = mk("proj");
    const subject = plane.subjectOf(d)!;
    const r = await plane.grant({ subject, deniedSubject: subject, ancestors: [], origin: "s1" });
    expect(r).toEqual({ ok: true, store: "access-grants.json", widenedFrom: undefined });
    expect(listGrants().map((g) => g.subject)).toEqual([subject]);
  });

  it("#E48 an offered ancestor is accepted, recording what it widened from", async () => {
    const leaf = mk("repo", "src", "deep");
    const rung = mk("repo");
    const r = await plane.grant({ subject: rung, deniedSubject: leaf, ancestors: [rung], origin: "s1" });
    expect(r).toMatchObject({ ok: true, widenedFrom: leaf });
    expect(listGrants()).toEqual([expect.objectContaining({ subject: rung, widenedFrom: leaf })]);
  });

  it("#E47 an unoffered directory is refused and no grant is written", async () => {
    const leaf = mk("repo", "src");
    const elsewhere = mk("other");
    const r = await plane.grant({ subject: elsewhere, deniedSubject: leaf, ancestors: [], origin: "s1" });
    expect(r).toEqual({ ok: false, reason: "unnamed", error: undefined });
    expect(listGrants()).toEqual([]);
  });

  it("a forbidden subject is refused even when the denial named it", async () => {
    const home = os.homedir();
    const r = await plane.grant({ subject: home, deniedSubject: home, ancestors: [], origin: "s1" });
    expect(r).toMatchObject({ ok: false, reason: "forbidden" });
    expect(listGrants()).toEqual([]);
  });

  it("offers the ladder the denial carried, and none when it carried none", () => {
    expect(plane.describe("/a/b", ["/a"])).toMatchObject({ mode: "held", ladder: [{ subject: "/a" }] });
    expect(plane.describe("/a/b", [])).not.toHaveProperty("ladder");
  });
});

describe("5.3 cwd plane: pins exactly the named directory", () => {
  it("allow-always pins exactly the denied directory", async () => {
    const pinDirectory = vi.fn();
    const plane = createCwdPlane({ pinDirectory });
    const d = mk("ws");
    const r = await plane.grant({ subject: d, deniedSubject: d, ancestors: [], origin: "s1" });
    expect(r).toEqual({ ok: true, store: "pinned-directories" });
    expect(pinDirectory).toHaveBeenCalledTimes(1);
    expect(pinDirectory).toHaveBeenCalledWith(d);
  });

  it("refuses any other directory, and a forbidden one, pinning nothing", async () => {
    const pinDirectory = vi.fn();
    const plane = createCwdPlane({ pinDirectory });
    const d = mk("ws");
    expect(await plane.grant({ subject: mk("x"), deniedSubject: d, ancestors: [], origin: "s1" })).toMatchObject({
      reason: "unnamed",
    });
    expect(await plane.grant({ subject: "/", deniedSubject: "/", ancestors: [], origin: "s1" })).toMatchObject({
      reason: "forbidden",
    });
    expect(pinDirectory).not.toHaveBeenCalled();
  });

  it("a forbidden directory ($HOME, /) is never promptable", () => {
    const plane = createCwdPlane({ pinDirectory: vi.fn() });
    expect(plane.subjectOf(os.homedir())).toBeNull();
    expect(plane.subjectOf("/")).toBeNull();
  });

  it("a relative directory is not promptable", () => {
    expect(createCwdPlane({ pinDirectory: vi.fn() }).subjectOf("relative/dir")).toBeNull();
  });
});

describe("5.4 network plane: deferred, the exact source address", () => {
  const deps = (existing: string[] = []) => ({
    readTrustedNetworks: () => existing,
    writeConfigPartial: vi.fn(() => ({ success: true })),
  });

  it("is deferred, offers no allow-once, and is not YOLO-eligible", () => {
    const plane = createNetworkPlane(deps());
    expect(plane.mode).toBe("deferred");
    expect(plane.describe("203.0.113.9", []).verdicts).toEqual(["allow-always", "deny"]);
    expect(plane.yoloEligible).toBeUndefined();
  });

  it("accepts only an IP literal, collapsing IPv4-mapped IPv6", () => {
    const plane = createNetworkPlane(deps());
    expect(plane.subjectOf("203.0.113.9")).toBe("203.0.113.9");
    expect(plane.subjectOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(plane.subjectOf("203.0.113.0/24")).toBeNull();
    expect(plane.subjectOf("evil.example")).toBeNull();
  });

  it("appends the address verbatim and never duplicates it", async () => {
    const d = deps(["10.0.0.1"]);
    const plane = createNetworkPlane(d);
    await plane.grant({ subject: "203.0.113.9", deniedSubject: "203.0.113.9", ancestors: [], origin: "s" });
    expect(d.writeConfigPartial).toHaveBeenCalledWith({ trustedNetworks: ["10.0.0.1", "203.0.113.9"] });
    const again = deps(["203.0.113.9"]);
    await createNetworkPlane(again).grant({
      subject: "203.0.113.9",
      deniedSubject: "203.0.113.9",
      ancestors: [],
      origin: "s",
    });
    expect(again.writeConfigPartial).not.toHaveBeenCalled();
  });

  it("reports a failed write rather than claiming success", async () => {
    const plane = createNetworkPlane({
      readTrustedNetworks: () => [],
      writeConfigPartial: () => ({ success: false, error: "disk full" }),
    });
    expect(
      await plane.grant({ subject: "203.0.113.9", deniedSubject: "203.0.113.9", ancestors: [], origin: "s" }),
    ).toEqual({ ok: false, reason: "write-failed", error: "disk full" });
  });
});

describe("5.4 CORS plane: the admitted origin verbatim, no derived wildcard", () => {
  it("adds the origin exactly, preserving every other cors key", async () => {
    const writeConfigPartial = vi.fn(() => ({ success: true }));
    const plane = createCorsPlane({
      readRawCors: () => ({ allowedOrigins: ["https://a.example"], extraKey: 1 }),
      writeConfigPartial,
    });
    const origin = plane.subjectOf("https://App.Example.com")!;
    expect(origin).toBe("https://app.example.com");
    await plane.grant({ subject: origin, deniedSubject: origin, ancestors: [], origin: "s" });
    expect(writeConfigPartial).toHaveBeenCalledWith({
      cors: { allowedOrigins: ["https://a.example", "https://app.example.com"], extraKey: 1 },
    });
    const written = (writeConfigPartial.mock.calls[0] as unknown[])[0] as { cors: { allowedOrigins: string[] } };
    expect(written.cors.allowedOrigins.some((o) => o.includes("*"))).toBe(false);
  });

  it("refuses anything that is not a bare http(s) origin", () => {
    const plane = createCorsPlane({ readRawCors: () => ({}), writeConfigPartial: vi.fn() });
    for (const bad of [
      "null",
      "https://*.example.com",
      "https://a.example/path",
      "https://a.example/?q=1",
      "https://user:pw@a.example",
      "ftp://a.example",
      " https://a.example",
      "not a url",
    ]) {
      expect(plane.subjectOf(bad)).toBeNull();
    }
  });
});

describe("filesystem plane never prompts for an ungrantable subject (change: surface-denial-remedy-in-previews, D7)", () => {
  let savedHome: string | undefined;
  let home: string;
  beforeEach(() => {
    savedHome = process.env.HOME;
    home = mk("parent", "home");
    process.env.HOME = home; // os.homedir() reads $HOME on POSIX
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    vi.restoreAllMocks();
  });

  const coordinator = (sent: ServerToBrowserMessage[]) => {
    const planes = new AccessPlaneRegistry();
    planes.register(createFilesystemPlane());
    return new GrantCoordinator({
      planes,
      broadcast: (m) => sent.push(m),
      hostGateMode: () => "enforce",
      promptEnabled: () => true,
      killSwitch: () => false,
      operatorChannels: () => 1,
      onTransition: () => {},
    });
  };
  const denial = (rawSubject: string) => ({
    plane: "filesystem" as const,
    rawSubject,
    origin: "s1",
    channel: "sock-A",
    requestHoldsCapability: true,
  });

  it("#E15 the parent of $HOME: no grant_request, reason not-promptable, one neutral log line", async () => {
    if (process.platform === "win32") return;
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    const sent: ServerToBrowserMessage[] = [];
    const parent = path.dirname(home);
    const hold = coordinator(sent).onDenial(denial(parent), true);
    expect(await hold.result).toEqual({ kind: "deny", reason: "not-promptable" });
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(0);
    const lines = errors.filter((l) => l.startsWith("[access-grant] not-promptable"));
    expect(lines).toEqual([`[access-grant] not-promptable plane=filesystem subject=${JSON.stringify(parent)}`]);
  });

  it("#E16 a grantable sibling is still prompted exactly once", async () => {
    if (process.platform === "win32") return;
    const sent: ServerToBrowserMessage[] = [];
    const sibling = mk("other");
    const hold = coordinator(sent).onDenial(denial(sibling), true);
    expect(hold.held).toBe(true);
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(1);
    hold.abort();
  });
});
