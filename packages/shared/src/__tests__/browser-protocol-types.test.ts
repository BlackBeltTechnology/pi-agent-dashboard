/**
 * Type-level tests ensuring PromptBus messages are included in ServerToBrowserMessage.
 *
 * These tests prevent the regression where `case "prompt_request" as any:` etc.
 * in switch statements were dead-code eliminated by esbuild because the message
 * types were not in the ServerToBrowserMessage union.
 */
import { describe, expect, it } from "vitest";
import type {
  BatchAnswer,
  BatchQuestion,
  BrowserAssetRegisterMessage,
  BrowserExtUiDecoratorMessage,
  BrowserNotifyMessage,
  BrowserPromptCancelMessage,
  BrowserPromptDismissMessage,
  BrowserPromptRequestMessage,
  BrowserRelayFrameMessage,
  BrowserRelayInputMessage,
  BrowserRelayStatusMessage,
  BrowserRelaySubscribeMessage,
  BrowserRelayUnsubscribeMessage,
  BrowserToServerMessage,
  OpenSpecGetMessage,
  OpenSpecGetResultMessage,
  RecoveryDismissMessage,
  ServerToBrowserMessage,
  SessionsPageMessage,
  SessionsPageResultMessage,
  SessionsSnapshotMessage,
} from "../browser-protocol.js";
import type {
  AssetRegisterMessage,
  ExtensionToServerMessage,
  ExtUiDecoratorMessage,
  NotifyMessage,
} from "../protocol.js";
import type { DecoratorDescriptor } from "../types.js";

// Type-level assertion: if these types are NOT in the union, this will fail to
// compile. `AssertTrue` is what makes it bite — a bare `T extends U ? true :
// never` alias is legal when it resolves to `never`, so the alias alone asserts
// nothing. See change: split-notify-from-prompt-request.
type AssertTrue<T extends true> = T;
type AssertExtends<T, U> = AssertTrue<T extends U ? true : never>;
type _PromptRequestInUnion = AssertExtends<BrowserPromptRequestMessage, ServerToBrowserMessage>;
type _PromptDismissInUnion = AssertExtends<BrowserPromptDismissMessage, ServerToBrowserMessage>;
type _PromptCancelInUnion = AssertExtends<BrowserPromptCancelMessage, ServerToBrowserMessage>;
// Phase-2 (add-extension-ui-decorations): ext_ui_decorator must be a member of
// BOTH the extension→server union and the server→browser union, otherwise
// esbuild strips the switch arms in production builds.
type _ExtUiDecoratorInExtensionUnion = AssertExtends<ExtUiDecoratorMessage, ExtensionToServerMessage>;
type _ExtUiDecoratorInBrowserUnion   = AssertExtends<BrowserExtUiDecoratorMessage, ServerToBrowserMessage>;
// chat-markdown-local-images-and-math: asset_register must live in BOTH the
// extension→server union (so the server's switch arm survives esbuild) AND
// the server→browser union (so the client's reducer arm survives esbuild).
type _AssetRegisterInExtensionUnion = AssertExtends<AssetRegisterMessage, ExtensionToServerMessage>;
type _AssetRegisterInBrowserUnion   = AssertExtends<BrowserAssetRegisterMessage, ServerToBrowserMessage>;
// split-notify-from-prompt-request: notify must live in BOTH unions so the
// server's dispatch arm and the client's reducer arm survive esbuild.
type _NotifyInExtensionUnion = AssertExtends<NotifyMessage, ExtensionToServerMessage>;
type _NotifyInBrowserUnion   = AssertExtends<BrowserNotifyMessage, ServerToBrowserMessage>;
// fix-recovery-offer-dismiss-and-phantom-reopen: recovery_dismiss must live in
// the browser→server union so the server's switch arm survives esbuild.
type _RecoveryDismissInBrowserToServerUnion = AssertExtends<RecoveryDismissMessage, BrowserToServerMessage>;
// add-browser-relay (test-plan #E29): the three viewer actions must be in the
// browser→server union and the two server pushes in the server→browser union,
// or esbuild strips the switch arms in production builds.
type _RelaySubscribeInBrowserToServer = AssertExtends<BrowserRelaySubscribeMessage, BrowserToServerMessage>;
type _RelayUnsubscribeInBrowserToServer = AssertExtends<BrowserRelayUnsubscribeMessage, BrowserToServerMessage>;
type _RelayInputInBrowserToServer = AssertExtends<BrowserRelayInputMessage, BrowserToServerMessage>;
type _RelayFrameInServerToBrowser = AssertExtends<BrowserRelayFrameMessage, ServerToBrowserMessage>;
type _RelayStatusInServerToBrowser = AssertExtends<BrowserRelayStatusMessage, ServerToBrowserMessage>;
// Frame/status must NEVER carry the relay guid or a profile token — a
// type-level `never` check makes adding one a compile error (spec F2).
type _FrameHasNoSecretKeys = AssertTrue<
  Extract<keyof BrowserRelayFrameMessage, "guid" | "token"> extends never ? true : never
