/**
 * Pure policy decisions for the live-server viewer.
 * See change: improve-canvas-html-and-url-ux (D3/D4/D5/D9; test-plan #F6/#F7/#F8).
 */
import { describe, expect, it } from "vitest";
import { classifyAddress, egressForOpener, needsRunScripts, parsePresetPath, sandboxFor, wantedPolicy } from "../preview-policy.js";

describe("sandboxFor (D3 table)", () => {
  it("open + scripts → exactly the four tokens, never allow-same-origin", () => {
    expect(sandboxFor({ egress: "open", scripts: true })).toBe("allow-scripts allow-forms allow-popups allow-downloads");
  });
  it("restricted + scripts → scripts + forms only (no popups, no downloads)", () => {
    expect(sandboxFor({ egress: "restricted", scripts: true })).toBe("allow-scripts allow-forms");
  });
  it("scripts off → empty, for both egress modes", () => {
    expect(sandboxFor({ egress: "open", scripts: false })).toBe("");
    expect(sandboxFor({ egress: "restricted", scripts: false })).toBe("");
  });
});

describe("provenance → egress", () => {
  it("operator opens, everything else restricts", () => {
    expect(egressForOpener("operator")).toBe("open");
    expect(egressForOpener("agent")).toBe("restricted");
  });
});

describe("wantedPolicy / needsRunScripts (D5)", () => {
  const base = { opener: "agent" as const, scriptsOn: true, exposed: false, runScriptsApproved: false };
  it("local-only restricted keeps scripts", () => {
    expect(wantedPolicy(base)).toEqual({ egress: "restricted", scripts: true });
    expect(needsRunScripts(base)).toBe(false);
  });
  it("exposed restricted drops scripts until Run scripts", () => {
    expect(wantedPolicy({ ...base, exposed: true })).toEqual({ egress: "restricted", scripts: false });
    expect(needsRunScripts({ ...base, exposed: true })).toBe(true);
    expect(wantedPolicy({ ...base, exposed: true, runScriptsApproved: true })).toEqual({ egress: "restricted", scripts: true });
  });
  it("an operator open is not gated by exposure", () => {
    expect(wantedPolicy({ ...base, opener: "operator", exposed: true })).toEqual({ egress: "open", scripts: true });
  });
  it("the Static toggle wins and Run scripts is not offered when scripts are off", () => {
    expect(wantedPolicy({ ...base, scriptsOn: false, exposed: true })).toEqual({ egress: "restricted", scripts: false });
    expect(needsRunScripts({ ...base, scriptsOn: false, exposed: true })).toBe(false);
  });
});

describe("parsePresetPath", () => {
  it("live: loopback URL → host/port/deep (path + query, no leading slash)", () => {
    expect(parsePresetPath("live:http://localhost:5173/report.html?x=1")).toEqual({
      kind: "port",
      host: "localhost",
      port: 5173,
      deep: "report.html?x=1",
    });
  });
  it("root URL → empty deep", () => {
    expect(parsePresetPath("live:http://localhost:5173")).toMatchObject({ kind: "port", deep: "" });
  });
  it("dot-segment / encoded traversal deep path is refused, not resolved", () => {
    expect(parsePresetPath("live:http://localhost:50452/a/%2e%2e/%2e%2e/x")).toEqual({ kind: "invalid-path" });
    expect(parsePresetPath("live:http://localhost:50452/../x")).toEqual({ kind: "invalid-path" });
  });
  it("live:preview, empty and non-loopback → null (picker)", () => {
    expect(parsePresetPath("live:preview")).toBeNull();
    expect(parsePresetPath(undefined)).toBeNull();
    expect(parsePresetPath("live:http://evil.com/")).toBeNull();
  });
  it("static:<file> keeps the file path verbatim", () => {
    expect(parsePresetPath("static:mockups/a/index.html")).toEqual({ kind: "static", file: "mockups/a/index.html" });
    expect(parsePresetPath("static:")).toBeNull();
  });
});

describe("classifyAddress (D9)", () => {
  const stat = { kind: "static" } as const;
  const port = { kind: "port", host: "localhost", port: 5173 } as const;
  it("a path within a static target is `same`", () => {
    expect(classifyAddress("screens/b.html", stat)).toEqual({ kind: "same", deep: "screens/b.html" });
    expect(classifyAddress("", stat)).toEqual({ kind: "same", deep: "" });
  });
  it("dot-segments are an invalid path", () => {
    expect(classifyAddress("../../api/sessions", stat)).toEqual({ kind: "error", reason: "invalid-path" });
    expect(classifyAddress("../../api/sessions", port)).toEqual({ kind: "error", reason: "invalid-path" });
  });
  it("a URL on the same port target is `same`; another loopback port needs confirmation", () => {
    expect(classifyAddress("http://localhost:5173/dashboard", port)).toEqual({ kind: "same", deep: "dashboard" });
    expect(classifyAddress("http://127.0.0.1:5173/", port)).toEqual({ kind: "same", deep: "" });
    expect(classifyAddress("http://localhost:5174/", port)).toEqual({ kind: "other", host: "localhost", port: 5174, deep: "" });
  });
  it("non-loopback is refused, as is any URL on a static target", () => {
    expect(classifyAddress("http://10.0.0.5/", port)).toEqual({ kind: "error", reason: "loopback-only" });
    expect(classifyAddress("http://localhost:5173/", stat)).toEqual({ kind: "error", reason: "loopback-only" });
  });
});
