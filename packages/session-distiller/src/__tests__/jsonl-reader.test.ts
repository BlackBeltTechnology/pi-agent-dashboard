import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSession, parseSessionText, sessionHeader } from "../jsonl-reader.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "session-multi.jsonl",
);

describe("jsonl-reader (task 2.1)", () => {
  it("parses the fixture into ordered events and skips+counts malformed lines", () => {
    const { events, malformed } = readSession(FIXTURE);
    // 30 lines total, 1 malformed => 29 well-formed events.
    expect(events.length).toBe(29);
    expect(malformed).toBe(1);
  });

  it("returns events in file order", () => {
    const { events } = readSession(FIXTURE);
    expect(events[0].type).toBe("session");
    expect(events[1].type).toBe("model_change");
    expect(events[2].type).toBe("session_info");
  });

  it("identifies the session header", () => {
    const { events } = readSession(FIXTURE);
    expect(sessionHeader(events)?.id).toBe("sess1");
  });

  it("tolerates a malformed line inline without aborting", () => {
    const { events, malformed } = parseSessionText(
      '{"type":"a"}\nGARBAGE NOT JSON\n{"type":"b"}\n',
    );
    expect(events.map((e) => e.type)).toEqual(["a", "b"]);
    expect(malformed).toBe(1);
  });

  it("counts parseable-but-shapeless JSON as malformed", () => {
    const { events, malformed } = parseSessionText('{"type":"ok"}\n42\n{"foo":1}\n');
    expect(events.map((e) => e.type)).toEqual(["ok"]);
    expect(malformed).toBe(2); // 42 and {foo:1} lack a string `type`
  });

  it("returns empty result for a missing file", () => {
    expect(readSession("/nonexistent/x.jsonl")).toEqual({ events: [], malformed: 0 });
  });
});
