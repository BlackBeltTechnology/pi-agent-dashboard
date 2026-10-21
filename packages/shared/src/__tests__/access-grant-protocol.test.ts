/**
 * Access-grant prompt protocol (change: add-access-grant-dialog, tasks 2.1/2.2).
 *
 * Two things are asserted here rather than discovered later:
 *
 * 1. Every new frame is a member of the union it travels on. A frame declared
 *    but not unioned is dead on arrival — esbuild drops the `case` that handles
 *    it, exactly the regression `browser-protocol-types.test.ts` guards against.
 * 2. A DEFERRED prompt cannot represent `allow-once`. No request is suspended
 *    for it to release, so the verdict is unrepresentable at the type level
 *    rather than merely hidden by the UI (spec: `access-grant-dialog`, "the
 *    allow-once answer SHALL be absent rather than disabled").
 */
import { describe, expect, it } from "vitest";
import type {
  BrowserToServerMessage,
  DeferredGrantPromptCopy,
  GrantChannelMessage,
  GrantDismissMessage,
  GrantPromptCopy,
  GrantRequestMessage,
  GrantResponseBrowserMessage,
  HeldGrantPromptCopy,
  ProvisionDismissMessage,
  ProvisionRequestMessage,
  ProvisionResponseMessage,
  ServerToBrowserMessage,
} from "../browser-protocol.js";

/** Identity helper: assignability to the union is the assertion. */
const asServerToBrowser = (m: ServerToBrowserMessage): ServerToBrowserMessage => m;
const asBrowserToServer = (m: BrowserToServerMessage): BrowserToServerMessage => m;

const heldCopy: HeldGrantPromptCopy = {
  mode: "held",
  verdicts: ["allow-once", "allow-always", "deny"],
  store: "path-anchor-grants.json",
  ladder: [{ subject: "/a/b/c" }, { subject: "/a/b", boundary: "highest rung is the checkout root" }],
};

const deferredCopy: DeferredGrantPromptCopy = {
  mode: "deferred",
  verdicts: ["allow-always", "deny"],
  store: "config.trustedNetworks",
};

describe("access-grant frames are members of their unions", () => {
  it("grant_channel rides the server→browser union", () => {
    const msg: GrantChannelMessage = { type: "grant_channel", capability: "nonce-value" };
    expect(asServerToBrowser(msg).type).toBe("grant_channel");
  });

  it("grant_request rides the server→browser union", () => {
    const msg: GrantRequestMessage = {
      type: "grant_request",
      promptId: "p1",
      plane: "filesystem",
      subject: "/a/b/c",
      expiresAt: 1_700_000_120_000,
      copy: heldCopy,
    };
    expect(asServerToBrowser(msg).type).toBe("grant_request");
    expect(msg.plane).toBe("filesystem");
  });

  it("grant_dismiss rides the server→browser union", () => {
    const msg: GrantDismissMessage = {
      type: "grant_dismiss",
      promptId: "p1",
      plane: "cwd",
      subject: "/a/b",
      reason: "settled",
    };
    expect(asServerToBrowser(msg).type).toBe("grant_dismiss");
  });

  it("grant_response rides the browser→server union", () => {
    const msg: GrantResponseBrowserMessage = {
      type: "grant_response",
      promptId: "p1",
      plane: "cors",
      subject: "https://example.com",
      verdict: "allow-always",
    };
    expect(asBrowserToServer(msg).type).toBe("grant_response");
  });
});

describe("provisioning frames are members of their unions (add-access-provisioning)", () => {
  it("provision_request and provision_dismiss ride the server→browser union", () => {
    const req: ProvisionRequestMessage = {
      type: "provision_request",
      requestId: "r1",
      projectRoot: "/w/app",
      lines: [{ lineId: "l1", path: "/w/lib", why: "shared lib", classification: "grantable", projectRoot: true }],
      remote: ["lan"],
      expiresAt: 1_700_000_600_000,
    };
    const dismiss: ProvisionDismissMessage = { type: "provision_dismiss", requestId: "r1", reason: "settled" };
    expect(asServerToBrowser(req).type).toBe("provision_request");
    expect(asServerToBrowser(dismiss).type).toBe("provision_dismiss");
  });

  it("provision_response rides the browser→server union", () => {
    const msg: ProvisionResponseMessage = {
      type: "provision_response",
      requestId: "r1",
      lines: [{ lineId: "l1", verdict: "approve", piTrust: false }, { lineId: "l2", verdict: "reject" }],
    };
    expect(asBrowserToServer(msg).type).toBe("provision_response");
  });
});

describe("a deferred prompt cannot carry allow-once", () => {
  it("is absent from the deferred verdict set at runtime", () => {
    expect(deferredCopy.verdicts).not.toContain("allow-once");
    expect(deferredCopy.verdicts).toEqual(["allow-always", "deny"]);
  });

  it("is rejected by the type checker", () => {
    const bad: DeferredGrantPromptCopy = {
      mode: "deferred",
      // @ts-expect-error — `allow-once` is not a DeferredGrantVerdict
      verdicts: ["allow-once"],
      store: "config.trustedNetworks",
    };
    expect(bad.mode).toBe("deferred");
  });

  it("discriminates the copy union on mode", () => {
    const held: GrantPromptCopy = heldCopy;
    const deferred: GrantPromptCopy = deferredCopy;
    expect(held.mode).toBe("held");
    expect(deferred.mode).toBe("deferred");
    // A held prompt is the only one that may offer the third answer.
    expect(held.mode === "held" && held.verdicts).toContain("allow-once");
  });
});