>;
type _StatusHasNoSecretKeys = AssertTrue<
  Extract<keyof BrowserRelayStatusMessage, "guid" | "token"> extends never ? true : never
>;
type _FrameHasNoGuidField = AssertTrue<
  "guid" extends keyof BrowserRelayFrameMessage ? never : true
>;
type _StatusHasNoTokenField = AssertTrue<
  "token" extends keyof BrowserRelayStatusMessage ? never : true
>;

// Runtime verification that the type discriminants are reachable in a switch
function extractPromptType(msg: ServerToBrowserMessage): string | null {
  switch (msg.type) {
    case "prompt_request": return msg.promptId;
    case "prompt_dismiss": return msg.promptId;
    case "prompt_cancel": return msg.promptId;
    default: return null;
  }
}

describe("ServerToBrowserMessage includes PromptBus messages", () => {
  it("prompt_request is a valid discriminant", () => {
    const msg: BrowserPromptRequestMessage = {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "p1",
      prompt: { question: "Q?", type: "input" },
      component: { type: "generic-dialog", props: {} },
      placement: "inline",
    };
    expect(extractPromptType(msg)).toBe("p1");
  });

  it("prompt_dismiss is a valid discriminant", () => {
    const msg: BrowserPromptDismissMessage = {
      type: "prompt_dismiss",
      sessionId: "s1",
      promptId: "p1",
    };
    expect(extractPromptType(msg)).toBe("p1");
  });

  it("prompt_cancel is a valid discriminant", () => {
    const msg: BrowserPromptCancelMessage = {
      type: "prompt_cancel",
      sessionId: "s1",
      promptId: "p1",
    };
    expect(extractPromptType(msg)).toBe("p1");
  });

  it("batch prompt_request carries questions[] in metadata", () => {
    const questions: BatchQuestion[] = [
      { method: "input", title: "Project name" },
      { method: "select", title: "Language", options: ["TS", "Go"] },
      { method: "multiselect", title: "Tooling", options: ["ESLint", "Vitest"] },
    ];
    const msg: BrowserPromptRequestMessage = {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "p1",
      prompt: { question: "Project setup", type: "batch", metadata: { questions } },
      component: { type: "generic-dialog", props: {} },
      placement: "inline",
    };
    expect(extractPromptType(msg)).toBe("p1");
    expect((msg.prompt.metadata!.questions as BatchQuestion[]).length).toBe(3);
  });

  it("BatchAnswer covers confirm/value/values shapes", () => {
    const answers: BatchAnswer[] = [
      { value: "pi-dashboard" },
      { value: "TS" },
      { values: ["ESLint", "Vitest"] },
      { confirmed: true },
    ];
    expect(answers).toHaveLength(4);
  });
});

// split-notify-from-prompt-request: notify switch-arm reachability (test-plan #E10).
function extractNotifyId(msg: ServerToBrowserMessage): string | null {
  switch (msg.type) {
    case "notify":
      return msg.notifyId;
    default:
      return null;
  }
}

describe("notify is a member of both protocol unions", () => {
  it("server→browser notify is a statically known discriminant", () => {
    const msg: BrowserNotifyMessage = {
      type: "notify",
      sessionId: "s1",
      notifyId: "n1",
      message: "hello",
      level: "info",
    };
    expect(extractNotifyId(msg)).toBe("n1");
  });

  it("extension→server notify needs no cast at the send site", () => {
    // No `as any`: the object literal is assignable to the union directly.
    const msg: ExtensionToServerMessage = {
      type: "notify",
      sessionId: "s1",
      notifyId: "n1",
      message: "hello",
      level: "success",
    };
    expect(msg.type).toBe("notify");
  });

  it("carries no promptId / component / placement", () => {
    const msg: NotifyMessage = {
      type: "notify",
      sessionId: "s1",
      notifyId: "n1",
      message: "hello",
    };
    const parsed = JSON.parse(JSON.stringify(msg));
    expect(parsed).toEqual({ type: "notify", sessionId: "s1", notifyId: "n1", message: "hello" });
    expect("level" in parsed).toBe(false);
  });
});

