/**
 * A plugin-declared `lifecycle.hidden` is applied on the FRESH resolution only
 * (the lifecycle block never re-runs on reattach, so an operator's later
 * unhide survives), and it is BROADCAST — an in-memory-only update would leave
 * the card on every open board until the next full refresh. Source-pinned like
 * the sibling X3 ordering test (ref-resolution-ordering.test.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, "..", "event-wiring.ts"), "utf8");

describe("plugin lifecycle.hidden on session_register", () => {
  it("is applied inside the fresh-resolution lifecycle block and broadcast", () => {
    const lifecycleIdx = src.indexOf("if (lifecycle) {");
    const hiddenIdx = src.indexOf("lifecycle.hidden === true");
    const ownerNotifyIdx = src.indexOf("dispatchPluginSessionResolved?.(ownerId, sessionId, ref)");
    expect(lifecycleIdx).toBeGreaterThan(-1);
    expect(hiddenIdx, "lifecycle.hidden must be honoured").toBeGreaterThan(lifecycleIdx);
    expect(hiddenIdx).toBeLessThan(ownerNotifyIdx);
    const block = src.slice(hiddenIdx, ownerNotifyIdx);
    expect(block).toMatch(/sessionManager\.update\(sessionId, \{ hidden: true \}\)/);
    expect(block).toMatch(/broadcastSessionUpdated\(sessionId, \{ hidden: true \}\)/);
  });
});
