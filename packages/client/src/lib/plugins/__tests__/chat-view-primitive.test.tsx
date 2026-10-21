/**
 * E31 — `ui:chat-view` renders the live chat of a session from the shell event
 * stream; `readOnly` hides the composer. See change: decouple-plugins-from-core.
 */

import fs from "node:fs";
import path from "node:path";
import { publishSessionEvents, UiPrimitiveProvider, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedProviders } from "../../../chat-embed/EmbedProviders.js";
import { createHostPrimitiveRegistry } from "../host-primitives.js";

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const userMsg = (n: number, text: string) =>
  ({
    seq: n,
    timestamp: n,
    eventType: "message_start",
    data: { message: { role: "user", content: [{ type: "text", text }] } },
  }) as unknown as DashboardEvent;

function Plugin({ readOnly }: { readOnly?: boolean }) {
  const ChatView = useUiPrimitive(UI_PRIMITIVE_KEYS.chatView);
  return <ChatView sessionId="s1" readOnly={readOnly} />;
}

function mount(readOnly?: boolean) {
  const registry = createHostPrimitiveRegistry();
  return render(
    <UiPrimitiveProvider value={registry}>
      <EmbedProviders apiBase="">
        <PluginContextProvider>
          <div style={{ height: 400 }}>
            <Plugin readOnly={readOnly} />
          </div>
        </PluginContextProvider>
      </EmbedProviders>
    </UiPrimitiveProvider>,
  );
}

describe("ui:chat-view", () => {
  beforeEach(() => {
    __resetSessionEventsStoreForTests();
    publishSessionEvents("s1", [userMsg(1, "hello from s1"), userMsg(2, "second line")]);
  });
  afterEach(() => {
    cleanup();
    __resetSessionEventsStoreForTests();
  });

  it("renders the session's messages and a composer when not read-only", () => {
    mount(false);
    expect(screen.getByTestId("ui-chat-view")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBe(1);
    expect(document.body.textContent).toContain("hello from s1");
  });

  it("renders the same messages with NO composer when readOnly", () => {
    mount(true);
    expect(screen.queryAllByRole("textbox").length).toBe(0);
    expect(document.body.textContent).toContain("hello from s1");
  });

  it("folds events appended later (incremental) without losing earlier rows", () => {
    mount(true);
    act(() => publishSessionEvents("s1", [userMsg(3, "third line")]));
    expect(document.body.textContent).toContain("hello from s1");
    expect(document.body.textContent).toContain("third line");
  });

  /** @structural-pin the primitive must never mount a second UiPrimitiveProvider (spec: self-providing primitive) */
  it("mounts no second UiPrimitiveProvider (source pin; behaviour pinned in dashboard-plugin-runtime ui-primitive-registry.test)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../chat-view-primitive.tsx"), "utf-8");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/<UiPrimitiveProvider/);
  });
});