// Phase-2: ext_ui_decorator switch-arm reachability.
function extractDecoratorKey(msg: ServerToBrowserMessage): string | null {
  switch (msg.type) {
    case "ext_ui_decorator":
      return `${msg.descriptor.kind}:${msg.descriptor.namespace}:${msg.descriptor.id}`;
    default:
      return null;
  }
}

describe("ext_ui_decorator is a member of both protocol unions", () => {
  const sample: DecoratorDescriptor = {
    kind: "footer-segment",
    namespace: "judo",
    id: "model-state",
    payload: { text: "3 mut" },
  };

  it("server→browser ext_ui_decorator is a valid discriminant", () => {
    const msg: BrowserExtUiDecoratorMessage = {
      type: "ext_ui_decorator",
      sessionId: "s1",
      descriptor: sample,
    };
    expect(extractDecoratorKey(msg)).toBe("footer-segment:judo:model-state");
  });

  it("removed flag round-trips through the union", () => {
    const msg: BrowserExtUiDecoratorMessage = {
      type: "ext_ui_decorator",
      sessionId: "s1",
      descriptor: sample,
      removed: true,
    };
    expect(extractDecoratorKey(msg)).toBe("footer-segment:judo:model-state");
    // Round-trip via JSON to confirm `removed` survives serialization.
    const parsed = JSON.parse(JSON.stringify(msg)) as BrowserExtUiDecoratorMessage;
    expect(parsed.removed).toBe(true);
  });

  it("extension→server ext_ui_decorator carries the same shape", () => {
    const msg: ExtUiDecoratorMessage = {
      type: "ext_ui_decorator",
      sessionId: "s1",
      descriptor: sample,
    };
    expect(msg.type).toBe("ext_ui_decorator");
    expect(msg.descriptor.kind).toBe("footer-segment");
  });
});

// fix-recovery-offer-dismiss-and-phantom-reopen: recovery_dismiss round-trip.
function extractDismissIds(msg: BrowserToServerMessage): string[] | null {
  switch (msg.type) {
    case "recovery_dismiss":
      return msg.sessionIds;
    default:
      return null;
  }
}

describe("recovery_dismiss is a member of the browser→server union", () => {
  it("is a valid discriminant carrying sessionIds", () => {
    const msg: RecoveryDismissMessage = {
      type: "recovery_dismiss",
      sessionIds: ["s1", "s2"],
    };
    expect(extractDismissIds(msg)).toEqual(["s1", "s2"]);
  });

  it("round-trips through JSON serialization", () => {
    const msg: RecoveryDismissMessage = {
      type: "recovery_dismiss",
      sessionIds: ["abc", "def"],
    };
    const parsed = JSON.parse(JSON.stringify(msg)) as RecoveryDismissMessage;
    expect(parsed.type).toBe("recovery_dismiss");
    expect(parsed.sessionIds).toEqual(["abc", "def"]);
  });
});

// chat-markdown-local-images-and-math: asset_register switch-arm reachability.
function extractAssetHash(msg: ServerToBrowserMessage): string | null {
  switch (msg.type) {
    case "asset_register":
      return msg.hash;
    default:
      return null;
  }
}

describe("asset_register is a member of both protocol unions", () => {
  it("server→browser asset_register is a valid discriminant", () => {
    const msg: BrowserAssetRegisterMessage = {
      type: "asset_register",
      sessionId: "s1",
      hash: "abc1234567890123",
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
    };
    expect(extractAssetHash(msg)).toBe("abc1234567890123");
  });

  it("extension→server asset_register carries the same shape", () => {
    const msg: AssetRegisterMessage = {
      type: "asset_register",
      sessionId: "s1",
      hash: "abc1234567890123",
      mimeType: "image/svg+xml",
      data: "PHN2Zy8+",
    };
    expect(msg.type).toBe("asset_register");
    expect(msg.hash).toBe("abc1234567890123");
    expect(msg.mimeType).toBe("image/svg+xml");
  });
});

