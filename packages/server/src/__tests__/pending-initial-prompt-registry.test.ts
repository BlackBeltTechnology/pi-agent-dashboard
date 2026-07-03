/**
 * Pending-initial-prompt registry: FIFO per cwd, cap, TTL, normalization.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect } from "vitest";
import {
  createPendingInitialPromptRegistry,
  PENDING_INITIAL_PROMPT_QUEUE_CAP,
} from "../pending-initial-prompt-registry.js";

const idNorm = (cwd: string) => cwd;

describe("pending-initial-prompt-registry", () => {
  it("enqueue then consume returns the prompt (FIFO)", () => {
    const reg = createPendingInitialPromptRegistry({ normalize: idNorm });
    reg.enqueue("/a", "/skill:project-init");
    reg.enqueue("/a", "second");
    expect(reg.consume("/a")).toBe("/skill:project-init");
    expect(reg.consume("/a")).toBe("second");
    expect(reg.consume("/a")).toBeNull();
  });

  it("keys per cwd", () => {
    const reg = createPendingInitialPromptRegistry({ normalize: idNorm });
    reg.enqueue("/a", "pa");
    reg.enqueue("/b", "pb");
    expect(reg.consume("/b")).toBe("pb");
    expect(reg.consume("/a")).toBe("pa");
  });

  it("ignores empty prompts", () => {
    const reg = createPendingInitialPromptRegistry({ normalize: idNorm });
    expect(reg.enqueue("/a", "")).toBe(false);
    expect(reg.consume("/a")).toBeNull();
  });

  it("caps the queue", () => {
    const reg = createPendingInitialPromptRegistry({ normalize: idNorm });
    for (let i = 0; i < PENDING_INITIAL_PROMPT_QUEUE_CAP + 3; i++) {
      reg.enqueue("/a", `p${i}`);
    }
    expect(reg.size("/a")).toBe(PENDING_INITIAL_PROMPT_QUEUE_CAP);
  });

  it("drops entries older than the TTL", () => {
    let t = 0;
    const reg = createPendingInitialPromptRegistry({ normalize: idNorm, now: () => t });
    reg.enqueue("/a", "old");
    t = 61_000;
    expect(reg.consume("/a")).toBeNull();
  });
});
