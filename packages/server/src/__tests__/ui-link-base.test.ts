/**
 * Test-plan #E2–#E5 — `resolveRequestUiBase` picks the origin a caller used,
 * never reflecting an unadmitted / unconfigured host.
 * See change: add-session-ui-deep-links-for-agents (D1).
 */
import { describe, expect, it } from "vitest";
import { isHostAdmitted } from "../auth/host-admission.js";
import { resolveRequestUiBase, type UiBaseInput } from "../routes/ui-link-base.js";

const TUNNEL = "https://abc.share.zrok.io";
const CUSTOM = "https://custom.share.zrok.io";

const admission = {
  publicBaseUrls: ["https://pi.example.com/"],
  getLiveTunnelOrigins: () => [TUNNEL, CUSTOM],
};

function input(over: Partial<UiBaseInput> = {}): UiBaseInput {
  return {
    host: undefined,
    forwardedHost: undefined,
    protocol: "http",
    configuredOrigins: ["https://pi.example.com/", TUNNEL, CUSTOM],
    isAdmitted: (h) => isHostAdmitted(h, admission),
    port: 8000,
    ...over,
  };
}

describe("resolveRequestUiBase", () => {
  it("E2: configured match by Host / X-Forwarded-Host", () => {
    expect(resolveRequestUiBase(input({ host: "pi.example.com:443" }))).toBe("https://pi.example.com");
    expect(resolveRequestUiBase(input({ host: "abc.share.zrok.io" }))).toBe(TUNNEL);
    expect(resolveRequestUiBase(input({ host: "custom.share.zrok.io" }))).toBe(CUSTOM);
    expect(
      resolveRequestUiBase(input({ host: "localhost:8000", forwardedHost: "abc.share.zrok.io" })),
    ).toBe(TUNNEL);
  });

  it("E3: only the first X-Forwarded-Host value is read and it can only select a configured origin", () => {
    const a = resolveRequestUiBase(
      input({ host: "localhost:8000", forwardedHost: "evil.example, abc.share.zrok.io" }),
    );
    const b = resolveRequestUiBase(input({ host: "pi.example.com", forwardedHost: "other.example" }));
    const c = resolveRequestUiBase(input({ host: "localhost:8000", forwardedHost: "evil.example" }));
    expect(a).toBe("http://localhost:8000");
    expect(b).toBe("https://pi.example.com");
    expect(c).toBe("http://localhost:8000");
    for (const r of [a, b, c]) expect(r).not.toContain("evil.example");
  });

  it("E4: normalized output (case, IPv6, port bounds)", () => {
    const base = (host: string) => resolveRequestUiBase(input({ host }));
    expect(base("LOCALHOST:8000")).toBe("http://localhost:8000");
    expect(base("[::1]:8000")).toBe("http://[::1]:8000");
    expect(base("localhost:1")).toBe("http://localhost:1");
    expect(base("localhost:65535")).toBe("http://localhost:65535");
    expect(base("localhost:65536")).toBe("http://localhost");
    // `parseHostname` rejects a non-numeric port, so the host is not admitted.
    expect(base("localhost:abc")).toBe("http://localhost:8000");
  });

  it("an unbracketed IPv6 Host never yields a port from its last group (audit finding)", () => {
    const base = (host: string) => resolveRequestUiBase(input({ host }));
    expect(base("::1")).toBe("http://[::1]");
    expect(base("::1:8000")).toBe("http://[::1:8000]");
  });

  it("E5: no Host / unadmitted unconfigured Host fall back to localhost:<port>", () => {
    // Host gate in report mode lets such a request through; the resolver must not reflect it.
    const a = resolveRequestUiBase(input({}));
    const b = resolveRequestUiBase(input({ host: "evil.example" }));
    expect(a).toBe("http://localhost:8000");
    expect(b).toBe("http://localhost:8000");
    for (const r of [a, b]) expect(r).not.toContain("abc.share.zrok.io");
  });

  it("uses the request protocol for the fallback and admitted hosts", () => {
    expect(resolveRequestUiBase(input({ host: "localhost:8000", protocol: "https" }))).toBe(
      "https://localhost:8000",
    );
    expect(resolveRequestUiBase(input({ protocol: "https" }))).toBe("https://localhost:8000");
  });
});
