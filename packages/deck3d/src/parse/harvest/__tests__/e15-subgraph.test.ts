/**
 * E15 — harvest: subgraph membership (#E15, 10.15).
 *
 * Observable: both nodes declared inside `subgraph Core … end` carry
 * `group:"Core"`; every node declared outside carries no `group`.
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
  "flowchart TB",
  "  subgraph Core",
  "    A[One] --> B[Two]",
  "  end",
  "  B --> C[Outside]",
].join("\n");

describe.skipIf(!hasChromium)("harvest: subgraph membership (E15)", () => {
  it("marks exactly the subgraph nodes with its title", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-e15-"));
    writeFileSync(join(dir, "sub.md"), `# Groups\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
    const r = spawnSync(BIN, ["parse", "sub.md", "-o", "sub.json"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);

    const diagram = (JSON.parse(readFileSync(join(dir, "sub.json"), "utf8")) as {
      slides: Array<{ diagram: Diagram }>;
    }).slides[0].diagram;
    expect(diagram.kind).toBe("flowchart");

    const nodes = diagram.nodes ?? [];
    expect(nodes.find((n) => n.id === "A")?.group).toBe("Core");
    expect(nodes.find((n) => n.id === "B")?.group).toBe("Core");
    // Outside the `subgraph` block — must NOT be tagged.
    expect(nodes.find((n) => n.id === "C")?.group).toBeUndefined();

    const grouped = nodes.filter((n) => n.group !== undefined).map((n) => n.id).sort();
    expect(grouped).toEqual(["A", "B"]);
    expect(diagram.groups).toEqual([expect.objectContaining({ title: "Core", nodes: expect.arrayContaining(["A", "B"]) })]);
  }, 90_000);
});
