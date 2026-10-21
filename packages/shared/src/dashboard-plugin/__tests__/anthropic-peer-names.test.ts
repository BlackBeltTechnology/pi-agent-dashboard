import { describe, expect, it } from "vitest";
import { PEER_AM_LEGACY } from "../anthropic-peer-names.js";

describe("anthropic-peer-names (shared contract, task 2.1)", () => {
  it("exports the legacy probe key", () => {
    expect(PEER_AM_LEGACY).toBe("@pi/anthropic-messages");
  });
});
