import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { afterEach, describe, expect, it } from "vitest";
import { AccessPlaneRegistry } from "../access-plane.js";
import { holdDenial, installGrantCoordinator } from "../denial-hold.js";
import { GrantCoordinator } from "../grant-coordinator.js";
import type { GrantTransition } from "../pending-grant-registry.js";
import {
  __resetPromptChannels,
  GRANT_CHANNEL_HEADER,
  isPromptEligible,
  issuePromptChannel,
  maySuspend,
  promptChannelCount,
  releasePromptChannel,
  resolvePromptChannel,
} from "../prompt-channel.js";

/**
 * Per-connection prompt capabilities (change: add-access-grant-dialog, tasks
 * 3.1/3.3/3.4; test-plan #E1, #E5, #E6, #E7).
 */

afterEach(() => {
  __resetPromptChannels();
});

const req = (headers: Record<string, string | string[] | undefined>) => ({ headers });

describe("issue → resolve", () => {
  it("issues a high-entropy value that resolves to its socket", () => {
    const cap = issuePromptChannel("sock-1");
    expect(cap).toHaveLength(43); // 32 bytes base64url, unpadded
    expect(resolvePromptChannel(cap)).toBe("sock-1");
  });

  it("issues a DISTINCT value per socket", () => {
    const a = issuePromptChannel("sock-1");
    const b = issuePromptChannel("sock-2");
    expect(a).not.toBe(b);
    expect(resolvePromptChannel(a)).toBe("sock-1");
    expect(resolvePromptChannel(b)).toBe("sock-2");
  });

  it("re-issuing replaces the previous value for that socket", () => {
    const first = issuePromptChannel("sock-1");
    const second = issuePromptChannel("sock-1");
    expect(resolvePromptChannel(first)).toBeNull();
    expect(resolvePromptChannel(second)).toBe("sock-1");
    expect(promptChannelCount()).toBe(1);
  });
});

describe("a capability dies with its connection", () => {
  it("resolves to nothing after release (test-plan #E7)", () => {
    const cap = issuePromptChannel("sock-1");
    releasePromptChannel("sock-1");
    expect(resolvePromptChannel(cap)).toBeNull();
    expect(promptChannelCount()).toBe(0);
  });

  it("releasing an unknown socket is harmless", () => {
    expect(() => releasePromptChannel("nope")).not.toThrow();
  });
});

describe("absent, empty, wrong, and non-string are treated IDENTICALLY", () => {
  it("resolves to null in every case (test-plan #E5, #E6)", () => {
    issuePromptChannel("sock-1");
    expect(resolvePromptChannel(undefined)).toBeNull();
    expect(resolvePromptChannel("")).toBeNull();
    expect(resolvePromptChannel("wrong-value")).toBeNull();
    expect(resolvePromptChannel(null)).toBeNull();
    expect(resolvePromptChannel(42)).toBeNull();
    expect(resolvePromptChannel({})).toBeNull();
  });

  it("is off by one byte from a real capability — still null", () => {
    const cap = issuePromptChannel("sock-1");
    const offByOne = `${cap.slice(0, -1)}${cap.endsWith("A") ? "B" : "A"}`;
    expect(offByOne).not.toBe(cap);
    expect(resolvePromptChannel(offByOne)).toBeNull();
  });
});

describe("isPromptEligible reads ONLY the capability header", () => {
  it("is eligible when the correct value is carried", () => {
    const cap = issuePromptChannel("sock-1");
    expect(isPromptEligible(req({ [GRANT_CHANNEL_HEADER]: cap }))).toBe(true);
  });

  it("is eligible with auth disabled on loopback — nothing else is consulted", () => {
    // Deliberately no auth/origin/host headers at all: eligibility must not
    // depend on them (defeat #2 — the nonce is independent of auth config).
    const cap = issuePromptChannel("sock-1");
    const bare = req({ [GRANT_CHANNEL_HEADER]: cap, host: "127.0.0.1:8000" });
    expect(isPromptEligible(bare)).toBe(true);
  });

  it("a header that is present but WRONG is treated exactly as absent", () => {
    issuePromptChannel("sock-1");
    const absent = req({});
    const wrong = req({ [GRANT_CHANNEL_HEADER]: "guessed" });
    expect(isPromptEligible(absent)).toBe(false);
    expect(isPromptEligible(wrong)).toBe(false);
  });

  it("is not eligible with no header at all", () => {
    issuePromptChannel("sock-1");
    expect(isPromptEligible(req({ origin: "http://127.0.0.1:8000" }))).toBe(false);
  });

  it("accepts a repeated header (array form) by its first value", () => {
    const cap = issuePromptChannel("sock-1");
    expect(isPromptEligible(req({ [GRANT_CHANNEL_HEADER]: [cap, "junk"] }))).toBe(true);
  });
});

