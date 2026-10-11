/**
 * Electron loads /auth/local-proof?code=… (T-X16). See change: harden-trust-and-credential-boundaries.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveKey,
  httpPurpose,
  parseProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { describe, expect, it, vi } from "vitest";
import { loadWithLocalProof, localApiBase, localProofHeaders, mintLocalProofUrl } from "../local-proof-bootstrap.js";

const fetchOk = (code: string) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { code } }), { status: 200 })) as unknown as typeof fetch;

describe("local-proof bootstrap", () => {
  it("X16: loadURL gets the one-time-code URL and a PROOF (never the raw token) is sent", async () => {
    const fetchImpl = fetchOk("C");
    const win = { loadURL: vi.fn(async () => {}) };
    expect(await loadWithLocalProof(win, "http://localhost:8000", { fetchImpl, token: "tok" })).toBe(true);
    // The window keeps loading `localhost`; the API call dials the address literal.
    expect(win.loadURL).toHaveBeenCalledWith("http://localhost:8000/auth/local-proof?code=C");
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/local-proof");
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain("x-pi-local-token");
    const proof = parseProof(init.headers["X-Pi-Local-Proof"])!;
    expect(verifyProofMac(deriveKey("tok"), proof, "127.0.0.1:8000", httpPurpose("POST", "/api/local-proof"))).toBe(true);
  });
  it("E22: localProofHeaders mints a fresh nonce per request, bound to the literal dialled", () => {
    const url = `${localApiBase({ port: 8000, host: "0.0.0.0" })}/api/shutdown`;
    expect(url).toBe("http://127.0.0.1:8000/api/shutdown");
    const a = localProofHeaders("POST", url, "tok");
    const b = localProofHeaders("POST", url, "tok");
    expect(a["X-Pi-Local-Proof"]).not.toBe(b["X-Pi-Local-Proof"]);
    expect(localProofHeaders("POST", url, null)).toEqual({});
    expect(localApiBase({ port: 1, host: "::1" })).toBe("http://[::1]:1");
  });
  it("never presents a local credential to a host that is not this one", async () => {
    const fetchImpl = fetchOk("C");
    expect(await mintLocalProofUrl("https://dash.example.com", { fetchImpl, token: "tok" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
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
