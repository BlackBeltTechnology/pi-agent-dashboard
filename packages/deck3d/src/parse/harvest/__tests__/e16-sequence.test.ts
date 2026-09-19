/**
 * E16 — harvest: sequence converted (#E16, 10.16).
 *
 * Observable: actors in declaration order (`U,S,D`); `messages.length === 5`
 * with ids `m0..m4`; solid/dotted kinds preserved; the self-message has
 * `from === to`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";
import type { Diagram } from "../../../ir/types.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MERMAID = [
  "sequenceDiagram",
  "  actor U as User",
  "  participant S as Server",
  "  participant D as DB",
  "  U->>S: one",
  "  S-->>U: two",
  "  S->>D: three",
  "  D-->>S: four",
  "  S->>S: five",
].join("\n");

describe.skipIf(!hasChromium)("harvest: sequence converted (E16)", () => {
  it("preserves actor order, message order, kinds and the self-message", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-e16-"));
    writeFileSync(join(dir, "seq.md"), `# Sequence\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
    const r = spawnSync(BIN, ["parse", "seq.md", "-o", "seq.json"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);

    const diagram = (JSON.parse(readFileSync(join(dir, "seq.json"), "utf8")) as {
      slides: Array<{ diagram: Diagram }>;
    }).slides[0].diagram;
    expect(diagram.kind).toBe("sequence");

    expect(diagram.actors?.map((a) => a.id)).toEqual(["U", "S", "D"]);
    expect(diagram.actors?.map((a) => a.label)).toEqual(["User", "Server", "DB"]);

    const messages = diagram.messages ?? [];
    expect(messages).toHaveLength(5);
    expect(messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(messages.map((m) => m.kind)).toEqual(["solid", "dotted", "solid", "dotted", "solid"]);
    expect(messages.map((m) => [m.from, m.to, m.text])).toEqual([
      ["U", "S", "one"],
      ["S", "U", "two"],
      ["S", "D", "three"],
      ["D", "S", "four"],
      ["S", "S", "five"],
    ]);
    const self = messages[4];
    expect(self.from).toBe(self.to);
  }, 90_000);
});
