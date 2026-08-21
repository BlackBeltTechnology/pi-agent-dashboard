import { describe, expect, it } from "vitest";
import {
  addInteractiveRequest,
  addNotify,
  createInitialState,
  reconcileInteractiveRequestsAfterReconnect,
  resolveInteractiveRequest,
} from "../lib/chat/event-reducer.js";

function pendingState() {
  return addInteractiveRequest(createInitialState(), "pending", "confirm", { title: "Choose" });
}

describe("interactive control state after browser reconnect", () => {
  it("replays a prompt_request that was lost before the forced reconnect", () => {
    const afterReconnect = reconcileInteractiveRequestsAfterReconnect(createInitialState());
    const afterReplay = addInteractiveRequest(afterReconnect, "pending", "confirm", { title: "Choose" });

    expect(afterReplay.interactiveRequests).toMatchObject([
      { requestId: "pending", status: "pending" },
    ]);
    expect(afterReplay.messages.some((message) => message.id === "ui-pending")).toBe(true);
  });

  it.each(["prompt_cancel", "prompt_dismiss"])(
    "removes stale pending state when %s was lost and server replay omits it",
    () => {
      const afterReconnect = reconcileInteractiveRequestsAfterReconnect(pendingState());

      expect(afterReconnect.interactiveRequests).toHaveLength(0);
      expect(afterReconnect.messages.some((message) => message.id === "ui-pending")).toBe(false);
    },
  );

  it("preserves settled prompt rows and notify transcript rows", () => {
    let state = pendingState();
    state = addInteractiveRequest(state, "settled", "select", { title: "Done" });
    state = resolveInteractiveRequest(state, "settled", "yes");
    state = addNotify(state, "notice", "Still here", "info");

    const afterReconnect = reconcileInteractiveRequestsAfterReconnect(state);

    expect(afterReconnect.interactiveRequests).toMatchObject([
      { requestId: "settled", status: "resolved", result: "yes" },
    ]);
    expect(afterReconnect.messages.map((message) => message.id)).toEqual([
      "ui-settled",
      "ui-notice",
    ]);
  });
});
