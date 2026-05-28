/**
 * Unit tests for resolveCdpActivation().
 *
 * Pure function: parses argv + env to decide whether to enable Chromium's
 * CDP debug surface, and on which port.
 *
 * See change: ship-browser-skill-and-electron-cdp.
 */
import { describe, it, expect } from "vitest";
import { resolveCdpActivation } from "../resolve-cdp-activation.js";

describe("resolveCdpActivation — disabled", () => {
  it("returns disabled when no flag and no env", () => {
    expect(resolveCdpActivation([], {})).toEqual({ enabled: false });
  });

  it("ignores unrelated flags", () => {
    expect(resolveCdpActivation(["--something-else", "--foo=9222"], {})).toEqual({
      enabled: false,
    });
  });

  it("treats PI_DEBUG_CDP=0 as disabled", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "0" })).toEqual({ enabled: false });
  });

  it("treats PI_DEBUG_CDP=false as disabled", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "false" })).toEqual({ enabled: false });
  });

  it("treats PI_DEBUG_CDP='' as disabled", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "" })).toEqual({ enabled: false });
  });
});

describe("resolveCdpActivation — CLI flag", () => {
  it("--debug-cdp uses default port 9222", () => {
    expect(resolveCdpActivation(["--debug-cdp"], {})).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("--debug-cdp=9333 uses explicit port", () => {
    expect(resolveCdpActivation(["--debug-cdp=9333"], {})).toEqual({
      enabled: true,
      port: 9333,
    });
  });

  it("ignores --debug-cdp= (empty value, treated as default port)", () => {
    expect(resolveCdpActivation(["--debug-cdp="], {})).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("--debug-cdp=garbage falls back to default port", () => {
    expect(resolveCdpActivation(["--debug-cdp=abc"], {})).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("--debug-cdp=0 falls back to default (invalid port)", () => {
    expect(resolveCdpActivation(["--debug-cdp=0"], {})).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("--debug-cdp=70000 falls back to default (out of range)", () => {
    expect(resolveCdpActivation(["--debug-cdp=70000"], {})).toEqual({
      enabled: true,
      port: 9222,
    });
  });
});

describe("resolveCdpActivation — env var", () => {
  it("PI_DEBUG_CDP=1 uses default port", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "1" })).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("PI_DEBUG_CDP=true uses default port", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "true" })).toEqual({
      enabled: true,
      port: 9222,
    });
  });

  it("PI_DEBUG_CDP=9444 uses explicit port", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "9444" })).toEqual({
      enabled: true,
      port: 9444,
    });
  });

  it("PI_DEBUG_CDP=garbage uses default port", () => {
    expect(resolveCdpActivation([], { PI_DEBUG_CDP: "garbage" })).toEqual({
      enabled: true,
      port: 9222,
    });
  });
});

describe("resolveCdpActivation — precedence (flag wins)", () => {
  it("--debug-cdp=9555 + PI_DEBUG_CDP=9777 → 9555", () => {
    expect(
      resolveCdpActivation(["--debug-cdp=9555"], { PI_DEBUG_CDP: "9777" }),
    ).toEqual({ enabled: true, port: 9555 });
  });

  it("--debug-cdp (default) + PI_DEBUG_CDP=9777 → 9222 (flag default wins)", () => {
    expect(
      resolveCdpActivation(["--debug-cdp"], { PI_DEBUG_CDP: "9777" }),
    ).toEqual({ enabled: true, port: 9222 });
  });
});

describe("resolveCdpActivation — argv positions", () => {
  it("finds flag anywhere in argv", () => {
    expect(
      resolveCdpActivation(["node", "main.js", "--debug-cdp=9100"], {}),
    ).toEqual({ enabled: true, port: 9100 });
  });
});
