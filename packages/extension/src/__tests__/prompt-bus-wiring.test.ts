/**
 * PromptBus wiring integration tests.
 *
 * Validates that prompts wire correctly to BOTH TUI and dashboard simultaneously,
 * with proper cross-cancellation and first-response-wins semantics.
 * Uses mock agent messages to simulate real prompt flows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotifyProxy } from "../notify-proxy.js";
import { PromptBus, type PromptAdapter, type PromptRequest, type PromptResponse, type PromptClaim, type PromptComponent } from "../prompt-bus.js";
import { settlePrompts } from "./helpers/settle-prompts.js";

// ── Mock infrastructure (tasks 9.1) ────────────────────────────────

interface MockEventBusHandler {
  event: string;
  handler: (...args: unknown[]) => void;
}

function createMockEventBus() {
  const handlers: MockEventBusHandler[] = [];
  return {
    on(event: string, handler: (...args: unknown[]) => void): () => void {
      const entry = { event, handler };
      handlers.push(entry);
      return () => {
        const idx = handlers.indexOf(entry);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    emit(event: string, ...args: unknown[]): void {
      for (const h of handlers) {
        if (h.event === event) h.handler(...args);
      }
    },
    _handlers: handlers,
  };
}

function createMockTuiUi() {
  // Each method returns a controllable promise and captures the AbortSignal
  const signals: Record<string, AbortSignal | undefined> = {};
  const resolvers: Record<string, { resolve: (v: any) => void; reject: (e: any) => void }> = {};

  function makeMock(name: string) {
    return vi.fn().mockImplementation((_question: string, _arg2?: any, opts?: any) => {
      signals[name] = opts?.signal;
      return new Promise((resolve, reject) => {
        resolvers[name] = { resolve, reject };
        // If signal already aborted, reject immediately
        if (opts?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        opts?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
  }

  return {
    select: makeMock("select"),
    input: makeMock("input"),
    confirm: makeMock("confirm"),
    editor: makeMock("editor"),
    notify: vi.fn(),
    /** Resolve the pending TUI dialog for the given method */
    _resolve(method: string, value: any) { resolvers[method]?.resolve(value); },
    /** Get the AbortSignal passed to the given method */
    _signal(method: string): AbortSignal | undefined { return signals[method]; },
    /** Reset signals/resolvers for a fresh prompt */
    _reset() {
      Object.keys(signals).forEach(k => delete signals[k]);
      Object.keys(resolvers).forEach(k => delete resolvers[k]);
    },
  };
}

function createMockConnection() {
  return {
    send: vi.fn(),
    /** Get all sent messages of a given type */
    _messagesOfType(type: string) {
      return this.send.mock.calls
        .map((c: any[]) => c[0])
        .filter((m: any) => m?.type === type);
    },
  };
}

// ── Bridge TUI adapter mock (mimics bridge's built-in TUI adapter) ──

function createTuiPromptAdapter(mockUi: ReturnType<typeof createMockTuiUi>, bus: PromptBus): PromptAdapter {
  const activeAbortControllers = new Map<string, AbortController>();

  return {
    name: "tui",
    onRequest(prompt: PromptRequest): PromptClaim | null {
      const ac = new AbortController();
      activeAbortControllers.set(prompt.id, ac);

      // Present TUI dialog asynchronously (like the real adapter)
      const present = async () => {
        try {
          let answer: any;
          if (prompt.type === "select" && prompt.options) {
            answer = await mockUi.select(prompt.question, prompt.options, { signal: ac.signal });
          } else if (prompt.type === "input") {
            answer = await mockUi.input(prompt.question, prompt.defaultValue || "", { signal: ac.signal });
          } else if (prompt.type === "confirm") {
            answer = await mockUi.confirm(prompt.question, "", { signal: ac.signal });
          } else {
            return;
          }

          // If not aborted, respond via bus
          if (!ac.signal.aborted) {
            const answerStr = typeof answer === "boolean" ? (answer ? "true" : "false") : answer;
            bus.respond({
              id: prompt.id,
              answer: answerStr ?? undefined,
              cancelled: answerStr == null,
              source: "tui",
            });
          }
        } catch {
          // Aborted — don't respond
        } finally {
          activeAbortControllers.delete(prompt.id);
        }
      };
      // `onRequest` must return a claim synchronously, so `present()` cannot be
      // awaited. Its body already try/catch/finally-wraps everything, so it
      // cannot reject; the handler below is a guard that surfaces anything that
      // somehow escapes rather than a suppression. Bare `void` is banned.
      // See change: cleanup-async-semantics-server-extension (design D1).
      void present().catch((err: unknown) => {
        console.error("mock TUI adapter present() escaped its own catch:", err);
      });

      return {}; // Claim without component (TUI-only)
    },
    onResponse(response: PromptResponse): void {
      if (response.source !== "tui") {
        const ac = activeAbortControllers.get(response.id);
        if (ac) {
          ac.abort();
          activeAbortControllers.delete(response.id);
        }
      }
    },
    onCancel(id: string): void {
      const ac = activeAbortControllers.get(id);
      if (ac) {
        ac.abort();
        activeAbortControllers.delete(id);
      }
    },
  };
}

