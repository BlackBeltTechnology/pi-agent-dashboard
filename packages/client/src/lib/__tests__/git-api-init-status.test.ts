/**
 * `fetchWorktreeInitStatus` keeps its fail-open contract and adds one signal: a `cwd_unknown`
 * refusal is reported as `cwdUnknown` so the post-spawn auto-init can re-probe.
 * See change: core-cwd-admission (D7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorktreeInitStatus } from "../git/git-api.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("fetchWorktreeInitStatus", () => {
  it("maps a 400 cwd_unknown to { hasHook:false, cwdUnknown:true }", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { success: false, code: "cwd_unknown", error: "x" })));
    expect(await fetchWorktreeInitStatus("/w")).toEqual({ hasHook: false, cwdUnknown: true });
  });

  it("stays fail-open (no cwdUnknown) for any other refusal, a 503 or a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { success: false, code: "cwd-admission-unavailable" })));
    expect(await fetchWorktreeInitStatus("/w")).toEqual({ hasHook: false });
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { success: false, code: "cwd_invalid" })));
    expect(await fetchWorktreeInitStatus("/w")).toEqual({ hasHook: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchWorktreeInitStatus("/w")).toEqual({ hasHook: false });
  });

  it("returns the data of a successful probe unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { success: true, data: { hasHook: true, needsInit: true, trusted: true } })));
    expect(await fetchWorktreeInitStatus("/w")).toEqual({ hasHook: true, needsInit: true, trusted: true });
  });
});
