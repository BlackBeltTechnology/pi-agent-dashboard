/**
 * X3: on `session_register`, ref resolution + owner-notify run BEFORE the
 * first raw-event forward AND before any pending-prompt dispatch (task 3.1).
 *
 * The owner-notify (`dispatchPluginSessionResolved`) and the ref merge live in
 * the `session_register` handler, which structurally precedes any later
 * `event_forward` (the first `onEvent` fan-out). Within that same handler the
 * moved initial-prompt dispatch (`pendingInitialPromptRegistry.consume`) is
 * positioned AFTER the owner-notify. This test pins that source ordering the
 * same way the sibling X5 hook-ordering test pins the mapper/file ordering.
 * See change: detach-automation-goal-from-core.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, "..", "event-wiring.ts"), "utf8");

describe("ref-resolution ordering on session_register (X3)", () => {
  it("resolution + owner-notify precede the moved pending-prompt dispatch", () => {
    // The three landmarks, in the session_register handler.
    const linkByTokenIdx = src.indexOf("headlessPidRegistry.linkByToken(msg.spawnToken");
    const ownerNotifyIdx = src.indexOf("dispatchPluginSessionResolved?.(ownerId, sessionId, ref)");
    const promptIdx = src.indexOf("pendingInitialPromptRegistry.consume(msg.cwd)");

    expect(linkByTokenIdx, "linkByToken must be present").toBeGreaterThan(-1);
    expect(ownerNotifyIdx, "owner-notify must be present").toBeGreaterThan(-1);
    expect(promptIdx, "moved initial-prompt dispatch must be present").toBeGreaterThan(-1);

    // Resolution runs AFTER linkByToken binds the entry's sessionId…
    expect(linkByTokenIdx).toBeLessThan(ownerNotifyIdx);
    // …and owner-notify precedes the pending-prompt dispatch.
    expect(ownerNotifyIdx).toBeLessThan(promptIdx);
  });

  it("the initial-prompt dispatch no longer runs in onSessionRegistered", () => {
    // The onSessionRegistered callback ends before the onEvent handler starts;
    // the prompt consume must now sit in the onEvent `session_register` branch
    // (keyed on `msg.cwd`), never the old `onSessionRegistered` (keyed on `cwd`).
    expect(src).not.toMatch(/onSessionRegistered[\s\S]*?pendingInitialPromptRegistry\.consume\(cwd\)/);
  });
});
