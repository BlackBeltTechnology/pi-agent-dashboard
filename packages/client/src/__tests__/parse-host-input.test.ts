import { describe, it, expect } from "vitest";
import { parseHostInput, parseRouteInput } from "../lib/util/parse-host-input.js";

describe("parseHostInput", () => {
  it("parses full http URL with port", () => {
    expect(parseHostInput("http://192.168.16.202:8000")).toEqual({
      host: "192.168.16.202",
      port: 8000,
    });
  });

  it("parses https URL with port and path", () => {
    expect(parseHostInput("https://office-mac.local:8000/some/path")).toEqual({
      host: "office-mac.local",
      port: 8000,
    });
  });

  it("uses default port when URL has none", () => {
    expect(parseHostInput("http://office-mac.local", 8000)).toEqual({
      host: "office-mac.local",
      port: 8000,
    });
  });

  it("parses host:port", () => {
    expect(parseHostInput("192.168.16.202:8000")).toEqual({
      host: "192.168.16.202",
      port: 8000,
    });
  });

  it("parses bare hostname with default port", () => {
    expect(parseHostInput("office-mac.local", 8000)).toEqual({
      host: "office-mac.local",
      port: 8000,
    });
  });

  it("parses bracketed IPv6 with port", () => {
    expect(parseHostInput("[::1]:8000")).toEqual({ host: "::1", port: 8000 });
  });

  it("parses bracketed IPv6 without port", () => {
    expect(parseHostInput("[::1]", 8000)).toEqual({ host: "::1", port: 8000 });
  });

  it("trims whitespace", () => {
    expect(parseHostInput("   192.168.16.202:8000   ")).toEqual({
      host: "192.168.16.202",
      port: 8000,
    });
  });

  it("rejects empty input", () => {
    expect(parseHostInput("")).toBeNull();
    expect(parseHostInput("   ")).toBeNull();
  });

  it("rejects bare IPv6 without brackets (ambiguous)", () => {
    expect(parseHostInput("::1:8000")).toBeNull();
  });

  it("rejects invalid port", () => {
    expect(parseHostInput("host:abc")).toBeNull();
    expect(parseHostInput("host:0")).toBeNull();
    expect(parseHostInput("host:99999")).toBeNull();
  });

  it("rejects bad URL", () => {
    expect(parseHostInput("http://")).toBeNull();
  });
});

// See change: group-servers-by-identity (test-plan #E9, task 5.3).
describe("parseRouteInput (#E9)", () => {
  it.each([
    ["https://lab.example.org", { host: "lab.example.org", port: 443, scheme: "https" }],
    ["https://lab.example.org:8443", { host: "lab.example.org", port: 8443, scheme: "https" }],
    ["http://192.168.16.202:9000", { host: "192.168.16.202", port: 9000, scheme: "http" }],
    ["http://192.168.16.202", { host: "192.168.16.202", port: 8000, scheme: "http" }],
    ["office-mac.local", { host: "office-mac.local", port: 8000, scheme: "http" }],
    ["192.168.16.202:8000", { host: "192.168.16.202", port: 8000, scheme: "http" }],
    ["[::1]", { host: "::1", port: 8000, scheme: "http" }],
    ["https://[::1]", { host: "::1", port: 443, scheme: "https" }],
    ["  host:1 ", { host: "host", port: 1, scheme: "http" }],
    ["host:65535", { host: "host", port: 65535, scheme: "http" }],
    ["HTTPS://Lab.Example.org:443/x", { host: "Lab.Example.org", port: 443, scheme: "https" }],
    ["http://host:80", { host: "host", port: 80, scheme: "http" }],
  ])("%j parses to the scheme and port defaults", (input, expected) => {
    expect(parseRouteInput(input)).toEqual(expected);
  });

  it.each([
    "host:0",
    "host:65536",
    "host:abc",
    "ftp://host",
    "ws://h",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://",
    "::1:8000",
    "",
    "   ",
    "http://user@host:8000",
    "host/path",
  ])("%j → null", (input) => {
    expect(parseRouteInput(input)).toBeNull();
  });

  it("parseHostInput outputs are unchanged (regression)", () => {
    expect(parseHostInput("https://lab.example.org")).toEqual({ host: "lab.example.org", port: 8000 });
    expect(parseHostInput("[::1]")).toEqual({ host: "::1", port: 8000 });
    expect(parseHostInput("ftp://host")).toEqual({ host: "host", port: 8000 });
  });
});
