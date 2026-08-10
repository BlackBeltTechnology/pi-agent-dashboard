/**
 * Reproduction: a Write recording an ABSOLUTE path under cwd must, after the
 * client normalization ChatView applies, resolve to the SAME relative-posix
 * key the server's session-diff endpoint puts in `data.files`.
 *
 * Before the fix the change-summary row + the value passed to `openDiffTab`
 * carried the absolute path, which never string-equals the relative key →
 * "No changes for this file". See change: fix-session-diff-open-nongit-and-preview.
 */
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../chat/event-reducer.js";
import { buildTurnSummaries } from "../util/lineDelta.js";
import { normalizeUnderCwd } from "../util/normalize-path.js";

const CWD = "/Users/me/proj";
/** The relative-posix key the server's `normalizePath` would emit for this file. */
const SERVER_KEY = "openspec/changes/x/proposal.md";

function user(text: string, turnIndex: number): ChatMessage {
  return { id: `u-${text}`, role: "user", content: text, timestamp: 0, turnIndex };
}
function write(absPath: string, content: string): ChatMessage {
  return {
    id: `w-${absPath}`,
    role: "toolResult",
    content: "write",
    toolName: "write",
    args: { path: absPath, content },
    timestamp: 0,
  };
}

describe("absolute-path Write → summary open", () => {
  it("normalizes the row path + open target to the server's relative key", () => {
    const abs = `${CWD}/${SERVER_KEY}`;
    const messages = [user("go", 0), write(abs, "line one\nline two\n")];

    const summaries = buildTurnSummaries(messages);
    expect(summaries).toHaveLength(1);
    const file = summaries[0].files[0];

    // Raw summary carries the absolute path (root cause reproduced).
    expect(file.path).toBe(abs);

    // The normalization ChatView applies for BOTH display and openDiffTab.
    const opened = normalizeUnderCwd(file.path, CWD);
    expect(opened).toBe(SERVER_KEY);
    // Additive Write is counted so the row is non-empty.
    expect(file.additions).toBe(2);
  });
});
