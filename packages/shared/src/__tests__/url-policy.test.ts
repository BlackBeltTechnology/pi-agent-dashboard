/**
 * classifyUrl — the one navigation-target classifier shared by client,
 * plugins and Electron (change: harden-client-sinks, design D2).
 */
import { describe, expect, it } from "vitest";
import { classifyUrl } from "../url-policy.js";

describe("classifyUrl — scheme partitions (test-plan #E4)", () => {
  const origin = "https://dash.example";
  it.each([
    "javascript:x",
    " JaVaScRiPt:x",
    "vbscript:x",
    "data:text/html,x",
    "blob:https://a/b",
    "file:///etc/passwd",
    "ms-msdt:x",
  ])("%j → blocked", (v) => {
    expect(classifyUrl(v, origin)).toBe("blocked");
  });

  it("mailto → mailto", () => {
    expect(classifyUrl("mailto:a@b", origin)).toBe("mailto");
  });

  it("public https → external", () => {
    expect(classifyUrl("https://github.com/x", origin)).toBe("external");
  });

  it.each([undefined, null, 42, {}, "", "   "])("non-string / empty %j → blocked", (v) => {
    expect(classifyUrl(v, origin)).toBe("blocked");
  });
});

describe("classifyUrl — raw-string edges (test-plan #E5)", () => {
  const origin = "https://dash.example";
  it.each(["https://exa\tmple.com/", "java\x01script:alert(1)", "/\\evil.example", "\\\\evil.example"])(
    "%j → blocked",
    (v) => {
      expect(classifyUrl(v, origin)).toBe("blocked");
    },
  );

  it("leading/trailing whitespace is trimmed", () => {
    expect(classifyUrl("  https://ok.example/  ", origin)).toBe("external");
  });
});

describe("classifyUrl — loopback, LAN, precedence, scheme-relative (test-plan #E6)", () => {
  const origin = "http://localhost:8000";
  it("same origin wins over loopback", () => {
    expect(classifyUrl("http://localhost:8000/settings", origin)).toBe("internal");
  });
  it.each([
    "http://0x7f.0.0.1/",
    "http://2130706433/",
    "http://localhost./",
    "http://app.localhost:5173/",
    "http://[::1]:8080/",
  ])("%j → loopback", (v) => {
    expect(classifyUrl(v, origin)).toBe("loopback");
  });
  it("LAN http dashboard → external", () => {
    expect(classifyUrl("http://192.168.16.204:8000/", origin)).toBe("external");
  });
  it("scheme-relative same host is never internal", () => {
    expect(classifyUrl("//localhost:8000/settings", origin)).not.toBe("internal");
  });
  it("scheme-relative foreign host → external", () => {
    expect(classifyUrl("//evil.example/x", origin)).toBe("external");
  });
  it("same-origin paths → internal", () => {
    expect(classifyUrl("/settings/general", "https://dash.example")).toBe("internal");
    expect(classifyUrl("/folder/abc/view?path=README.md", "https://dash.example")).toBe("internal");
  });
});

describe("classifyUrl — no page origin", () => {
  it.each(["/settings", "//evil.example/x", "settings"])("%j → blocked", (v) => {
    expect(classifyUrl(v, null)).toBe("blocked");
  });
  it("absolute http to the would-be origin is external/loopback, never internal", () => {
    expect(classifyUrl("http://localhost:8000/x", null)).toBe("loopback");
  });
});
