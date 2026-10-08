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
    // Composer stand-in: honours the controlled draft + `invalid` the app passes,
    // so the pre-check tests can type and read `aria-invalid`. See change: add-team-skill-access.
    CommandInput: ({
      onSend,
      disabled,
      draft,
      onDraftChange,
      invalid,
    }: {
      onSend(t: string): void;
      disabled?: boolean;
      draft?: string;
      onDraftChange?(t: string): void;
      invalid?: boolean;
    }) =>
      createElement(
        "div",
        null,
        createElement("textarea", {
          "data-testid": "composer",
          disabled,
          "aria-invalid": invalid ? "true" : undefined,
          value: draft ?? "",
          onChange: (e: { target: { value: string } }) => onDraftChange?.(e.target.value),
          onKeyDown: (e: { key: string; preventDefault(): void; target: { value: string } }) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(e.target.value);
            }
          },
        }),
        createElement("button", { type: "button", "data-testid": "send", disabled, onClick: () => onSend(draft ?? "") }, "send"),
      ),
    ThemeProvider: passthrough,
    MobileProvider: passthrough,
    SessionAssetsProvider: passthrough,
    DisplayPrefsProvider: passthrough,
    UiPrimitiveProvider: passthrough,
    ApiContext: { Provider: passthrough },
  };
}