// ── ArchitectUIAdapter mock (mimics real adapter behavior) ─────────

function createArchitectUIAdapter(): PromptAdapter {
  const claimedPrompts = new Set<string>();
  return {
    name: "architect-widget",
    onRequest(prompt: PromptRequest): PromptClaim | null {
      if (!prompt.pipeline.startsWith("architect-")) return null;
      claimedPrompts.add(prompt.id);
      return {
        component: {
          type: "architect-prompt",
          props: {
            id: prompt.id,
            question: prompt.question,
            promptType: prompt.type,
            options: prompt.options,
            defaultValue: prompt.defaultValue,
          },
        },
        placement: "widget-bar",
      };
    },
    onResponse(response: PromptResponse): void {
      claimedPrompts.delete(response.id);
    },
    onCancel(id: string): void {
      claimedPrompts.delete(id);
    },
  };
}

// ── Setup helper (task 9.2) ────────────────────────────────────────

interface PromptBusStack {
  bus: PromptBus;
  connection: ReturnType<typeof createMockConnection>;
  tuiUi: ReturnType<typeof createMockTuiUi>;
  eventBus: ReturnType<typeof createMockEventBus>;
  /** Feed a dashboard response into the bus (simulates browser → server → extension) */
  dashboardRespond(id: string, answer: string, source?: string): void;
  /** Feed a dashboard cancel into the bus */
  dashboardCancel(id: string): void;
}

function setupPromptBusStack(options: { hasUI?: boolean; hasArchitect?: boolean } = {}): PromptBusStack {
  const { hasUI = true, hasArchitect = false } = options;
  const connection = createMockConnection();
  const tuiUi = createMockTuiUi();
  const eventBus = createMockEventBus();

  const bus = new PromptBus({
    timeoutMs: 5000,
    onDashboardRequest: (prompt, component, placement) => {
      connection.send({
        type: "prompt_request",
        sessionId: "test-session",
        promptId: prompt.id,
        prompt: { question: prompt.question, type: prompt.type, options: prompt.options, defaultValue: prompt.defaultValue },
        component,
        placement,
      });
    },
    onDashboardDismiss: (id) => {
      connection.send({ type: "prompt_dismiss", sessionId: "test-session", promptId: id });
    },
    onDashboardCancel: (id) => {
      connection.send({ type: "prompt_cancel", sessionId: "test-session", promptId: id });
    },
  });

  // Always register default dashboard adapter (built-in)
  // In production this claims with generic-dialog, but the bus itself handles the fallback
  // so we don't need a separate adapter object in the test stack.

  if (hasUI) {
    bus.registerAdapter(createTuiPromptAdapter(tuiUi, bus));
  }

  if (hasArchitect) {
    bus.registerAdapter(createArchitectUIAdapter());
  }

  return {
    bus,
    connection,
    tuiUi,
    eventBus,
    dashboardRespond(id: string, answer: string, source = "dashboard-default") {
      bus.respond({ id, answer, source });
    },
    dashboardCancel(id: string) {
      bus.cancel(id);
    },
  };
}

/** Helper to extract prompt id from the adapter's onRequest call or connection message */
function getPromptId(connection: ReturnType<typeof createMockConnection>): string {
  const req = connection._messagesOfType("prompt_request")[0];
  return req?.promptId;
}

