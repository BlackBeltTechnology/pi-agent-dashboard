/**
 * Tests for pure helpers in `manifest-route.ts`.
 * See change: add-dynamic-pwa-manifest-naming.
 */
import { describe, it, expect } from "vitest";
import {
  stripPort,
  resolveManifestSource,
  buildManifestBody,
} from "../manifest-route.js";

describe("stripPort", () => {
  it("returns empty for null/undefined/empty/whitespace", () => {
    expect(stripPort(undefined)).toBe("");
    expect(stripPort(null)).toBe("");
    expect(stripPort("")).toBe("");
    expect(stripPort("   ")).toBe("");
  });

  it("returns bare hostname unchanged (lower-cased)", () => {
    expect(stripPort("mybox.local")).toBe("mybox.local");
    expect(stripPort("MyBox.Local")).toBe("mybox.local");
  });

  it("strips port from host:port", () => {
    expect(stripPort("mybox.local:8000")).toBe("mybox.local");
    expect(stripPort("example.com:443")).toBe("example.com");
  });

  it("strips port from bracketed IPv6 with port", () => {
    expect(stripPort("[::1]:8000")).toBe("::1");
    expect(stripPort("[fe80::1]:443")).toBe("fe80::1");
  });

  it("handles bracketed IPv6 without port", () => {
    expect(stripPort("[::1]")).toBe("::1");
  });

  it("leaves unbracketed IPv6 untouched (multiple colons)", () => {
    // Non-conformant Host header — Node parses this as "::1" with no port.
    // We don't try to be clever; pass through verbatim.
    expect(stripPort("::1")).toBe("::1");
    expect(stripPort("fe80::1")).toBe("fe80::1");
  });

  it("trims leading/trailing whitespace before parsing", () => {
    expect(stripPort("  mybox:8000  ")).toBe("mybox");
  });
});

describe("resolveManifestSource", () => {
  const HOSTNAME = "macbook-pro";

  it("returns config override when set", () => {
    expect(resolveManifestSource("foo:8000", "Home NAS", HOSTNAME)).toBe("Home NAS");
    expect(resolveManifestSource(undefined, "Home NAS", HOSTNAME)).toBe("Home NAS");
  });

  it("trims config override and treats whitespace-only as unset", () => {
    expect(resolveManifestSource("foo:8000", "   ", HOSTNAME)).toBe("foo");
    expect(resolveManifestSource("foo:8000", "", HOSTNAME)).toBe("foo");
    expect(resolveManifestSource("foo:8000", "  Home NAS  ", HOSTNAME)).toBe("Home NAS");
  });

  it("falls back to Host header (port stripped) when no override", () => {
    expect(resolveManifestSource("mybox.local:8000", undefined, HOSTNAME)).toBe(
      "mybox.local",
    );
    expect(resolveManifestSource("[::1]:8000", null, HOSTNAME)).toBe("::1");
  });

  it("falls back to os.hostname() when override and Host header are empty", () => {
    expect(resolveManifestSource(undefined, undefined, HOSTNAME)).toBe(HOSTNAME);
    expect(resolveManifestSource("", "", HOSTNAME)).toBe(HOSTNAME);
  });

  it("falls back to 'Pi-Dash' when everything is empty", () => {
    expect(resolveManifestSource(undefined, undefined, "")).toBe("Pi-Dash");
    expect(resolveManifestSource("", "", "   ")).toBe("Pi-Dash");
  });

  it("override wins over Host header even when Host is non-empty", () => {
    expect(resolveManifestSource("anything.local:8000", "Override", HOSTNAME)).toBe(
      "Override",
    );
  });
});

describe("buildManifestBody", () => {
  const BASE = {
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    theme_color: "#3b82f6",
    background_color: "#0f172a",
    display: "standalone",
    start_url: "/",
    name: "should-be-overridden",
    short_name: "should-be-overridden",
  };

  it("spreads static base then overrides name/short_name/id", () => {
    const body = buildManifestBody(BASE, "mybox.local");
    expect(body.icons).toEqual(BASE.icons);
    expect(body.theme_color).toBe("#3b82f6");
    expect(body.background_color).toBe("#0f172a");
    expect(body.display).toBe("standalone");
    expect(body.start_url).toBe("/");
    expect(body.id).toBe("/");
    expect(body.name).toBe("Pi-Dash \u00b7 mybox.local");
    expect(body.short_name).toBe("mybox.local");
  });

  it("truncates short_name to 12 characters", () => {
    const body = buildManifestBody(BASE, "abc123.share.zrok.io");
    expect(body.short_name).toBe("abc123.share");
    expect((body.short_name as string).length).toBe(12);
    // Full name keeps the untruncated source
    expect(body.name).toBe("Pi-Dash \u00b7 abc123.share.zrok.io");
  });

  it("falls back to 'Pi-Dash' for short_name when source is empty", () => {
    const body = buildManifestBody(BASE, "");
    expect(body.short_name).toBe("Pi-Dash");
    expect(body.name).toBe("Pi-Dash \u00b7 ");
  });

  it("does not mutate the input base object", () => {
    const base = { ...BASE };
    const frozen = JSON.stringify(base);
    buildManifestBody(base, "foo");
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("preserves arbitrary extra fields from the static base", () => {
    const body = buildManifestBody({ ...BASE, scope: "/", lang: "en" }, "x");
    expect(body.scope).toBe("/");
    expect(body.lang).toBe("en");
  });
});
