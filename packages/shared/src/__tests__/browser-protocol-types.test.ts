/**
 * Type-level tests ensuring PromptBus messages are included in ServerToBrowserMessage.
 *
 * These tests prevent the regression where `case "prompt_request" as any:` etc.
 * in switch statements were dead-code eliminated by esbuild because the message
 * types were not in the ServerToBrowserMessage union.
 */
import { describe, it, expect } from "vitest";
import type {
  ServerToBrowserMessage,
  BrowserToServerMessage,
  BrowserPromptRequestMessage,
  BrowserPromptDismissMessage,
  BrowserPromptCancelMessage,
  BrowserExtUiDecoratorMessage,
  BrowserAssetRegisterMessage,
  BrowserNotifyMessage,
  RecoveryDismissMessage,
  BatchQuestion,
  BatchAnswer,
} from "../browser-protocol.js";
import type {
  ExtensionToServerMessage,
  ExtUiDecoratorMessage,
  AssetRegisterMessage,
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
