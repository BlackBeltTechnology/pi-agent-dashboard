/**
 * D23 break-glass CLI — `pi-dashboard login --local` (task 18.24).
 * See change: add-multi-user-identity-plane.
 */
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
    expect(url).toBe("http://localhost:8123/api/identity/local-code");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-pi-local-token"]).toBe("lt");
    expect(out.lines.join("\n")).toContain("http://localhost:8123/?pi_local=CODE123");
    expect(out.lines.join("\n")).toMatch(/60 s|60s|single-use/i);
    expect(err.lines).toHaveLength(0);
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