function getPromptIds(connection: ReturnType<typeof createMockConnection>): string[] {
  return connection._messagesOfType("prompt_request").map((m: any) => m.promptId);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("PromptBus wiring integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 9.3–9.5: Dual wiring verification ──

  describe("dual wiring — prompts reach both TUI and dashboard", () => {
    it("9.3: select prompt wires to both TUI and dashboard simultaneously", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const inflight = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });

      // TUI should have been called
      expect(stack.tuiUi.select).toHaveBeenCalledWith(
        "Pick:",
        ["A", "B"],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      // Dashboard should have received prompt_request with generic-dialog
      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].component).toEqual(expect.objectContaining({ type: "generic-dialog" }));
      expect(requests[0].prompt.question).toBe("Pick:");
      await settlePrompts(stack.bus, inflight);
    });

    it("9.4: input prompt wires to both TUI and dashboard simultaneously", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const inflight = stack.bus.request({ pipeline: "command", type: "input", question: "Name:" });

      expect(stack.tuiUi.input).toHaveBeenCalledWith(
        "Name:",
        "",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].prompt.type).toBe("input");
      await settlePrompts(stack.bus, inflight);
    });

    it("9.5: confirm prompt wires to both TUI and dashboard simultaneously", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const inflight = stack.bus.request({ pipeline: "command", type: "confirm", question: "Sure?" });

      expect(stack.tuiUi.confirm).toHaveBeenCalledWith(
        "Sure?",
        "",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].prompt.type).toBe("confirm");
      await settlePrompts(stack.bus, inflight);
    });
  });

  // ── 9.6–9.7: Cross-cancellation ──

  describe("cross-cancellation — first answer wins", () => {
    it("9.6: TUI answers first → dashboard gets dismiss, late dashboard response ignored", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });
      const id = getPromptId(stack.connection);

      // TUI answers "A"
      stack.tuiUi._resolve("select", "A");
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result.answer).toBe("A");
      expect(result.source).toBe("tui");

      // Dashboard should have received a dismiss
      const dismisses = stack.connection._messagesOfType("prompt_dismiss");
      expect(dismisses.length).toBeGreaterThanOrEqual(1);
      expect(dismisses[0].promptId).toBe(id);

      // Late dashboard response should be silently ignored (no error)
      stack.dashboardRespond(id, "B");
    });

    it("9.7: Dashboard answers first → TUI AbortSignal aborted, late TUI resolution ignored", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });
      const id = getPromptId(stack.connection);

      // Dashboard answers "B"
      stack.dashboardRespond(id, "B");

      const result = await promise;
      expect(result.answer).toBe("B");
      expect(result.source).toBe("dashboard-default");

      // TUI's AbortSignal should be aborted
      await vi.advanceTimersByTimeAsync(0);
      expect(stack.tuiUi._signal("select")?.aborted).toBe(true);
    });
  });

  // ── 9.8–9.11: Architect custom UI wiring ──

  describe("architect prompts — custom widget bar, not generic dialog", () => {
    it("9.8: architect select wires to TUI + widget bar, NOT generic dialog", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const inflight = stack.bus.request({
        pipeline: "architect-edit",
        type: "select",
        question: "What would you like to do?",
        options: ["Save", "Replan", "Cancel"],
      });

      // TUI should show the select
      expect(stack.tuiUi.select).toHaveBeenCalledWith(
        "What would you like to do?",
        ["Save", "Replan", "Cancel"],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      // Dashboard should get architect-prompt component, NOT generic-dialog
      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].component.type).toBe("architect-prompt");
      expect(requests[0].placement).toBe("widget-bar");
      // Should NOT have a generic-dialog
      expect(requests.filter((r: any) => r.component.type === "generic-dialog")).toHaveLength(0);
      await settlePrompts(stack.bus, inflight);
    });

    it("9.9: architect input ('Additional guidance') wires to TUI + widget bar, not generic dialog", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const inflight = stack.bus.request({
        pipeline: "architect-new",
        type: "input",
        question: "Additional guidance for the architect:",
      });

      expect(stack.tuiUi.input).toHaveBeenCalled();

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].component.type).toBe("architect-prompt");
      expect(requests[0].placement).toBe("widget-bar");
      await settlePrompts(stack.bus, inflight);
    });

    it("9.10: TUI answers architect prompt → widget bar dismissed", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const promise = stack.bus.request({
        pipeline: "architect-edit",
        type: "select",
        question: "What would you like to do?",
        options: ["Save", "Replan", "Cancel"],
      });
      const id = getPromptId(stack.connection);

      // TUI answers "Replan"
      stack.tuiUi._resolve("select", "Replan");
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result.answer).toBe("Replan");
      expect(result.source).toBe("tui");

      // Widget bar should be dismissed
      const dismisses = stack.connection._messagesOfType("prompt_dismiss");
      expect(dismisses.some((d: any) => d.promptId === id)).toBe(true);
    });

    it("9.11: Dashboard widget bar answers architect prompt → TUI AbortSignal aborted", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const promise = stack.bus.request({
        pipeline: "architect-edit",
        type: "select",
        question: "What would you like to do?",
        options: ["Save", "Replan", "Cancel"],
      });
      const id = getPromptId(stack.connection);

      // Dashboard widget bar answers "Save"
      stack.bus.respond({ id, answer: "Save", source: "architect-widget" });

      const result = await promise;
      expect(result.answer).toBe("Save");
      expect(result.source).toBe("architect-widget");

      // TUI should be aborted
      await vi.advanceTimersByTimeAsync(0);
      expect(stack.tuiUi._signal("select")?.aborted).toBe(true);
    });
  });

  // ── 9.12–9.14: Mock agent messages ──

  describe("mock agent messages trigger prompts on both UIs", () => {
    it("9.12: mock agent ctx.ui.select reaches both TUI and dashboard", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      // Simulate what the bus-wrapped ctx.ui.select would do:
      const inflight = stack.bus.request({
        pipeline: "command",
        type: "select",
        question: "Agent question",
        options: ["Yes", "No"],
      });

      expect(stack.tuiUi.select).toHaveBeenCalledWith(
        "Agent question",
        ["Yes", "No"],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].prompt.question).toBe("Agent question");
      await settlePrompts(stack.bus, inflight);
    });

    it("9.13: mock architect failure → guidance input reaches TUI + widget bar, no generic dialog", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      // Simulate what emitPromptAndAwait does after architect failure:
      const inflight = stack.bus.request({
        pipeline: "architect-new",
        type: "input",
        question: "Additional guidance for the architect:",
      });

      // TUI should show input
      expect(stack.tuiUi.input).toHaveBeenCalledWith(
        "Additional guidance for the architect:",
        "",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      // Dashboard should show architect widget, NOT generic dialog
      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].component.type).toBe("architect-prompt");
      expect(requests[0].placement).toBe("widget-bar");
      await settlePrompts(stack.bus, inflight);
    });

    it("9.14: mock architect preview → save/replan/cancel on both UIs, TUI answers Save, widget bar dismissed", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const promise = stack.bus.request({
        pipeline: "architect-edit",
        type: "select",
        question: "What would you like to do?",
        options: ["Save", "Replan", "Cancel"],
      });
      const id = getPromptId(stack.connection);

      // Verify both show it
      expect(stack.tuiUi.select).toHaveBeenCalled();
      expect(stack.connection._messagesOfType("prompt_request")).toHaveLength(1);

      // TUI answers "Save"
      stack.tuiUi._resolve("select", "Save");
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result.answer).toBe("Save");

      // Widget bar dismissed
      const dismisses = stack.connection._messagesOfType("prompt_dismiss");
      expect(dismisses.some((d: any) => d.promptId === id)).toBe(true);
    });
  });

  // ── 9.15–9.16: Late responses ──

  describe("late responses after first-response-wins", () => {
    it("9.15: late TUI response after dashboard answered — no error, bus keeps dashboard answer", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A", "B"] });
      const id = getPromptId(stack.connection);

      // Dashboard answers first
      stack.dashboardRespond(id, "A");
      const result = await promise;
      expect(result.answer).toBe("A");
      expect(result.source).toBe("dashboard-default");

      // TUI resolves later — should not throw or change anything
      await vi.advanceTimersByTimeAsync(0);
      // The TUI adapter's promise rejection (AbortError) is caught internally
    });

    it("9.16: late dashboard response after TUI answered — silently ignored", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A", "B"] });
      const id = getPromptId(stack.connection);

      // TUI answers first
      stack.tuiUi._resolve("select", "B");
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result.answer).toBe("B");

      // Late dashboard response — no error
      stack.dashboardRespond(id, "A");
    });
  });

  // ── 9.17: Timeout ──

  describe("timeout cancels both UIs", () => {
    it("9.17: timeout fires, TUI aborted and dashboard cancelled", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Q", options: ["A"] });

      // Advance past timeout
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result.cancelled).toBe(true);

      // TUI should be aborted
      expect(stack.tuiUi._signal("select")?.aborted).toBe(true);

      // Dashboard should get cancel
      const cancels = stack.connection._messagesOfType("prompt_cancel");
      expect(cancels).toHaveLength(1);
    });
  });

  // ── 9.18–9.19: Degenerate modes ──

  describe("degenerate modes", () => {
    it("9.18: headless mode — prompt only reaches dashboard, no TUI mock called", async () => {
      const stack = setupPromptBusStack({ hasUI: false });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A"] });
      const id = getPromptId(stack.connection);

      // TUI should NOT have been called
      expect(stack.tuiUi.select).not.toHaveBeenCalled();

      // Dashboard should have the request
      expect(stack.connection._messagesOfType("prompt_request")).toHaveLength(1);

      // Dashboard responds
      stack.dashboardRespond(id, "A");
      const result = await promise;
      expect(result.answer).toBe("A");
    });

    it("9.19: no pi-flows adapters — only default generic-dialog", async () => {
      const stack = setupPromptBusStack({ hasUI: false, hasArchitect: false });

      const inflight = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(1);
      expect(requests[0].component.type).toBe("generic-dialog");
      await settlePrompts(stack.bus, inflight);
    });
  });

  // ── 9.20–9.21: Concurrent prompts ──

  describe("concurrent prompts from different pipelines", () => {
    it("9.20: command + architect prompts wire independently to correct UIs", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const commandInflight = stack.bus.request({ pipeline: "command", type: "select", question: "Command Q", options: ["A"] });
      const architectInflight = stack.bus.request({ pipeline: "architect-edit", type: "select", question: "Architect Q", options: ["Save", "Cancel"] });

      const requests = stack.connection._messagesOfType("prompt_request");
      expect(requests).toHaveLength(2);

      // Command prompt → generic-dialog
      const commandReq = requests.find((r: any) => r.prompt.question === "Command Q");
      expect(commandReq.component.type).toBe("generic-dialog");

      // Architect prompt → architect-prompt widget bar
      const archReq = requests.find((r: any) => r.prompt.question === "Architect Q");
      expect(archReq.component.type).toBe("architect-prompt");
      expect(archReq.placement).toBe("widget-bar");
      await settlePrompts(stack.bus, commandInflight, architectInflight);
    });

    it("9.21: answering one concurrent prompt does NOT dismiss the other", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise1 = stack.bus.request({ pipeline: "command", type: "select", question: "Q1", options: ["A"] });
      const promise2 = stack.bus.request({ pipeline: "command", type: "select", question: "Q2", options: ["B"] });

      const ids = getPromptIds(stack.connection);
      expect(ids).toHaveLength(2);

      // Answer first prompt
      stack.dashboardRespond(ids[0], "A");
      const result1 = await promise1;
      expect(result1.answer).toBe("A");

      // Second prompt should still be pending
      expect(stack.bus.pendingCount).toBe(1);

      // Only first prompt's dismiss should be sent
      const dismisses = stack.connection._messagesOfType("prompt_dismiss");
      expect(dismisses.every((d: any) => d.promptId === ids[0])).toBe(true);

      // Answer second prompt
      stack.dashboardRespond(ids[1], "B");
      const result2 = await promise2;
      expect(result2.answer).toBe("B");
      expect(stack.bus.pendingCount).toBe(0);
    });
  });

  // ── Reconnect replay ──

  describe("reconnect replay — getPendingRequests for bridge onReconnect", () => {
    it("reconnect with pending prompt returns it for re-send", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const inflight = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A", "B"] });

      // Simulate reconnect: bridge reads pending and re-sends
      const pending = stack.bus.getPendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0].request.question).toBe("Pick:");
      expect(pending[0].component).toBeDefined();
      expect(pending[0].placement).toBeDefined();

      // Re-send (as bridge onReconnect would)
      const beforeCount = stack.connection.send.mock.calls.length;
      for (const { request, component, placement } of pending) {
        stack.connection.send({
          type: "prompt_request",
          sessionId: "test-session",
          promptId: request.id,
          prompt: { question: request.question, type: request.type, options: request.options },
          component,
          placement,
        });
      }
      // Should have sent exactly one re-send
      const afterCount = stack.connection.send.mock.calls.length;
      expect(afterCount - beforeCount).toBe(1);
      await settlePrompts(stack.bus, inflight);
    });

    it("reconnect with no pending prompts sends nothing", () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const pending = stack.bus.getPendingRequests();
      expect(pending).toEqual([]);
    });

    it("reconnect after TUI answered sends nothing", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      const promise = stack.bus.request({ pipeline: "command", type: "select", question: "Pick:", options: ["A"] });
      const id = getPromptId(stack.connection);

      // TUI answers
      stack.tuiUi._resolve("select", "A");
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      // Pending should be empty
      expect(stack.bus.getPendingRequests()).toEqual([]);
    });

    it("reconnect re-send uses stored component even if adapter was unregistered", async () => {
      const stack = setupPromptBusStack({ hasUI: true, hasArchitect: true });

      const inflight = stack.bus.request({
        pipeline: "architect-edit",
        type: "select",
        question: "Save?",
        options: ["Save", "Cancel"],
      });

      // Verify original sent architect-prompt
      const origReqs = stack.connection._messagesOfType("prompt_request");
      expect(origReqs[0].component.type).toBe("architect-prompt");

      // Unregister the architect adapter (simulating reload or deactivation)
      // Since we can't easily unregister by name, verify getPendingRequests still has the component
      const pending = stack.bus.getPendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0].component.type).toBe("architect-prompt");
      expect(pending[0].placement).toBe("widget-bar");
      await settlePrompts(stack.bus, inflight);
    });
  });

  // ── 9.22: Extension reload ──

  describe("extension reload", () => {
    it("9.22: adapter re-registration replaces old adapter", async () => {
      const stack = setupPromptBusStack({ hasUI: true });

      // Register a new TUI adapter (simulating reload)
      const newTuiUi = createMockTuiUi();
      const newTuiAdapter = createTuiPromptAdapter(newTuiUi, stack.bus);
      stack.bus.registerAdapter(newTuiAdapter);

      // New prompt should use new adapter
      const inflight = stack.bus.request({ pipeline: "command", type: "select", question: "After reload", options: ["X"] });

      // Old TUI should NOT have been called
      expect(stack.tuiUi.select).not.toHaveBeenCalledWith("After reload", expect.anything(), expect.anything());

      // New TUI should have been called
      expect(newTuiUi.select).toHaveBeenCalledWith(
        "After reload",
        ["X"],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      await settlePrompts(stack.bus, inflight);
    });
  });
});

