/**
 * Tests for the UI primitive registry — registration, lookup, error modes.
 *
 * Companion runtime to slot-registry; covers the orthogonal "shell → plugin"
 * direction (plugins look up dashboard-provided primitives by key) vs slots'
 * "plugin → shell" direction.
 *
 * See change: add-plugin-ui-primitive-registry.
 */

import {
  UI_PRIMITIVE_KEYS,
  type UiPrimitiveMap,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { render, renderHook } from "@testing-library/react";
import type React from "react";
import { createContext, useContext } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
  useUiPrimitive,
  useUiPrimitiveOrNull,
} from "../index.js";
import { withUiPrimitiveProvider } from "../test-support/withUiPrimitiveProvider.js";

// Counts every `<UiPrimitiveProvider>` render (pass-through): test-plan #X3 (b) asserts a
// self-providing primitive mounts none of its own.
const providerRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../ui-primitive-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui-primitive-context.js")>();
  return {
    ...actual,
    UiPrimitiveProvider: (props: Parameters<typeof actual.UiPrimitiveProvider>[0]) => {
      providerRenders.n++;
      return actual.UiPrimitiveProvider(props);
    },
  };
});

// Minimal stub primitives used as registration impls in tests.
const StubMarkdown: UiPrimitiveMap["ui:markdown-content"] = ({ content }) => (
  <div data-testid="stub-md">{content}</div>
);
const StubAgentCard: UiPrimitiveMap["ui:agent-card"] = ({ name, status }) => (
  <div data-testid="stub-card">{name}-{status}</div>
);
const stubFormatTokens: UiPrimitiveMap["ui:format-tokens"] = (n) => `${n}t`;

