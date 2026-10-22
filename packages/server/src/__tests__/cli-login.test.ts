/**
 * D23 break-glass CLI — `pi-dashboard login --local` (task 18.24).
 * See change: add-multi-user-identity-plane.
 */

import {
  deriveKey,
  httpPurpose,
  parseProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { describe, expect, it, vi } from "vitest";
import { cmdLogin } from "../cli.js";

const sink = () => {
  const lines: string[] = [];
  return { lines, fn: (l: string) => lines.push(l) };
};
const okCode = (code = "CODE123") =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { code, expiresInSeconds: 60 } }) })) as unknown as typeof fetch;

describe("pi-dashboard login --local", () => {
  it("asks the running server for a code with the local token and prints the one-time link", async () => {
    const out = sink();
    const err = sink();
    const fetchImpl = okCode();
    const code = await cmdLogin(["--local"], { port: 8123 }, { fetchImpl, localToken: "lt", out: out.fn, err: err.fn });
    expect(code).toBe(0);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    // The request dials the address LITERAL the proof is bound to; the printed link stays `localhost`.
    expect(url).toBe("http://127.0.0.1:8123/api/identity/local-code");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Pi-Local-Proof"]).toBeTruthy();
    expect(JSON.stringify(headers).toLowerCase()).not.toContain("x-pi-local-token");
    // ...and the proof is bound to that literal, the method and the target.
    const proof = parseProof(headers["X-Pi-Local-Proof"])!;
    expect(verifyProofMac(deriveKey("lt"), proof, "127.0.0.1:8123", httpPurpose("POST", "/api/identity/local-code"))).toBe(true);
    // The printed link bootstraps local proof first (a plain tab cannot redeem the code under the strict
    // default), then lands on the one-time `pi_local` link.
    const link = new URL(out.lines[0]!);
    expect(link.origin).toBe("http://localhost:8123");
    expect(link.pathname).toBe("/auth/local-proof");
    expect(link.searchParams.get("next")).toBe("/?pi_local=CODE123");
    expect(link.searchParams.get("code")).toBeTruthy();
    const [proofUrl, proofInit] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    expect(proofUrl).toBe("http://127.0.0.1:8123/api/local-proof");
    expect((proofInit.headers as Record<string, string>)["X-Pi-Local-Proof"]).toBeTruthy();
    expect(out.lines.join("\n")).toMatch(/60 s|60s|single-use/i);
    expect(err.lines).toHaveLength(0);
  });

  it("falls back to the plain one-time link when no proof code can be minted", async () => {
    const out = sink();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { code: "CODE9", expiresInSeconds: 60 } }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch;
    const code = await cmdLogin(["--local"], { port: 8123 }, { fetchImpl, localToken: "lt", out: out.fn, err: () => {} });
    expect(code).toBe(0);
    expect(out.lines[0]).toBe("http://localhost:8123/?pi_local=CODE9");
  });

  it("requires --local (the only break-glass path) and prints usage otherwise", async () => {
    const err = sink();
    const code = await cmdLogin([], { port: 8000 }, { fetchImpl: okCode(), localToken: "lt", out: () => {}, err: err.fn });
    expect(code).toBe(2);
    expect(err.lines.join("\n")).toMatch(/usage: pi-dashboard login --local/);
  });

  it("fails clearly when the dashboard is not running", async () => {
    const err = sink();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const code = await cmdLogin(["--local"], { port: 8000 }, { fetchImpl, localToken: "lt", out: () => {}, err: err.fn });
    expect(code).toBe(1);
    expect(err.lines.join("\n")).toMatch(/dashboard not running/);
  });

  it("surfaces a server refusal (e.g. wrong local token) without printing a link", async () => {
    const out = sink();
    const err = sink();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const code = await cmdLogin(["--local"], { port: 8000 }, { fetchImpl, localToken: "bad", out: out.fn, err: err.fn });
    expect(code).toBe(1);
    expect(out.lines).toHaveLength(0);
    expect(err.lines.join("\n")).toMatch(/HTTP 401/);
  });

  it("no local token on this host ⇒ clear error, no request", async () => {
    const err = sink();
    const fetchImpl = okCode();
    const code = await cmdLogin(["--local"], { port: 8000 }, { fetchImpl, localToken: null, out: () => {}, err: err.fn });
    expect(code).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(err.lines.join("\n")).toMatch(/local token/i);
  });

  it("bounds the request: a server that accepts but never answers cannot hang the recovery command", async () => {
    const err = sink();
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      }),
    ) as unknown as typeof fetch;
    const t0 = Date.now();
    const code = await cmdLogin(["--local"], { port: 8000 }, { fetchImpl, localToken: "lt", out: () => {}, err: err.fn, timeoutMs: 50 });
    expect(code).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(err.lines.join("\n")).toMatch(/dashboard not running|aborted/);
  });
});