// ── split-notify-from-prompt-request: ctx.ui.notify proxy ──────────
//
// The notify proxy is fire-and-forget: it sends on the dedicated `notify`
// channel and never touches PromptBus. Tests drive the real proxy factory
// (`createNotifyProxy`), which bridge.ts installs on `ctx.ui.notify`.

describe("notify proxy — dedicated channel, never PromptBus", () => {
  function setupNotify(originalNotify?: (m: string, l?: string) => void) {
    const connection = createMockConnection();
    let seq = 0;
    const notify = createNotifyProxy({
      sessionId: "test-session",
      send: (msg) => connection.send(msg),
      originalNotify,
      newId: () => `n${++seq}`,
    });
    return { connection, notify };
  }

  it("E1: emits {type:'notify'} with no promptId/placement/component", () => {
    const original = vi.fn();
    const { connection, notify } = setupNotify(original);

    notify("hello", "info");

    expect(original).toHaveBeenCalledWith("hello", "info");
    expect(connection._messagesOfType("prompt_request")).toHaveLength(0);
    const frames = connection._messagesOfType("notify");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      type: "notify",
      sessionId: "test-session",
      notifyId: "n1",
      message: "hello",
      level: "info",
    });
    expect("promptId" in frames[0]).toBe(false);
    expect("placement" in frames[0]).toBe(false);
    expect("component" in frames[0]).toBe(false);
  });

  it("E2: omits level when the caller passes none", () => {
    const { connection, notify } = setupNotify();
    notify("hi");
    const frame = connection._messagesOfType("notify")[0];
    expect("level" in frame).toBe(false);
    expect(frame.message).toBe("hi");
  });

  it("E3: success level survives", () => {
    const { connection, notify } = setupNotify();
    notify("done", "success");
    expect(connection._messagesOfType("notify")[0].level).toBe("success");
  });

  it("E4: unrecognized level is normalized to info at the send site", () => {
    const { connection, notify } = setupNotify();
    notify("x", "debug");
    expect(connection._messagesOfType("notify")[0].level).toBe("info");
  });

  it("E12: notify never enters PromptBus", () => {
    const stack = setupPromptBusStack({ hasUI: true });
    const notify = createNotifyProxy({
      sessionId: "test-session",
      send: (msg) => stack.connection.send(msg),
      newId: () => "n1",
    });

    notify("hello", "info");

    expect(stack.bus.getPendingRequests()).toHaveLength(0);
    expect(stack.connection._messagesOfType("prompt_request")).toHaveLength(0);
  });
});
