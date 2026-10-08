/**
 * `pi-dashboard open` (T-X15, unit level). See change: harden-trust-and-credential-boundaries.
 */
import { describe, expect, it, vi } from "vitest";
import { cmdOpen, parseArgs } from "../cli.js";

const cfg = { port: 8123 } as never;
const ok = (code: string) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { code } }), { status: 200 })) as unknown as typeof fetch;

describe("cmdOpen", () => {
  it("parses the open subcommand", () => {
    expect(parseArgs(["open", "--print"]).subcommand).toBe("open");
  });
  it("--print prints the one-time URL, does not open a browser, exits 0", async () => {
    const out: string[] = [];
    const open = vi.fn();
    const fetchImpl = ok("A".repeat(43));
    expect(await cmdOpen(cfg, { print: true, out: (s) => out.push(s), fetchImpl, open })).toBe(0);
    expect(out[0]).toMatch(/^http:\/\/localhost:8123\/auth\/local-proof\?code=[A-Za-z0-9_-]{43}$/);
    expect(open).not.toHaveBeenCalled();
    expect((fetchImpl as any).mock.calls[0][1].headers["x-pi-local-token"]).toBeTruthy();
  });
  it("without --print opens the browser", async () => {
    const open = vi.fn();
    expect(await cmdOpen(cfg, { out: () => {}, fetchImpl: ok("B".repeat(43)), open })).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("a malformed code from the server is refused before any browser launch", async () => {
    const err: string[] = [];
    const open = vi.fn();
    expect(await cmdOpen(cfg, { err: (s) => err.push(s), fetchImpl: ok("x; rm -rf /"), open })).toBe(1);
    expect(open).not.toHaveBeenCalled();
  });
  it("server down → exit 1 with 'server not running'", async () => {
    const err: string[] = [];
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await cmdOpen(cfg, { print: true, err: (s) => err.push(s), fetchImpl: down })).toBe(1);
    expect(err.join("\n")).toContain("server not running");
  });
});
