import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isTrustedSenderUrl,
  trustedHandler,
  trustedListener,
  UntrustedSenderError,
} from "../lib/ipc-trust.js";
import { navigateToServer } from "../lib/local-proof-bootstrap.js";

const loadingPagePath = path.resolve("/app/resources/loading.html");
const ctx = { loadingPagePath, localPort: 8000 };
const loadingUrl = `${pathToFileURL(loadingPagePath).href}?serverUrl=http%3A%2F%2F10.0.0.5%3A8000&knownServers=abc#x`;

describe("isTrustedSenderUrl (VD5)", () => {
  it("trusts the local loading page (query/hash ignored)", () => {
    expect(isTrustedSenderUrl(loadingUrl, ctx)).toBe(true);
  });

  it("trusts the LOCAL dashboard origin on the configured port", () => {
    for (const u of ["http://localhost:8000/", "http://127.0.0.1:8000/x?y=1", "http://[::1]:8000/"]) {
      expect(isTrustedSenderUrl(u, ctx), u).toBe(true);
    }
  });

  it("rejects remote / tunnel / LAN dashboard origins", () => {
    for (const u of [
      "http://192.168.16.242:8000/", "https://abc.share.zrok.io/", "http://evil.example:8000/",
      "http://localhost.evil.example:8000/", "http://localhost:9999/", "https://localhost:8000/",
    ]) {
      expect(isTrustedSenderUrl(u, ctx), u).toBe(false);
    }
  });

  it("rejects other file:// pages (incl. a lookalike) and non-http schemes", () => {
    for (const u of [
      pathToFileURL("/tmp/evil.html").href,
      pathToFileURL("/app/resources/loading.html.evil.html").href,
      pathToFileURL("/app/resources/sub/../../evil/loading.html").href,
      "data:text/html,<script>1</script>", "about:blank", "javascript:1", "blob:http://localhost:8000/x",
    ]) {
      expect(isTrustedSenderUrl(u, ctx), u).toBe(false);
    }
  });

  it("fails closed on missing / malformed sender", () => {
    for (const u of [undefined, null, "", "not a url", 42, {}]) {
      expect(isTrustedSenderUrl(u, ctx)).toBe(false);
    }
  });
});

describe("trustedHandler / trustedListener", () => {
  const trusted = { senderFrame: { url: loadingUrl } };
  const remote = { senderFrame: { url: "http://evil.example/" } };
  const isTrusted = (e: { senderFrame?: { url?: string } | null }) => isTrustedSenderUrl(e.senderFrame?.url, ctx);

  it("runs the handler and forwards args for a trusted sender", async () => {
    const h = vi.fn(async (_e: unknown, a: number) => a + 1);
    expect(await trustedHandler("c", isTrusted, h)(trusted, 1)).toBe(2);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("rejects an untrusted sender without running the handler (and reports it)", () => {
    const h = vi.fn();
    const onReject = vi.fn();
    expect(() => trustedHandler("dashboard:read-server-log", isTrusted, h, onReject)(remote)).toThrow(UntrustedSenderError);
    expect(h).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("dashboard:read-server-log", remote);
  });

  it("rejects when senderFrame is null/absent (destroyed frame)", () => {
    const h = vi.fn();
    expect(() => trustedHandler("c", isTrusted, h)({ senderFrame: null })).toThrow(UntrustedSenderError);
    expect(() => trustedHandler("c", isTrusted, h)({})).toThrow(UntrustedSenderError);
    expect(h).not.toHaveBeenCalled();
  });

  it("listener: trusted runs; untrusted is dropped silently (never throws)", () => {
    const l = vi.fn();
    const wrapped = trustedListener("dashboard:open-doctor", isTrusted, l);
    wrapped(trusted);
    expect(l).toHaveBeenCalledTimes(1);
    expect(() => wrapped(remote)).not.toThrow();
    expect(l).toHaveBeenCalledTimes(1);
  });
});

// ── dashboard:navigate-to-server gating (fix-pairing-approval-credential; X8, X9) ──
// Composes the real `trustedHandler` + `isTrustedSenderUrl` around the real
// `navigateToServer`, exactly as `registerPiDashboardIpc` does (that wiring is pinned in
// renderer-boundary.test.ts, since main.ts imports electron and cannot be loaded).
describe("dashboard:navigate-to-server sender gate", () => {
  const isTrusted = (e: { senderFrame?: { url?: string } | null }) => isTrustedSenderUrl(e.senderFrame?.url, ctx);
  function build() {
    const win = { loadURL: vi.fn(async (_u: string) => {}) };
    const mintFetch = vi.fn(async () => new Response(JSON.stringify({ data: { code: "C" } }), { status: 200 })) as unknown as typeof fetch;
    const onReject = vi.fn();
    const handler = trustedHandler(
      "dashboard:navigate-to-server",
      isTrusted,
      (_e: { senderFrame?: { url?: string } | null }, payload: { target?: unknown }) =>
        navigateToServer(win, payload.target, { config: { port: 8000, knownServers: [] }, windowServerUrl: "http://192.168.16.242:8000", fetchImpl: mintFetch, token: "tok" }),
      onReject,
    );
    return { win, mintFetch, onReject, handler };
  }

  it.each([
    "http://192.168.16.242:8000/", "http://127.0.0.1:9999/", "https://evil.example/", "file:///other.html",
  ])("X8 untrusted sender %s → UntrustedSenderError; loadURL 0; mint 0; rejection logged", (url) => {
    const { win, mintFetch, onReject, handler } = build();
    const event = { senderFrame: { url } };
    expect(() => handler(event, { target: "http://localhost:8000" })).toThrow(UntrustedSenderError);
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(mintFetch).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("dashboard:navigate-to-server", event);
  });

  it("X8 null / absent sender frame → UntrustedSenderError; loadURL 0; mint 0", () => {
    const { win, mintFetch, handler } = build();
    expect(() => handler({ senderFrame: null }, { target: "http://localhost:8000" })).toThrow(UntrustedSenderError);
    expect(() => handler({}, { target: "http://localhost:8000" })).toThrow(UntrustedSenderError);
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(mintFetch).not.toHaveBeenCalled();
  });

  it.each([loadingUrl, "http://localhost:8000/"])("X9 trusted sender %s → handler runs and navigates", async (url) => {
    const { win, onReject, handler } = build();
    await expect(handler({ senderFrame: { url } }, { target: "http://localhost:8000" })).resolves.toEqual({ navigated: true });
    expect(win.loadURL).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });
});
