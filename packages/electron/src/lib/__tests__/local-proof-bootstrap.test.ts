/**
 * Electron loads /auth/local-proof?code=… (T-X16). See change: harden-trust-and-credential-boundaries.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadWithLocalProof, mintLocalProofUrl } from "../local-proof-bootstrap.js";

const fetchOk = (code: string) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { code } }), { status: 200 })) as unknown as typeof fetch;

describe("local-proof bootstrap", () => {
  it("X16: loadURL gets the one-time-code URL and the local token is sent", async () => {
    const fetchImpl = fetchOk("C");
    const win = { loadURL: vi.fn(async () => {}) };
    expect(await loadWithLocalProof(win, "http://localhost:8000", { fetchImpl, token: "tok" })).toBe(true);
    expect(win.loadURL).toHaveBeenCalledWith("http://localhost:8000/auth/local-proof?code=C");
    expect((fetchImpl as any).mock.calls[0][1].headers["x-pi-local-token"]).toBe("tok");
  });
  it("falls back to the plain URL with no token / on failure", async () => {
    const win = { loadURL: vi.fn(async () => {}) };
    expect(await loadWithLocalProof(win, "http://localhost:8000", { token: null })).toBe(false);
    expect(win.loadURL).toHaveBeenLastCalledWith("http://localhost:8000");
    const bad = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(await mintLocalProofUrl("http://localhost:8000", { fetchImpl: bad, token: "t" })).toBeNull();
    const boom = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await mintLocalProofUrl("http://localhost:8000", { fetchImpl: boom, token: "t" })).toBeNull();
  });
  it("main.ts routes its window loads through loadWithLocalProof", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../main.ts"), "utf-8");
    expect(src).toContain("loadWithLocalProof(");
  });
});
