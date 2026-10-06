/**
 * Test double for `chat-embed`: the real headless `useSessionState` (the hook
 * the app relies on) + lightweight stand-ins for the render components, so the
 * heavy ChatView subtree is not loaded under jsdom. See change: add-team-plugin.
 */
import { createElement } from "react";

export async function chatEmbedMock() {
  const real = await import("@dash/hooks/useSessionState");
  const passthrough = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return {
    useSessionState: real.useSessionState,
    applySessionMessage: real.applySessionMessage,
    createSessionAccumulator: real.createSessionAccumulator,
    ChatView: ({ state }: { state: { messages?: Array<{ id?: string; role?: string; content?: unknown }> } }) =>
      createElement(
        "ol",
        { "data-testid": "chatview" },
        (state.messages ?? []).map((m, i) => createElement("li", { key: m.id ?? i }, typeof m.content === "string" ? m.content : JSON.stringify(m.content))),
      ),
    CommandInput: ({ onSend, disabled }: { onSend(t: string): void; disabled?: boolean }) =>
      createElement("button", { type: "button", "data-testid": "send", disabled, onClick: () => onSend("hello") }, "send"),
    ThemeProvider: passthrough,
    MobileProvider: passthrough,
    SessionAssetsProvider: passthrough,
    DisplayPrefsProvider: passthrough,
    UiPrimitiveProvider: passthrough,
    ApiContext: { Provider: passthrough },
  };
}
