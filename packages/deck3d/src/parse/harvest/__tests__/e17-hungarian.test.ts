/**
 * E17 — harvest: Hungarian text round-trips (#E17, 10.17).
 *
 * Observable: the node label `Felhasználó őrült űrhajó` is byte-equal in
 * `deck.json` and stored in NFC (not decomposed).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../ir/types.js";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

/** NFC source literal — `ő`/`ű` are single code points here. */
const LABEL = "Felhasználó őrült űrhajó";

const MERMAID = ["flowchart LR", `  A[${LABEL}] --> B[Megfigyelés]`].join("\n");

describe.skipIf(!hasChromium)("harvest: Hungarian text round-trips (E17)", () => {
  it("writes the accented label byte-equal and NFC-normalised", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-e17-"));
    writeFileSync(join(dir, "hu.md"), `# Nyelv\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
    const r = spawnSync(BIN, ["parse", "hu.md", "-o", "hu.json"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);

    const bytes = readFileSync(join(dir, "hu.json"));
    const diagram = (JSON.parse(bytes.toString("utf8")) as {
      slides: Array<{ diagram: Diagram }>;
    }).slides[0].diagram;

    const label = diagram.nodes?.find((n) => n.id === "A")?.label;
    expect(label).toBe(LABEL);
    expect(label?.normalize("NFC")).toBe(label);
    expect(diagram.nodes?.find((n) => n.id === "B")?.label).toBe("Megfigyelés");

    // Byte level: the exact NFC UTF-8 bytes are present and no decomposed
    // (NFD) variant leaked into the file.
    expect(bytes.includes(Buffer.from(LABEL, "utf8"))).toBe(true);
    expect(bytes.includes(Buffer.from(LABEL.normalize("NFD"), "utf8"))).toBe(false);
  }, 90_000);
});
