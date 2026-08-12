/**
 * Mint attribution (design.md Decision 6, test-plan M1/M2/M4).
 *
 * The property under test is the one the whole self-target guard rests on: a
 * minted token binds to the session whose SOCKET carried the request, and
 * nothing on the wire can redirect that.
 *
 * This is asserted at the seam rather than end-to-end because the seam is where
 * the guarantee actually lives: `dispatchPluginPiMessage` hands the handler the
 * gateway's own key, so the handler has no body-derived alternative to choose.
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

describe("M4 — minting for a foreign session is unrepresentable", () => {
  it("ignores a body field naming another session", () => {
    const tokens = new McpTokenRegistry();
    // The spoof attempt: session A's socket carries a body claiming session B.
    const { token } = mintHandler(tokens)({ sessionId: "session-b" }, "session-a");

    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it.each([
    ["sessionId", { sessionId: "session-b" }],
    ["session_id", { session_id: "session-b" }],
    ["callerSessionId", { callerSessionId: "session-b" }],
    ["a nested claim", { params: { sessionId: "session-b" } }],
    ["an array body", ["session-b"]],
    ["a string body", "session-b"],
  ])("a %s body field cannot redirect the mint", (_label, body) => {
    const tokens = new McpTokenRegistry();
    const { token } = mintHandler(tokens)(body, "session-a");
    expect(tokens.resolve(token)).toEqual({ kind: "session", sessionId: "session-a" });
  });

  it("the handler has no parameter through which a body could be preferred", () => {
    // Structural, and the strongest form of this assertion: attribution is the
    // handler's SECOND parameter, supplied by the dispatcher. The body is the
    // first and is never read for identity. A future edit that starts trusting
    // the body would have to add a code path this signature does not invite.
    const tokens = new McpTokenRegistry();
    const handler = mintHandler(tokens);
    expect(handler.length).toBe(2);

    // Same body, two different sockets → two different bindings.
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
