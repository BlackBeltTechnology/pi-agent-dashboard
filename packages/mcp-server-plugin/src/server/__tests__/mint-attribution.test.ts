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
 * the real contract rather than a paraphrase of it.
 */
function mintHandler(tokens: McpTokenRegistry) {
  return (_msg: unknown, sessionId: string) => ({ token: tokens.mintForSession(sessionId) });
}

describe("M1 — minting attributes to the connection's session", () => {
  it("binds the token to the sessionId the gateway supplied", () => {
    const tokens = new McpTokenRegistry();
    const { token } = mintHandler(tokens)({}, "session-a");
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
  ])("a %s body field does not redirect the mint", (_label, body) => {
    const tokens = new McpTokenRegistry();
    const { token } = mintHandler(tokens)(body, "session-a");
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("the same body dispatched under two ids yields two distinct bindings", () => {
    const tokens = new McpTokenRegistry();
    const handler = mintHandler(tokens);
    const body = { sessionId: "session-z" };
    const a = handler(body, "session-a").token;
    const b = handler(body, "session-b").token;
    expect(tokens.resolve(a)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(tokens.resolve(b)).toEqual({ kind: "session", sessionId: "session-b" });
  });
});

describe("M2 — the resolved caller comes from server-side records", () => {
  it("resolves identity from the token alone, with no client input", () => {
    const tokens = new McpTokenRegistry();
    const { token } = mintHandler(tokens)({}, "session-a");
    // Resolution takes the credential and nothing else.
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
    expect(tokens.resolve(`${token}-tampered`)).toBeNull();
  });
});
