import { describe, it, expect, beforeEach } from "vitest";
import { deriveApiBase, setGlobalApiBase, getApiBase } from "../lib/api/api-context.js";

describe("deriveApiBase", () => {
  it("returns empty string for same-origin ws URL", () => {
    // window.location.origin in jsdom is "http://localhost:3000" or similar
    // Construct a ws URL matching that
    const origin = window.location.origin;
    const wsUrl = origin.replace("http:", "ws:").replace("https:", "wss:") + "/ws";
    expect(deriveApiBase(wsUrl)).toBe("");
  });

  it("returns http origin for cross-origin ws URL", () => {
    expect(deriveApiBase("ws://remote-host:8000/ws")).toBe("http://remote-host:8000");
  });

  it("returns https origin for wss URL", () => {
    expect(deriveApiBase("wss://remote-host:8000/ws")).toBe("https://remote-host:8000");
  });

  it("returns empty string for invalid URL", () => {
    expect(deriveApiBase("not-a-url")).toBe("");
  });

  it("strips path from ws URL", () => {
    expect(deriveApiBase("ws://example.com:9000/ws/something")).toBe("http://example.com:9000");
  });
});

describe("global api base", () => {
  beforeEach(() => setGlobalApiBase(""));

  it("defaults to empty string", () => {
    expect(getApiBase()).toBe("");
  });

  it("can be set and retrieved", () => {
    setGlobalApiBase("http://remote:8000");
    expect(getApiBase()).toBe("http://remote:8000");
  });
});
