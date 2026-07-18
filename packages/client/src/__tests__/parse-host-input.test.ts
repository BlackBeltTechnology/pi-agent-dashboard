import { describe, it, expect } from "vitest";
import { parseHostInput } from "../lib/util/parse-host-input.js";

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