describe("UI primitive registry", () => {
  describe("createUiPrimitiveRegistry", () => {
    it("creates an empty registry", () => {
      const reg = createUiPrimitiveRegistry();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      expect(result.current).toBeNull();
    });
  });

  describe("registerUiPrimitive", () => {
    it("registers an impl that the strict hook can retrieve", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      expect(result.current).toBe(StubMarkdown);
    });

    it("registers a function-typed primitive (format-tokens)", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.formatTokens, stubFormatTokens);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens),
        { wrapper },
      );
      expect(result.current(42)).toBe("42t");
    });

    it("throws on double-registration of the same key", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown);
      expect(() =>
        registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown),
      ).toThrow(/"ui:markdown-content" is already registered/);
    });

    it("retains the first registration after a double-registration throw (first-write-wins)", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown);
      const Stub2: UiPrimitiveMap["ui:markdown-content"] = () => <div>different</div>;
      expect(() => registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, Stub2)).toThrow();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      expect(result.current).toBe(StubMarkdown);
    });

    it("registers different keys independently", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown);
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.agentCard, StubAgentCard);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result: md } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      const { result: card } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard),
        { wrapper },
      );
      expect(md.current).toBe(StubMarkdown);
      expect(card.current).toBe(StubAgentCard);
    });

    // See change: unify-dialog-system — additive `ui:dialog` key.
    it("registers and retrieves the additive ui:dialog primitive", () => {
      expect(UI_PRIMITIVE_KEYS.dialog).toBe("ui:dialog");
      const StubDialog = (({ children }) => (
        <div data-testid="stub-dialog">{children}</div>
      )) as UiPrimitiveMap["ui:dialog"];
      StubDialog.Footer = ({ children }) => <div>{children}</div>;
      StubDialog.Cancel = ({ onClick }) => <button onClick={onClick} />;
      StubDialog.Action = ({ onClick, children }) => (
        <button onClick={onClick}>{children}</button>
      );
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.dialog, StubDialog);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitive(UI_PRIMITIVE_KEYS.dialog),
        { wrapper },
      );
      expect(result.current).toBe(StubDialog);
    });
  });

  describe("useUiPrimitive (strict)", () => {
    it("throws outside a UiPrimitiveProvider", () => {
      // No provider in the tree — silence React's error log via render's defaults.
      const captured: unknown[] = [];
      try {
        renderHook(() => useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent));
      } catch (e) {
        captured.push(e);
      }
      // renderHook surfaces the error via console; testing via expect+throw alone is brittle.
      // Test directly by using a wrapper that omits the provider.
      const Bad = () => {
        useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
        return null;
      };
      // Capture console.error calls so the test output isn't noisy.
      const origError = console.error;
      console.error = () => {};
      try {
        expect(() => render(<Bad />)).toThrow(
          /useUiPrimitive must be called inside <UiPrimitiveProvider>/,
        );
      } finally {
        console.error = origError;
      }
    });

    it("throws on missing key with a clear message naming the key", () => {
      const reg = createUiPrimitiveRegistry();
      // markdownContent is NOT registered.

      const Bad = () => {
        useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
        return null;
      };
      const origError = console.error;
      console.error = () => {};
      try {
        expect(() =>
          render(
            <UiPrimitiveProvider value={reg}>
              <Bad />
            </UiPrimitiveProvider>,
          ),
        ).toThrow(/UI primitive "ui:markdown-content" is not registered/);
      } finally {
        console.error = origError;
      }
    });
  });

  describe("useUiPrimitiveOrNull (soft)", () => {
    it("throws outside a UiPrimitiveProvider (provider is required, not the registration)", () => {
      const Bad = () => {
        useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.markdownContent);
        return null;
      };
      const origError = console.error;
      console.error = () => {};
      try {
        expect(() => render(<Bad />)).toThrow(
          /useUiPrimitive must be called inside <UiPrimitiveProvider>/,
        );
      } finally {
        console.error = origError;
      }
    });

    it("returns null on missing key (no throw)", () => {
      const reg = createUiPrimitiveRegistry();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      expect(result.current).toBeNull();
    });

    it("returns the impl when registered", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, StubMarkdown);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UiPrimitiveProvider value={reg}>{children}</UiPrimitiveProvider>
      );
      const { result } = renderHook(
        () => useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.markdownContent),
        { wrapper },
      );
      expect(result.current).toBe(StubMarkdown);
    });
  });

  describe("withUiPrimitiveProvider test helper", () => {
    it("wraps children in a provider populated with the supplied impls", () => {
      const Consumer = () => {
        const fn = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
        return <span data-testid="helper-out">{fn(99)}</span>;
      };
      const { getByTestId } = render(
        withUiPrimitiveProvider(
          { [UI_PRIMITIVE_KEYS.formatTokens]: stubFormatTokens },
          <Consumer />,
        ),
      );
      expect(getByTestId("helper-out").textContent).toBe("99t");
    });

    it("throws via strict hook for keys NOT supplied (matches prod semantics)", () => {
      const Consumer = () => {
        useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
        return null;
      };
      const origError = console.error;
      console.error = () => {};
      try {
        expect(() =>
          render(withUiPrimitiveProvider({}, <Consumer />)),
        ).toThrow(/UI primitive "ui:markdown-content" is not registered/);
      } finally {
        console.error = origError;
      }
    });
  });

  describe("multiple consumers in the same tree", () => {
    it("all see the same registry", () => {
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.formatTokens, stubFormatTokens);

      const ConsumerA = () => {
        const fn = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
        return <span data-testid="a">{fn(1)}</span>;
      };
      const ConsumerB = () => {
        const fn = useUiPrimitive(UI_PRIMITIVE_KEYS.formatTokens);
        return <span data-testid="b">{fn(2)}</span>;
      };
      const { getByTestId } = render(
        <UiPrimitiveProvider value={reg}>
          <ConsumerA />
          <ConsumerB />
        </UiPrimitiveProvider>,
      );
      expect(getByTestId("a").textContent).toBe("1t");
      expect(getByTestId("b").textContent).toBe("2t");
    });
  });

  // test-plan #X3 (b); change: decouple-plugins-from-core (D8).
  describe("self-providing primitive (ui:chat-view shape)", () => {
    it("mounts its own nested providers but resolves primitives from the OUTER registry, with one UiPrimitiveProvider", () => {
      const ChatSessionContext = createContext<string | null>(null);
      const mdSpy = vi.fn();
      const SpyMarkdown: UiPrimitiveMap["ui:markdown-content"] = ({ content }) => {
        mdSpy(content);
        return <div data-testid="outer-md">{content}</div>;
      };
      // The chat view's inner message list asks the registry for markdown.
      const Inner = () => {
        const Markdown = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
        const session = useContext(ChatSessionContext);
        return <Markdown content={`msg of ${session}`} />;
      };
      // Self-providing: mounts a chat/session provider, NOT a UiPrimitiveProvider.
      const SelfProvidingChatView: UiPrimitiveMap["ui:chat-view"] = ({ sessionId }) => (
        <ChatSessionContext.Provider value={sessionId}>
          <Inner />
        </ChatSessionContext.Provider>
      );
      const reg = createUiPrimitiveRegistry();
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.markdownContent, SpyMarkdown);
      registerUiPrimitive(reg, UI_PRIMITIVE_KEYS.chatView, SelfProvidingChatView);
      // A plugin claim: reads the chat view through the registry, like any primitive.
      const PluginClaim = () => {
        const ChatView = useUiPrimitive(UI_PRIMITIVE_KEYS.chatView);
        return <ChatView sessionId="s1" />;
      };
      providerRenders.n = 0;
      const { getByTestId } = render(
        <UiPrimitiveProvider value={reg}>
          <PluginClaim />
        </UiPrimitiveProvider>,
      );
      expect(getByTestId("outer-md").textContent).toBe("msg of s1");
      expect(mdSpy).toHaveBeenCalledWith("msg of s1");
      expect(providerRenders.n).toBe(1);
    });
  });
});
