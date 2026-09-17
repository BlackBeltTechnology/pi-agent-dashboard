/**
 * E29/X9 (test-plan expand-mcp-tiered-surface) — `pi-dashboard token create`.
 * See change: expand-mcp-tiered-surface (D8).
 */
import { describe, expect, it, vi } from "vitest";
import { cmdTokenCreate } from "../cli.js";

function sink() {
  const lines: string[] = [];
  return { lines, fn: (l: string) => lines.push(l) };
}

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

function fetchFor(urls: string[]) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/api/paired-devices")) {
      return okJson({ device: { id: "d", label: "ci", source: "manual", tier: "control" }, token: "tok_abc" });
    }
    if (url.endsWith("/api/pair/reachable-urls")) return okJson(urls);
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
}

describe("E29 — CLI token create", () => {
  it("prints the token once and one snippet per reachable URL", async () => {
    const out = sink();
    const err = sink();
    const code = await cmdTokenCreate(
      ["create", "--label", "ci", "--tier", "control"],
      { port: 8000 },
      {
        fetchImpl: fetchFor(["https://a.share.zrok.io", "http://192.168.1.4:8000"]),
        localToken: "lt",
        out: out.fn,
        err: err.fn,
      },
    );
    expect(code).toBe(0);
    expect(out.lines.filter((l) => l === "tok_abc")).toHaveLength(1);
    const snippets = out.lines.filter((l) => l.startsWith("claude mcp add"));
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toContain("https://a.share.zrok.io/mcp");
    expect(err.lines).toHaveLength(0);
  });

  it("--url overrides reachability with a single snippet", async () => {
    const out = sink();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      calls.push(String(input));
      if (String(input).endsWith("/api/paired-devices")) return okJson({ device: {}, token: "tok_abc" });
      throw new Error("should not call reachable-urls");
    }) as unknown as typeof fetch;
    const code = await cmdTokenCreate(
      ["create", "--label", "ci", "--url", "https://x.share.zrok.io/"],
      { port: 8000 },
      { fetchImpl, localToken: "lt", out: out.fn, err: sink().fn },
    );
    expect(code).toBe(0);
    const snippets = out.lines.filter((l) => l.startsWith("claude mcp add"));
    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toContain("https://x.share.zrok.io/mcp");
    expect(calls.some((u) => u.endsWith("/api/pair/reachable-urls"))).toBe(false);
  });

  it("--tier without --label is a usage error (exit 2, no fetch)", async () => {
    const err = sink();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const code = await cmdTokenCreate(["create", "--tier", "control"], { port: 8000 }, {
      fetchImpl,
      localToken: "lt",
      out: sink().fn,
      err: err.fn,
    });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(err.lines.join("\n")).toMatch(/usage/i);
  });
});

describe("X9 — no running dashboard", () => {
  it("a refused connection exits non-zero with a 'not running' message and no token", async () => {
    const out = sink();
    const err = sink();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const code = await cmdTokenCreate(["create", "--label", "x"], { port: 8000 }, {
      fetchImpl,
      localToken: "lt",
      out: out.fn,
      err: err.fn,
    });
    expect(code).not.toBe(0);
    expect(err.lines.join("\n")).toMatch(/dashboard not running/i);
    expect(out.lines.join("\n")).not.toContain("tok_");
  });
});
