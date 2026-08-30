/**
 * Regression: the openspec recipes must survive a non-JSON PREAMBLE on stdout.
 *
 * `openspec` prints a one-off notice on its first run under a given HOME:
 *
 *   Note: OpenSpec collects anonymous usage stats. Opt out: OPENSPEC_TELEMETRY=0
 *   { "changes": [ ... ] }
 *
 * A strict `JSON.parse(stdout)` throws on that, `parse` returns null, and the
 * caller reads it as "no openspec / no changes" — the dashboard silently shows
 * an empty OpenSpec panel on any fresh HOME (new container, new user, CI), and
 * `openspec-poller-parity.test.ts` silently took its graceful-skip branch
 * instead of asserting anything.
 */
import { describe, expect, it } from "vitest";
import { OPENSPEC_LIST, OPENSPEC_STATUS } from "../openspec.js";

const TELEMETRY_NOTICE =
  "Note: OpenSpec collects anonymous usage stats. Opt out: OPENSPEC_TELEMETRY=0\n";

describe("openspec recipes tolerate a stdout preamble", () => {
  it("parses `list --json` output preceded by the telemetry notice", () => {
    const stdout = `${TELEMETRY_NOTICE}{"changes":[{"name":"a","status":"no-tasks"}]}`;
    expect(OPENSPEC_LIST.parse(stdout, { cwd: "/x" })).toEqual({
      changes: [{ name: "a", status: "no-tasks" }],
    });
  });

  it("parses `status --change` output preceded by the telemetry notice", () => {
    const stdout = `${TELEMETRY_NOTICE}{"artifacts":[{"id":"proposal","status":"done"}],"isComplete":false}`;
    expect(OPENSPEC_STATUS.parse(stdout, { cwd: "/x", change: "a" })).toEqual({
      artifacts: [{ id: "proposal", status: "done" }],
      isComplete: false,
    });
  });

  it("still parses clean JSON, and still returns null on genuine junk", () => {
    expect(OPENSPEC_LIST.parse('{"changes":[]}', { cwd: "/x" })).toEqual({ changes: [] });
    expect(OPENSPEC_LIST.parse("", { cwd: "/x" })).toBeNull();
    expect(OPENSPEC_LIST.parse("command not found: openspec", { cwd: "/x" })).toBeNull();
    // A preamble with no JSON at all must not be coerced into a truthy value.
    expect(OPENSPEC_LIST.parse(TELEMETRY_NOTICE, { cwd: "/x" })).toBeNull();
  });
});
