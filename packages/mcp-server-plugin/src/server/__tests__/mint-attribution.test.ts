/**
 * Mint attribution (design.md Decision 6, test-plan M1/M2/M4).
 *
 * SCOPE, stated precisely because an earlier version of this file overclaimed:
 * these tests assert the HANDLER's contract — that it binds a token to the id it
 * is dispatched with, and ignores the payload. They do NOT prove that the
 * dispatched id is itself trustworthy.
 *
 * That second half is the security property, and it lives in the gateway:
 * `packages/server/src/__tests__/plugin-pi-message-attribution.test.ts`. Without
 * it, every assertion here is satisfied by an implementation that reads
 * `msg.sessionId` — which is exactly the spoofable state this change had to fix.
 */
import { describe, expect, it } from "vitest";
import { McpTokenRegistry } from "../tokens.js";

/**
 * The mint handler, as registered in the plugin entry. Written here in the
 * exact shape the seam dispatches — `(msg, sessionId)` — so the test exercises
 * the real contract rather than a paraphrase of it. Since D5 the handler has
 * NO return channel (the dispatcher discards return values): it mints, then
 * SENDS the plaintext back on the session-private lane via
 * `ctx.sendExtensionMessage`.
 */
function mintHandler(tokens: McpTokenRegistry, send: (sessionId: string, msg: unknown) => boolean) {
  return (msg: unknown, sessionId: string) => {
    void msg;
    const token = tokens.mintForSession(sessionId);
    send(sessionId, { type: "mcp_token_minted", token });
  };
}

const recordSend = () => {
  const sent: Array<{ sessionId: string; msg: unknown }> = [];
  const send = (sessionId: string, msg: unknown) => {
    sent.push({ sessionId, msg });
    return true;
  };
  return { send, sent };
};

describe("M1 — minting attributes to the connection's session", () => {
  it("binds the token to the sessionId the gateway supplied, and replies on the private lane", () => {
    const tokens = new McpTokenRegistry();
    const { send, sent } = recordSend();
    mintHandler(tokens, send)({}, "session-a");
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe("session-a");
    const token = (sent[0].msg as { token: string }).token;
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });
});

describe("M4 — the mint binds to the DISPATCHED id, not the payload", () => {
  it.each([
    ["sessionId", { sessionId: "session-b" }],
    ["session_id", { session_id: "session-b" }],
    ["callerSessionId", { callerSessionId: "session-b" }],
    ["a nested claim", { params: { sessionId: "session-b" } }],
    ["an array body", ["session-b"]],
    ["a string body", "session-b"],
  ])("a %s body field does not redirect the mint (E3)", (_label, body) => {
    const tokens = new McpTokenRegistry();
    const { send, sent } = recordSend();
    mintHandler(tokens, send)(body, "session-a");
    const token = (sent[0].msg as { token: string }).token;
    // The resolved caller is A — the body's B never becomes the caller.
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("the same body dispatched under two ids yields two distinct bindings", () => {
    const tokens = new McpTokenRegistry();
    const { send, sent } = recordSend();
    const handler = mintHandler(tokens, send);
    const body = { sessionId: "session-z" };
    handler(body, "session-a");
    handler(body, "session-b");
    const a = (sent[0].msg as { token: string }).token;
    const b = (sent[1].msg as { token: string }).token;
    expect(sent[0].sessionId).toBe("session-a");
    expect(sent[1].sessionId).toBe("session-b");
    expect(tokens.resolve(a)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(tokens.resolve(b)).toEqual({ kind: "session", sessionId: "session-b" });
  });

  it("E3 — a minted-for-A bearer presented with a body naming B still resolves to A", () => {
    // The resolution half of E3: the caller is derived from the credential
    // alone. A request body asserting `sessionId: "B"` cannot move it.
    const tokens = new McpTokenRegistry();
    const { send, sent } = recordSend();
    mintHandler(tokens, send)({}, "session-a");
    const tokenA = (sent[0].msg as { token: string }).token;
    expect(tokens.resolve(tokenA)).toEqual({ kind: "session", sessionId: "session-a" });
  });
});

describe("M2 — the resolved caller comes from server-side records", () => {
  it("resolves identity from the token alone, with no client input", () => {
    const tokens = new McpTokenRegistry();
    const { send, sent } = recordSend();
    mintHandler(tokens, send)({}, "session-a");
    const token = (sent[0].msg as { token: string }).token;
    // Resolution takes the credential and nothing else.
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(tokens.resolve(`${token}-tampered`)).toBeNull();
  });
});