// fix-connect-snapshot-frame-loss: the four new messages must be members of the
// unions (else esbuild strips the server dispatch / client reducer arms) and the
// snapshot must carry `endedTotals`.
type _OpenSpecGetInUnion = AssertExtends<OpenSpecGetMessage, BrowserToServerMessage>;
type _SessionsPageInUnion = AssertExtends<SessionsPageMessage, BrowserToServerMessage>;
type _OpenSpecGetResultInUnion = AssertExtends<OpenSpecGetResultMessage, ServerToBrowserMessage>;
type _SessionsPageResultInUnion = AssertExtends<SessionsPageResultMessage, ServerToBrowserMessage>;

function extractOpenSpecGetRequestId(msg: BrowserToServerMessage): string | null {
  switch (msg.type) {
    case "openspec_get": return msg.requestId;
    default: return null;
  }
}
function extractSessionsPageOffset(msg: BrowserToServerMessage): number | null {
  switch (msg.type) {
    case "sessions_page": return msg.offset;
    default: return null;
  }
}
function extractOpenSpecGetResultFinal(msg: ServerToBrowserMessage): boolean | null {
  switch (msg.type) {
    case "openspec_get_result": return msg.final;
    default: return null;
  }
}
function extractSessionsSnapshotEndedTotals(msg: ServerToBrowserMessage): Record<string, number> | null {
  switch (msg.type) {
    case "sessions_snapshot": return msg.endedTotals;
    default: return null;
  }
}

describe("fix-connect-snapshot-frame-loss protocol types (E28)", () => {
  it("openspec_get narrows with requestId + cwd", () => {
    const msg: OpenSpecGetMessage = { type: "openspec_get", requestId: "r1", cwd: "/a" };
    expect(extractOpenSpecGetRequestId(msg)).toBe("r1");
  });

  it("sessions_page narrows with cwd + offset", () => {
    const msg: SessionsPageMessage = { type: "sessions_page", cwd: "/a", offset: 50 };
    expect(extractSessionsPageOffset(msg)).toBe(50);
  });

  it("openspec_get_result narrows with data + final", () => {
    const msg: OpenSpecGetResultMessage = {
      type: "openspec_get_result",
      requestId: "r1",
      cwd: "/a",
      data: { initialized: false, pending: true, changes: [] },
      final: false,
    };
    expect(extractOpenSpecGetResultFinal(msg)).toBe(false);
  });

  it("sessions_snapshot narrows with endedTotals", () => {
    const msg: SessionsSnapshotMessage = {
      type: "sessions_snapshot",
      sessions: [],
      orders: {},
      endedTotals: { "/a": 3 },
    };
    expect(extractSessionsSnapshotEndedTotals(msg)).toEqual({ "/a": 3 });
  });

  it("rejects a missing requestId / offset at compile time", () => {
    // @ts-expect-error requestId is required on openspec_get
    const noRequestId: OpenSpecGetMessage = { type: "openspec_get", cwd: "/a" };
    // @ts-expect-error offset is required on sessions_page
    const noOffset: SessionsPageMessage = { type: "sessions_page", cwd: "/a" };
    expect(noRequestId.cwd).toBe("/a");
    expect(noOffset.cwd).toBe("/a");
  });
});

// add-browser-relay (test-plan #E29): the relay viewer payloads are broadcast /
// per-socket wire messages, so a leaked secret would be a real exfiltration
// path, not a type nicety. Serialize representative payloads and assert the
// guid and token strings never appear.
describe("browser relay payloads never carry secrets (E29)", () => {
  const GUID = "0123456789abcdef0123456789abcdef";
  const TOKEN = "s3cr3t-pairing-token";

  it("serialized frame holds no guid or token", () => {
    const frame: BrowserRelayFrameMessage = {
      type: "browser_relay_frame",
      instanceId: "inst-1",
      tabId: 7,
      jpegBase64: "AAAA",
      metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: 1 },
    };
    const json = JSON.stringify(frame);
    expect(json).not.toContain(GUID);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("guid");
    expect(json).not.toContain("token");
  });

  it("serialized status holds no guid or token", () => {
    const status: BrowserRelayStatusMessage = {
      type: "browser_relay_status",
      auditSeq: 4,
      instances: [
        {
          instanceId: "inst-1",
          profileDirectory: "Default",
          state: "connected",
          tabs: [{ tabId: 7, title: "t", url: "https://a.test/", state: "live" }],
        },
      ],
    };
    const json = JSON.stringify(status);
    expect(json).not.toContain(GUID);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("guid");
    expect(json).not.toContain("token");
  });
});
