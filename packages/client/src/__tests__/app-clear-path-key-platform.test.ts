/**
 * Static scan (test-plan #X2): App.tsx `clearInMemoryState` resets the archive
 * key platform with the archived counts, so a server switch never reuses the
 * previous host's platform before the next `sessions_snapshot`.
 * See change: fix-archive-fold-key-and-filter-chips.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

/**
 * @structural-pin server-switch reset contract: clearInMemoryState is an inline closure inside App's server-switch deps; rendering App to drive a switch needs the full WS + router stack
 */
describe("App clearInMemoryState resets pathKeyPlatform (#X2)", () => {
  it("calls setPathKeyPlatform(undefined) inside clearInMemoryState", () => {
    const start = src.indexOf("clearInMemoryState: () => {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n        },", start);
    const body = src.slice(start, end);
    expect(body).toContain("setArchivedCountMap(new Map());");
    expect(body).toContain("setPathKeyPlatform(undefined);");
  });

  it("passes the platform to SessionList as archiveKeyPlatform", () => {
    expect(src).toMatch(/archiveKeyPlatform=\{pathKeyPlatform\}/);
  });
});
