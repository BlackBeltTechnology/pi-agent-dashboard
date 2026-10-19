/**
 * E1 connection resolution (decision table) and X1 CLI-level connect faults
 * (closed port / Identify rejected / Hello withheld / request unanswered).
 * See change: add-obs-studio-plugin (test-plan E1, X1).
 */
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectObs, resolveTarget } from "../connection.js";
import { type FakeObs, startFakeObs } from "./fake-obs.js";

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});
const fake = async (o: Parameters<typeof startFakeObs>[0] = {}) => {
  const f = await startFakeObs(o);
  fakes.push(f);
  return f;
};

const defs = [
  { id: "obs", mode: "attached", endpoints: { ws: "ws://127.0.0.1:4455" }, health: { kind: "ws-first-message", endpoint: "ws" }, origin: "user" },
  { id: "obs-studio2", mode: "external", endpoints: { ws: "ws://10.0.0.5:4455" }, health: { kind: "ws-first-message", endpoint: "ws" }, origin: "user" },
] as never[];

describe("E1 resolveTarget", () => {
  it("--service obs + SVC_OBS_PASSWORD → the service secret and endpoint", () => {
    const t = resolveTarget({ service: "obs" }, { SVC_OBS_PASSWORD: "pw1", OBS_PASSWORD: "other" }, defs);
    expect(t).toMatchObject({ url: "ws://127.0.0.1:4455", password: "pw1", serviceId: "obs", source: "service" });
  });

  it("two SVC_*_PASSWORD without --service → usage error naming both", () => {
    expect(() => resolveTarget({}, { SVC_OBS_PASSWORD: "a", SVC_OBS_STUDIO2_PASSWORD: "b" }, defs)).toThrow(
      expect.objectContaining({ code: "usage", message: expect.stringMatching(/SVC_OBS_PASSWORD.*SVC_OBS_STUDIO2_PASSWORD/) }),
    );
  });

  it("only OBS_URL / OBS_PASSWORD → the standalone fallback", () => {
    expect(resolveTarget({}, { OBS_URL: "ws://127.0.0.1:4999", OBS_PASSWORD: "x" }, [])).toMatchObject({ url: "ws://127.0.0.1:4999", password: "x", source: "env" });
  });

  it("--password → usage error naming service exec and OBS_PASSWORD", () => {
    expect(() => resolveTarget({ passwordArg: true }, {}, [])).toThrow(
      expect.objectContaining({ code: "usage", message: expect.stringMatching(/service exec.*OBS_PASSWORD/) }),
    );
  });
});

async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

describe("X1 connect faults", () => {
  it("closed port → unreachable", async () => {
    await expect(connectObs({ url: `ws://127.0.0.1:${await closedPort()}`, source: "env" })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("Identify rejected → auth-failed", async () => {
    const f = await fake({ password: "right" });
    await expect(connectObs({ url: f.url, password: "wrong", source: "env" })).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("Hello withheld → timeout at the connect bound", async () => {
    const f = await fake({ withholdHello: true });
    const t0 = Date.now();
    await expect(connectObs({ url: f.url, source: "env" }, { connectTimeoutMs: 300 })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
  });

  it("request unanswered → timeout at the request bound", async () => {
    const f = await fake({ password: "pw", handlers: { GetSceneList: () => "never" } });
    const conn = await connectObs({ url: f.url, password: "pw", source: "env" }, { requestTimeoutMs: 300 });
    await expect(conn.call("GetSceneList")).rejects.toMatchObject({ code: "timeout" });
    await conn.close();
  });

  it("the defaults are connect 3 s and request 5 s", async () => {
    const m = await import("../connection.js");
    expect([m.CONNECT_TIMEOUT_MS, m.REQUEST_TIMEOUT_MS]).toEqual([3000, 5000]);
  });

  it("right password → connected with availableRequests", async () => {
    const f = await fake({ password: "pw", handlers: { GetSceneList: () => ({ scenes: [] }) } });
    const conn = await connectObs({ url: f.url, password: "pw", source: "env" });
    expect(conn.availableRequests.has("GetSceneList")).toBe(true);
    expect(conn.obsVersion).toBe("32.2.2");
    await conn.close();
  });
});
