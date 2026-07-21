import { describe, it, expect, afterEach, beforeAll } from "vitest";
import http from "node:http";
import net from "node:net";
import { startCallbackServer, closeAllCallbackServers } from "../auth/oauth-callback-server.js";

/** Probe an OS-assigned free port so parallel forks never collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
  });
}

// Probe a free port per fork to avoid cross-fork conflicts under parallelism.
let TEST_PORT: number;
beforeAll(async () => {
  TEST_PORT = await freePort();
});

afterEach(async () => {
  await closeAllCallbackServers();
});

describe("startCallbackServer", () => {
  it("receives callback code and calls onCode", async () => {
    let receivedCode = "";
    let receivedState = "";

    const server = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async (code, state) => {
        receivedCode = code;
        receivedState = state;
      },
    });

    const res = await httpGet(TEST_PORT, "/callback?code=abc123&state=xyz");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Authorization successful");
    expect(receivedCode).toBe("abc123");
    expect(receivedState).toBe("xyz");

    // Server should auto-close after callback
    await server.closed;
  });

  it("serves error HTML when OAuth returns error", async () => {
    const server = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async () => {},
    });

    const res = await httpGet(TEST_PORT, "/callback?error=access_denied&error_description=User+denied");
    expect(res.status).toBe(200);
    expect(res.body).toContain("User denied");

    await server.closed;
  });

  it("times out and closes if no callback received", async () => {
    const server = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 200,
      onCode: async () => {},
    });

    await server.closed;
    // Port should be released — verify by starting another server
    const server2 = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 200,
      onCode: async () => {},
    });
    await server2.closed;
  });

  it("returns error when port is in use", async () => {
    // Occupy the port with a plain HTTP server on 127.0.0.1 (same as callback server)
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(TEST_PORT, "127.0.0.1", resolve));

    try {
      await expect(
        startCallbackServer({
          providerId: "test-provider",
          port: TEST_PORT,
          path: "/callback",
          timeoutMs: 5000,
          onCode: async () => {},
        }),
      ).rejects.toThrow(/in use/i);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("closes existing server before starting new one for same provider", async () => {
    let callCount = 0;

    await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 30000,
      onCode: async () => { callCount++; },
    });

    // Start a new one for the same provider — should close the first
    const server2 = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async () => { callCount++; },
    });

    const res = await httpGet(TEST_PORT, "/callback?code=test&state=s");
    expect(res.status).toBe(200);
    expect(callCount).toBe(1); // Only second server's onCode called

    await server2.closed;
  });

  it("ignores requests to wrong path", async () => {
    const server = await startCallbackServer({
      providerId: "test-provider",
      port: TEST_PORT,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async () => {},
    });

    const res = await httpGet(TEST_PORT, "/wrong-path?code=abc");
    expect(res.status).toBe(404);

    // Server should still be running — close it
    await closeAllCallbackServers();
  });

  it("handles onCode errors gracefully", async () => {
    const port = await freePort();
    const server = await startCallbackServer({
      providerId: "test-error-provider",
      port,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async () => { throw new Error("exchange failed"); },
    });

    const res = await httpGet(port, "/callback?code=abc&state=s");
    expect(res.status).toBe(200);
    expect(res.body).toContain("exchange failed");

    await server.closed;
  });
});
