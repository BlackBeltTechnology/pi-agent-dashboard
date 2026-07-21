/**
 * Integration tests for the chat-input draft + history wiring.
 *
 * Rather than bootstrapping the full `App` (which requires mocking WebSocket,
 * routing, bootstrap status, and ~20 other hooks), these tests render a
 * minimal parent harness that replicates the exact shape of App's draft
 * plumbing: a `Map<sessionId, string>` state, `readAllDrafts()` hydration on
 * mount, `writeDraft`/`deleteDraft` persistence, and controlled-`draft`
 * props passed to `CommandInput`.
 *
 * This gives genuine coverage for the two motivating bugs (draft survives
 * unmount, draft does not leak between sessions, hydration from localStorage)
 * without the fragility of a full-app integration test.
 */
import React, { useState, useEffect, useRef } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { CommandInput } from "../components/chat/CommandInput.js";
import {
  readAllDrafts,
  writeDraft,
  deleteDraft,
  DRAFT_KEY_PREFIX,
} from "../lib/state/draft-storage.js";

/**
 * Minimal App-like harness. Mirrors the patch applied to packages/client/src/App.tsx:
 * - `drafts` hydrated from localStorage once.
 * - debounced persistence (flush immediately for test speed via 0ms).
 * - controlled `draft` + `onDraftChange` wired to `CommandInput`.
 * - `chatVisible` toggle simulates navigating to Settings (unmounts CommandInput).
 * - `sessionId` toggle simulates session switch.
 */
function Harness({ initialSessionId = "A", debounceMs = 0 }: { initialSessionId?: string; debounceMs?: number }) {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => readAllDrafts());
  const prevDraftsRef = useRef<Map<string, string>>(drafts);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [chatVisible, setChatVisible] = useState(true);

  useEffect(() => {
    const prev = prevDraftsRef.current;
    const timer = setTimeout(() => {
      for (const [sid, text] of drafts) {
        if (text === "") {
          if (prev.get(sid) !== undefined) deleteDraft(sid);
          continue;
        }
        if (prev.get(sid) !== text) writeDraft(sid, text);
      }
      for (const sid of prev.keys()) {
        if (!drafts.has(sid)) deleteDraft(sid);
      }
      prevDraftsRef.current = drafts;
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [drafts, debounceMs]);

  const selectedDraft = drafts.get(sessionId) ?? "";

  return (
    <div>
      <button data-testid="toggle-chat" onClick={() => setChatVisible((v) => !v)}>
        toggle chat
      </button>
      <button data-testid="switch-A" onClick={() => setSessionId("A")}>A</button>
      <button data-testid="switch-B" onClick={() => setSessionId("B")}>B</button>
      <div data-testid="current-session">{sessionId}</div>
      {chatVisible && (
        <CommandInput
          commands={[]}
          onSend={() => {}}
          sessionId={sessionId}
          draft={selectedDraft}
          onDraftChange={(text) =>
            setDrafts((m) => {
              const existing = m.get(sessionId) ?? "";
              if (existing === text) return m;
              const next = new Map(m);
              next.set(sessionId, text);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector("textarea");
}

async function flushTimers(ms = 10) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("chat-input draft integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("draft survives unmount/remount of the chat view", async () => {
    const { container, getByTestId } = render(<Harness />);
    let textarea = getTextarea(container)!;
    fireEvent.change(textarea, { target: { value: "half-typed thought" } });
    expect(textarea.value).toBe("half-typed thought");

    // Simulate navigating away (e.g. to Settings) -- CommandInput unmounts.
    fireEvent.click(getByTestId("toggle-chat"));
    expect(getTextarea(container)).toBeNull();

    // Come back.
    fireEvent.click(getByTestId("toggle-chat"));
    textarea = getTextarea(container)!;
    expect(textarea.value).toBe("half-typed thought");
  });

  it("drafts do not leak between sessions on switch", () => {
    const { container, getByTestId } = render(<Harness initialSessionId="A" />);
    let textarea = getTextarea(container)!;
    fireEvent.change(textarea, { target: { value: "text for A" } });

    fireEvent.click(getByTestId("switch-B"));
    textarea = getTextarea(container)!;
    expect(textarea.value).toBe("");

    fireEvent.change(textarea, { target: { value: "text for B" } });
    expect(textarea.value).toBe("text for B");

    fireEvent.click(getByTestId("switch-A"));
    textarea = getTextarea(container)!;
    expect(textarea.value).toBe("text for A");

    fireEvent.click(getByTestId("switch-B"));
    textarea = getTextarea(container)!;
    expect(textarea.value).toBe("text for B");
  });

  it("hydrates drafts from localStorage on mount", () => {
    window.localStorage.setItem(DRAFT_KEY_PREFIX + "abc", "hi from storage");
    const { container } = render(<Harness initialSessionId="abc" />);
    const textarea = getTextarea(container)!;
    expect(textarea.value).toBe("hi from storage");
  });

  it("persists drafts through the debounced effect (write path)", async () => {
    const { container } = render(<Harness initialSessionId="persisting" debounceMs={0} />);
    const textarea = getTextarea(container)!;
    fireEvent.change(textarea, { target: { value: "please save me" } });
    // Allow the debounced effect to flush.
    await flushTimers(20);
    expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + "persisting")).toBe("please save me");
  });

  it("clears localStorage when the draft becomes empty", async () => {
    window.localStorage.setItem(DRAFT_KEY_PREFIX + "xyz", "to be cleared");
    const { container } = render(<Harness initialSessionId="xyz" debounceMs={0} />);
    const textarea = getTextarea(container)!;
    expect(textarea.value).toBe("to be cleared");
    fireEvent.change(textarea, { target: { value: "" } });
    await flushTimers(20);
    expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + "xyz")).toBeNull();
  });
});