describe("maySuspend requires eligible AND enforcing Host admission", () => {
  it("suspendable under enforce with a valid capability (test-plan #E53)", () => {
    const cap = issuePromptChannel("sock-1");
    expect(maySuspend(req({ [GRANT_CHANNEL_HEADER]: cap }), "enforce")).toBe(true);
  });

  it("NOT suspendable under report, even with a valid capability (test-plan #E51)", () => {
    const cap = issuePromptChannel("sock-1");
    expect(maySuspend(req({ [GRANT_CHANNEL_HEADER]: cap }), "report")).toBe(false);
  });

  it("NOT suspendable under enforce without a capability", () => {
    issuePromptChannel("sock-1");
    expect(maySuspend(req({}), "enforce")).toBe(false);
  });

  it("never mutates the mode it is given", () => {
    const cap = issuePromptChannel("sock-1");
    const mode = "report" as const;
    maySuspend(req({ [GRANT_CHANNEL_HEADER]: cap }), mode);
    expect(mode).toBe("report");
  });
});

describe("a request can declare itself ineligible (change: surface-denial-remedy-in-previews, D3)", () => {
  afterEach(() => installGrantCoordinator(null));

  /** The real gateway (`holdDenial`) + coordinator, a held filesystem plane. */
  function wire() {
    const sent: ServerToBrowserMessage[] = [];
    const transitions: GrantTransition[] = [];
    const planes = new AccessPlaneRegistry();
    planes.register({
      id: "filesystem",
      mode: "held",
      yoloEligible: true,
      store: "access-grants.json",
      subjectOf: (raw: string) => raw || null,
      keyOf: (x: string) => x,
      describe: () => ({ mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" }),
      grant: async () => ({ ok: true, store: "access-grants.json" }),
    });
    installGrantCoordinator(
      new GrantCoordinator({
        planes,
        broadcast: (m) => sent.push(m),
        hostGateMode: () => "enforce",
        promptEnabled: () => true,
        killSwitch: () => false,
        operatorChannels: () => 1,
        onTransition: (t) => transitions.push(t),
      }),
    );
    return { sent, transitions };
  }

  const target = (headers: Record<string, string>) => ({
    request: { raw: { on() {}, off() {} }, headers, ip: "127.0.0.1" } as never,
    reply: { raw: {} } as never,
  });
  const facts = (rawSubject: string) => ({ plane: "filesystem" as const, rawSubject, origin: "s1" });

  it("#E17 a live capability holder sending an empty header is ineligible: no dialog", async () => {
    const { sent, transitions } = wire();
    issuePromptChannel("sock-S");
    const r = await holdDenial(facts("/d"), target({ [GRANT_CHANNEL_HEADER]: "" }));
    expect(r).toEqual({ kind: "deny", reason: "ineligible" });
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(0);
    expect(transitions).toContainEqual(expect.objectContaining({ transition: "degraded", reason: "ineligible" }));
  });

  it("#E18 the declaration confers nothing: identical to sending no header", async () => {
    const withHeader = wire();
    const a = await holdDenial(facts("/d1"), target({ [GRANT_CHANNEL_HEADER]: "" }));
    const withoutHeader = wire();
    const b = await holdDenial(facts("/d2"), target({}));
    expect(a).toEqual(b);
    expect(withHeader.sent).toEqual(withoutHeader.sent);
    expect(withHeader.transitions.map((t) => [t.transition, t.reason])).toEqual(
      withoutHeader.transitions.map((t) => [t.transition, t.reason]),
    );
  });
});
