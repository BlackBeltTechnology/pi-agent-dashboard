/**
 * add-inline-consent-ui (dashboard): the two guarantees the inline consent UI
 * rests on, verified offline:
 *   - a consent `ask_user` prompt not claimed as widget-bar resolves to an
 *     INLINE placement, so it renders in the chat transcript (not suppressed by
 *     flow-question-routing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptBus, type PromptAdapter } from "../prompt-bus.js";

describe("consent prompts resolve to an inline placement", () => {
  let bus: PromptBus;
  let onDashboardRequest: any;

  const nonClaimingAdapter = (name: string): PromptAdapter =>
    ({ name, onRequest: vi.fn().mockReturnValue({}), onResponse: vi.fn(), onCancel: vi.fn() } as any);

  beforeEach(() => {
    vi.useFakeTimers();
    onDashboardRequest = vi.fn();
    bus = new PromptBus({ timeoutMs: 5000, onDashboardRequest, onDashboardDismiss: vi.fn(), onDashboardCancel: vi.fn() });
  });
  afterEach(() => vi.useRealTimers());

  it("a consent confirmation not claimed as widget-bar is inline (generic-dialog)", () => {
    bus.registerAdapter(nonClaimingAdapter("noop")); // no widget-bar claim
    // Fire-and-forget: the request resolves only once a consumer answers, which this
    // test deliberately never does. `.catch` handles the rejection without awaiting
    // (an `await` would hang) and without a bare `void` discard.
    bus
      .request({
        pipeline: "invoicebot",
        type: "confirm",
        question: "Aktiv\u00e1ljam a szab\u00e1lyt?",
      } as any)
      .catch(() => {});
    expect(onDashboardRequest).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Aktiv\u00e1ljam a szab\u00e1lyt?" }),
      expect.objectContaining({ type: "generic-dialog" }),
      "inline",
    );
  });
});
