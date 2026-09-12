/**
 * The loopback bridge's positive credential (D6, tasks 5.3/5.4).
 *
 * Windows has no unix-socket transport, so its local bridge dials
 * `127.0.0.1:<piPort>` — an address, and an address is not a credential. The
 * `~/.pi/dashboard/local/token` secret is: only the same OS user can read it,
 * so a relayed peer presenting as loopback cannot forge it.
 *
 * Folds test-plan #X14 (tokenless) and #X15 (wrong token), which require the
 * two refusals to be DISTINGUISHABLE — "no credential" and "bad credential"
 * are different operational problems.
 *
 * See change: add-pi-gateway-transport-identity (tasks 12.33, 12.34).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createTestServer } from "../test-support/test-server.js";
import { ensureLocalToken, LOCAL_TOKEN_HEADER, verifyLocalToken } from "../auth/local-token.js";
import { decideBridgeUpgrade } from "../pi/bridge-upgrade-auth.js";

const refuseTicket = () => ({ ok: false as const, reason: "missing" as const });

let token: string;
let tokenDir: string;

beforeEach(() => {
  tokenDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "local-token-")), "local");
  token = ensureLocalToken(tokenDir);
});

/** The gate as the gateway wires it: a token check bound to the live secret. */
function decide(headers: Record<string, unknown>, opts: { requireTicketOnLoopback?: boolean } = {}) {
  return decideBridgeUpgrade({
    transport: "tcp",
    remoteAddress: "127.0.0.1",
    headers,
    consumeTicket: refuseTicket,
    verifyLocalToken: (h) => verifyLocalToken(h, token),
    ...opts,
  });
}

describe("loopback bridge upgrade with a local token", () => {
  it("admits a loopback bridge presenting the correct token, with no ticket", () => {
    const v = decide({ [LOCAL_TOKEN_HEADER]: token }, { requireTicketOnLoopback: true });
    expect(v.allow).toBe(true);
    // A positive credential, NOT the deprecation grace.
    expect(v).not.toHaveProperty("deprecated", true);
    expect(v.reason).toMatch(/local token/i);
  });

  it("refuses a TOKENLESS loopback bridge once the grace window closes (#X14)", () => {
    const v = decide({}, { requireTicketOnLoopback: true });
    expect(v.allow).toBe(false);
    expect(v).toMatchObject({ cause: "local-token-missing" });
  });

  it("refuses a WRONG token distinctly from a missing one (#X15)", () => {
    const v = decide({ [LOCAL_TOKEN_HEADER]: "not-the-token" }, { requireTicketOnLoopback: true });
    expect(v.allow).toBe(false);
    expect(v).toMatchObject({ cause: "local-token-invalid" });
    // The two causes must not collapse into one operational symptom.
    const missing = decide({}, { requireTicketOnLoopback: true });
    expect((missing as { cause?: string }).cause).not.toBe((v as { cause?: string }).cause);
  });

  it("never lets a token admit a REMOTE peer — the file proves same-user, not same-host", () => {
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "203.0.113.7",
      headers: { [LOCAL_TOKEN_HEADER]: token },
      consumeTicket: refuseTicket,
      verifyLocalToken: (h) => verifyLocalToken(h, token),
      requireTicketOnLoopback: true,
    });
    expect(v.allow).toBe(false);
  });

  it("never lets a token admit a RELAYED peer presenting as loopback", () => {
    const v = decide(
      { [LOCAL_TOKEN_HEADER]: token, "x-forwarded-for": "203.0.113.7" },
      { requireTicketOnLoopback: true },
    );
    expect(v.allow).toBe(false);
  });

  it("still admits a tokenless loopback bridge while the deprecation window is open", () => {
    const v = decide({});
    expect(v).toMatchObject({ allow: true, deprecated: true });
  });

  it("prefers the token over the grace, so the log shows a credential and not a horizon", () => {
    const v = decide({ [LOCAL_TOKEN_HEADER]: token });
    expect(v.allow).toBe(true);
    expect(v).not.toHaveProperty("deprecated", true);
  });
});

describe("the token file itself", () => {
  it("is 0600 in a 0700 dir — the guarantee the whole scheme rests on", () => {
    if (process.platform === "win32") return; // chmod is a documented no-op (task 5.5)
    expect(fs.statSync(path.join(tokenDir, "token")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(tokenDir).mode & 0o777).toBe(0o700);
  });
});

/**
 * #E11 — the same refusal through the REAL pi-gateway TCP listener: a browser
 * page dialling `ws://127.0.0.1:<piPort>` gets 401 and registers nothing.
 * See change: fix-ws-origin-cswsh.
 */
describe("pi-gateway TCP listener refuses a browser Origin (#E11)", () => {
  it("401s an origin-bearing dial, registers no session, and names the cause in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = await createTestServer();
    try {
      const before = handle.server.sessionManager.listAll().length;
      const status = await new Promise<number | "open">((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle.piPort}/`, {
          headers: { origin: "http://attacker.example" },
        });
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("error", () => resolve(0));
        setTimeout(() => resolve(0), 5000);
      });

      expect(status).toBe(401);
      expect(handle.server.sessionManager.listAll().length).toBe(before);
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("[pi-gateway]");
      expect(logged).toContain("browser-origin");
    } finally {
      await handle.stop();
      warn.mockRestore();
    }
  }, 20000);
});
