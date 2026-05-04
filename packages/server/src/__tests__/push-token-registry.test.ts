import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPushTokenRegistry } from "../push/push-token-registry.js";

function makeValidToken(endpoint = "https://example.com/push/abc") {
  return {
    deviceToken: {
      endpoint,
      keys: { p256dh: "BPn0Gq3mF0H0qTktY3qjHqRTPW4xHjeJF5NRQ_wTD4uWNz5ATxq7wE6LWEPYJI3KQ9YSZYBdNl_h7Tq2A", auth: "abcd1234abcd1234" },
    },
    transport: "web-push",
    userId: "user-1",
  };
}

describe("PushTokenRegistry", () => {
  let testDir: string;
  let tokenPath: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `push-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    tokenPath = path.join(testDir, ".pi", "dashboard", "push-tokens.json");
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  describe("add", () => {
    it("returns an id and adds a token", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      const id = reg.add(makeValidToken());
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      const list = reg.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
      expect(list[0].transport).toBe("web-push");
      expect(list[0].registeredAt).toBeTruthy();
      expect(list[0].lastUsedAt).toBeTruthy();
    });

    it("is idempotent by endpoint", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      const id1 = reg.add(makeValidToken());
      const id2 = reg.add(makeValidToken()); // same endpoint
      expect(id2).toBe(id1);
      expect(reg.list()).toHaveLength(1);
    });

    it("rejects non-HTTPS endpoints", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() =>
        reg.add(makeValidToken("http://example.com/push/abc")),
      ).toThrow("must be an HTTPS URL");
    });

    it("rejects missing keys.p256dh", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() =>
        reg.add({
          deviceToken: {
            endpoint: "https://example.com/push/abc",
            keys: { p256dh: "", auth: "x" },
          },
          transport: "web-push",
        }),
      ).toThrow("p256dh must be a non-empty base64url string");
    });

    it("rejects missing keys.auth", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() =>
        reg.add({
          deviceToken: {
            endpoint: "https://example.com/push/abc",
            keys: { p256dh: "x", auth: "" },
          },
          transport: "web-push",
        }),
      ).toThrow("auth must be a non-empty base64url string");
    });

    it("rejects missing keys object", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() =>
        reg.add({
          deviceToken: {
            endpoint: "https://example.com/push/abc",
            keys: undefined as any,
          },
          transport: "web-push",
        }),
      ).toThrow("deviceToken.keys must be an object");
    });

    it("rejects non-object deviceToken", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() =>
        reg.add({ deviceToken: null as any, transport: "web-push" }),
      ).toThrow("deviceToken must be an object");
    });
  });

  describe("remove", () => {
    it("removes an existing token", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      const id = reg.add(makeValidToken());
      expect(reg.list()).toHaveLength(1);
      expect(reg.remove(id)).toBe(true);
      expect(reg.list()).toHaveLength(0);
    });

    it("returns false for unknown id", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(reg.remove("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    it("returns empty array when no tokens", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(reg.list()).toEqual([]);
    });
  });

  describe("findByEndpoint", () => {
    it("finds token by endpoint", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      const id = reg.add(makeValidToken("https://foo.com/push/x"));
      const found = reg.findByEndpoint("https://foo.com/push/x");
      expect(found).toBeTruthy();
      expect(found!.id).toBe(id);
    });

    it("returns undefined for unknown endpoint", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(reg.findByEndpoint("https://unknown.com/push/x")).toBeUndefined();
    });
  });

  describe("touch", () => {
    it("updates lastUsedAt", async () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      const id = reg.add(makeValidToken());
      const before = reg.list()[0].lastUsedAt;
      // Wait a few ms to get a different timestamp
      await new Promise((r) => setTimeout(r, 5));
      reg.touch(id);
      const after = reg.list()[0].lastUsedAt;
      expect(after).not.toBe(before);
    });

    it("is a no-op for unknown id", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      expect(() => reg.touch("nonexistent")).not.toThrow();
    });
  });

  describe("listMeta", () => {
    it("returns safe metadata without keys", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      reg.add(makeValidToken("https://example.com/push/abcd1234"));
      const meta = reg.listMeta();
      expect(meta).toHaveLength(1);
      expect(meta[0].id).toBeTruthy();
      expect(meta[0].transport).toBe("web-push");
      expect(meta[0].endpointLast4).toBe("1234");
      expect(meta[0].registeredAt).toBeTruthy();
      expect(meta[0].lastUsedAt).toBeTruthy();
      // No full endpoint, no keys
      expect((meta[0] as any).deviceToken).toBeUndefined();
      expect((meta[0] as any).endpoint).toBeUndefined();
      expect((meta[0] as any).keys).toBeUndefined();
    });
  });

  describe("persistence round-trip", () => {
    it("survives a re-creation of the registry", () => {
      const reg1 = createPushTokenRegistry({ path: tokenPath });
      const id = reg1.add(makeValidToken());

      // New registry instance — must load from disk
      const reg2 = createPushTokenRegistry({ path: tokenPath });
      const list = reg2.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
    });
  });

  describe("permissions", () => {
    it("creates file with 0600 permissions", () => {
      const reg = createPushTokenRegistry({ path: tokenPath });
      reg.add(makeValidToken());

      const stat = fs.statSync(tokenPath);
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
