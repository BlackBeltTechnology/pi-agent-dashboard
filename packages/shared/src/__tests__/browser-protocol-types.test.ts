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
  RecoveryDismissMessage,
  BatchQuestion,
  BatchAnswer,
  LoadOlderMessage,
  EventReplayMessage,
} from "../browser-protocol.js";
import type {
  ExtensionToServerMessage,
  ExtUiDecoratorMessage,
  AssetRegisterMessage,
} from "../protocol.js";
import type { DecoratorDescriptor } from "../types.js";

// Type-level assertion: if these types are NOT in the union, this will fail to compile.
type AssertExtends<T, U> = T extends U ? true : never;
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
// fix-recovery-offer-dismiss-and-phantom-reopen: recovery_dismiss must live in
// the browser→server union so the server's switch arm survives esbuild.
type _RecoveryDismissInBrowserToServerUnion = AssertExtends<RecoveryDismissMessage, BrowserToServerMessage>;
// tail-first-session-loading: load_older must live in the browser→server union
// so the server's switch arm survives esbuild.
type _LoadOlderInBrowserToServerUnion = AssertExtends<LoadOlderMessage, BrowserToServerMessage>;

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

// tail-first-session-loading: load_older + event_replay window metadata.
function extractLoadOlderBeforeSeq(msg: BrowserToServerMessage): number | null {
  switch (msg.type) {
    case "load_older":
      return msg.beforeSeq;
    default:
      return null;
  }
}

describe("tail-first-session-loading protocol additions", () => {
  it("load_older is a valid browser→server discriminant", () => {
    const msg: LoadOlderMessage = {
      type: "load_older",
      sessionId: "s1",
      beforeSeq: 4801,
    };
    expect(extractLoadOlderBeforeSeq(msg)).toBe(4801);
  });

  it("load_older round-trips through JSON with optional limit", () => {
    const msg: LoadOlderMessage = {
      type: "load_older",
      sessionId: "s1",
      beforeSeq: 100,
      limit: 50,
    };
    const parsed = JSON.parse(JSON.stringify(msg)) as LoadOlderMessage;
    expect(parsed.beforeSeq).toBe(100);
    expect(parsed.limit).toBe(50);
  });

  it("event_replay carries optional kind + hasOlder metadata", () => {
    const tail: EventReplayMessage = {
      type: "event_replay",
      sessionId: "s1",
      events: [],
      isLast: true,
      kind: "tail",
      hasOlder: true,
    };
    const older: EventReplayMessage = {
      type: "event_replay",
      sessionId: "s1",
      events: [],
      isLast: true,
      kind: "older",
      hasOlder: false,
    };
    const legacy: EventReplayMessage = {
      type: "event_replay",
      sessionId: "s1",
      events: [],
      isLast: true,
    };
    expect(tail.kind).toBe("tail");
    expect(older.hasOlder).toBe(false);
    expect(legacy.kind).toBeUndefined();
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
