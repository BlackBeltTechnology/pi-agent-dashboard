/**
 * `pi-dashboard open` (T-X15, unit level). See change: harden-trust-and-credential-boundaries.
 */
import fs from "node:fs";
import nodePath from "node:path";
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
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8123/api/local-proof");
    expect(init.headers["X-Pi-Local-Proof"]).toBeTruthy();
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain("x-pi-local-token");
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

// ── `--url <origin>` (test-plan #E46 #E47 #X7). See change: fix-pairing-approval-credential (D7, P5). ──
describe("cmdOpen --url", () => {
  const cfg8000 = { port: 8000 } as never;

  it.each([
    ["http://127.0.0.1:8000", cfg8000, "http://127.0.0.1:8000"],
    ["https://localhost:8000", cfg8000, "https://localhost:8000"],
    ["http://localhost", { port: 80 } as never, "http://localhost"],
  ])("E46: %s is accepted — the browser opens on that origin with a code", async (url, config, origin) => {
    const out: string[] = [];
    const open = vi.fn();
    const fetchImpl = ok("C".repeat(43));
    expect(await cmdOpen(config, { url, out: (s) => out.push(s), fetchImpl, open })).toBe(0);
    expect(out[0]).toBe(`${origin}/auth/local-proof?code=${"C".repeat(43)}`);
    expect(open).toHaveBeenCalledWith(out[0]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http://localhost:9999", "port 8000"],
    ["http://evil.example:8000", "loopback"],
    ["file:///x", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["http://u:p@localhost:8000", "credentials"],
    ["http://localhost:8000/x", "path"],
    ["http://localhost:8000/?a", "query"],
    ["http://localhost:8000/#f", "fragment"],
    ["", "valid URL"],
  ])("E46: %j is refused before any request, naming the reason", async (url, reason) => {
    const err: string[] = [];
    const open = vi.fn();
    const fetchImpl = ok("D".repeat(43));
    expect(await cmdOpen(cfg8000, { url, err: (s) => err.push(s), out: () => {}, fetchImpl, open })).not.toBe(0);
    expect(err.join("\n")).toContain(reason);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("X7: no --url keeps the default origin byte-identical and still creates the 0700 dir + 0600 token", async () => {
    // HOME is per-run isolated (vitest setup), so the token dir starts absent.
    const { defaultLocalTokenDir } = await import("../auth/local-token.js");
    const dir = defaultLocalTokenDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const out: string[] = [];
    expect(await cmdOpen(cfg, { print: true, out: (s) => out.push(s), fetchImpl: ok("E".repeat(43)) })).toBe(0);
    expect(out[0]).toBe(`http://localhost:8123/auth/local-proof?code=${"E".repeat(43)}`);
    expect(fs.existsSync(nodePath.join(dir, "token"))).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(nodePath.join(dir, "token")).mode & 0o777).toBe(0o600);
    }
  });

  it("a refused --url creates no token dir", async () => {
    const { defaultLocalTokenDir } = await import("../auth/local-token.js");
    const dir = defaultLocalTokenDir();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await cmdOpen(cfg8000, { url: "http://evil.example:8000", err: () => {}, fetchImpl: ok("F".repeat(43)) })).not.toBe(0);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

// ── Pins the false-positive basis of CodeQL js/shell-command-constructed-from-input on the
// launched URL: the server-supplied code is validated before `open`.
// See change: triage-codeql-alert-debt (design D3 #374, test-plan #E8). ──
describe("cmdOpen local-proof code validation pin (E8)", () => {
  it.each(["a b;rm", "x"])("invalid code %j: exit 1, open never called", async (code) => {
    const open = vi.fn();
    expect(await cmdOpen(cfg, { err: () => {}, out: () => {}, fetchImpl: ok(code), open })).toBe(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("valid 43-char base64url code: open called once with the loopback URL", async () => {
    const code = "Ab0_-".repeat(8) + "Ab3"; // 43 chars of base64url alphabet
    expect(code).toHaveLength(43);
    const open = vi.fn();
    expect(await cmdOpen(cfg, { err: () => {}, out: () => {}, fetchImpl: ok(code), open })).toBe(0);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(`http://localhost:8123/auth/local-proof?code=${code}`);
  });
});
