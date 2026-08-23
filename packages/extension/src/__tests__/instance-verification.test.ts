/**
 * A bridge refuses an instance that is not the one its record named — even
 * when the local credential is valid (tasks 1.8, 3.4, 3.8; D8, D14).
 *
 * The local credential answers "may I talk to a dashboard on this host", never
 * "is this the dashboard I meant": the socket's mode and the local token are
 * both per-HOME, so every same-HOME instance passes them equally.
 *
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import {
  decideAdoption,
  healthUrlForInstance,
  verifyInstanceIdentity,
} from "../instance-verification.js";

describe("decideAdoption", () => {
  it("adopts when the observed id is the expected one", () => {
    expect(decideAdoption({ expected: "abc", observed: "abc" }).adopt).toBe(true);
  });

  it("refuses a DIFFERENT instance and names both ids", () => {
    const d = decideAdoption({ expected: "abc", observed: "xyz" });
    expect(d.adopt).toBe(false);
    expect(d.reason).toContain("abc");
    expect(d.reason).toContain("xyz");
  });

  it("refuses when nothing answered — silence is not verification", () => {
    expect(decideAdoption({ expected: "abc", observed: null }).adopt).toBe(false);
  });

  // A dashboard predating `instanceId` publishes nothing to compare, and the
  // record it wrote has no id either. Requiring one would refuse every
  // pre-upgrade dashboard; the check applies only when we HAVE an expectation.
  it("adopts when no id was expected (nothing to contradict)", () => {
    expect(decideAdoption({ expected: undefined, observed: null }).adopt).toBe(true);
  });

  it("still refuses when an id was expected and the instance publishes none", () => {
    expect(decideAdoption({ expected: "abc", observed: undefined }).adopt).toBe(false);
  });
});

describe("healthUrlForInstance", () => {
  it("derives the health URL from the record's http port", () => {
    expect(healthUrlForInstance(8123)).toBe("http://127.0.0.1:8123/api/health");
  });
});

describe("verifyInstanceIdentity", () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response;

  it("verifies against the published instanceId", async () => {
    const res = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "abc",
      fetchImpl: async () => okResponse({ instanceId: "abc" }),
    });
    expect(res.adopt).toBe(true);
    expect(res.observed).toBe("abc");
  });

  it("refuses a same-HOME impostor on the same port", async () => {
    const res = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "abc",
      fetchImpl: async () => okResponse({ instanceId: "other" }),
    });
    expect(res.adopt).toBe(false);
  });

  it("treats an unreachable instance as unverified, never as a pass", async () => {
    const res = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "abc",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(res.adopt).toBe(false);
    expect(res.reason).toMatch(/unreachable|did not answer/i);
  });

  it("treats a non-OK response as unverified", async () => {
    const res = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "abc",
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
    });
    expect(res.adopt).toBe(false);
  });
});

// ── "nobody answered" is not "someone else answered" ───────────────────────
//
// The bridge disconnects TERMINALLY on a failed verification — `disconnect()`
// sets `intentionalClose`, so nothing rearms the backoff loop and the session
// is dead until pi restarts. That is right for a hijack and catastrophic for
// an outage, and `adopt: false` alone cannot tell them apart.
//
// The window is not hypothetical: `POST /api/restart` is the documented
// restart path, so every rebuild takes `/api/health` down for a few seconds
// while the gateway socket is untouched. Collapsing that into "refused" would
// permanently kill every bridge on the host on every rebuild.
//
// See change: add-pi-gateway-transport-identity (task 3.8, D4).
describe("verification distinguishes an absent instance from a DIFFERENT one", () => {
  const unreachable = (): Promise<Response> => Promise.reject(new Error("ECONNREFUSED"));
  const answers = (instanceId: unknown, ok = true): (() => Promise<Response>) =>
    () =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 503,
        json: () => Promise.resolve({ instanceId }),
      } as Response);

  it("does not call an unreachable endpoint a conflict", async () => {
    const v = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "inst-A",
      fetchImpl: unreachable as unknown as typeof fetch,
    });
    expect(v.adopt).toBe(false);
    expect(v.conflict).toBe(false);
  });

  it("does not call a non-OK response a conflict", async () => {
    const v = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "inst-A",
      fetchImpl: answers("inst-A", false) as unknown as typeof fetch,
    });
    expect(v.adopt).toBe(false);
    expect(v.conflict).toBe(false);
  });

  it("DOES call a different instance a conflict — that is the hijack", async () => {
    const v = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "inst-A",
      fetchImpl: answers("inst-B") as unknown as typeof fetch,
    });
    expect(v.adopt).toBe(false);
    expect(v.conflict).toBe(true);
  });

  it("treats an endpoint that publishes NO id as a conflict", async () => {
    // It answered, and what it published does not match. An instance that
    // cannot name itself is not one we may keep talking to.
    const v = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "inst-A",
      fetchImpl: answers(undefined) as unknown as typeof fetch,
    });
    expect(v.adopt).toBe(false);
    expect(v.conflict).toBe(true);
  });

  it("verifies the happy path without conflict", async () => {
    const v = await verifyInstanceIdentity({
      healthUrl: "http://127.0.0.1:8000/api/health",
      expectedInstanceId: "inst-A",
      fetchImpl: answers("inst-A") as unknown as typeof fetch,
    });
    expect(v.adopt).toBe(true);
    expect(v.conflict).toBe(false);
  });
});
