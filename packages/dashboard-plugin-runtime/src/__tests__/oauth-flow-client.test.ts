/**
 * oauthFlowClient — status / input / cancel map onto the host flow routes.
 * See change: expose-plugin-credential-and-oauth-seams (D3).
 */
import { describe, expect, it, vi } from "vitest";
import { createOAuthFlowClient } from "../oauth-flow-client.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("oauthFlowClient", () => {
  it("status GETs the flow route", async () => {
    const f = vi.fn(async () => json({ flowId: "f 1", provider: "plugin:demo:k", status: "pending" }));
    const c = createOAuthFlowClient(f as unknown as typeof fetch);
    await expect(c.status("f 1")).resolves.toMatchObject({ status: "pending" });
    expect(f).toHaveBeenCalledWith("/api/provider-auth/flow/f%201");
  });

  it("input POSTs the value; cancel DELETEs", async () => {
    const f = vi.fn(async () => new Response(null, { status: 202 }));
    const c = createOAuthFlowClient(f as unknown as typeof fetch);
    await c.input("f1", "ok");
    expect(f).toHaveBeenLastCalledWith("/api/provider-auth/flow/f1/input", expect.objectContaining({ method: "POST", body: JSON.stringify({ value: "ok" }) }));
    await c.cancel("f1");
    expect(f).toHaveBeenLastCalledWith("/api/provider-auth/flow/f1", { method: "DELETE" });
  });

  it("rejects with the server's error message on non-2xx", async () => {
    const c = createOAuthFlowClient((async () => json({ error: "Invalid or expired flow" }, 404)) as unknown as typeof fetch);
    await expect(c.status("x")).rejects.toThrow("Invalid or expired flow");
  });
});
