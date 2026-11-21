/**
 * Static scan: App.tsx `clearInMemoryState` (the committed server-switch
 * cleanup) resets the module-level sudo bus, so server A's pending prompt never
 * answers through server B's socket; and the host receives the socket-open flag.
 * See change: add-sudo-credential-prompt.
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
describe("App server switch resets the sudo bus", () => {
  it("calls resetSudoCredentialBusForServerSwitch() inside clearInMemoryState only", () => {
    const start = src.indexOf("clearInMemoryState: () => {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n        },", start);
    expect(src.slice(start, end)).toContain("resetSudoCredentialBusForServerSwitch();");
    expect(src.match(/resetSudoCredentialBusForServerSwitch\(\)/g)).toHaveLength(1);
  });

  it("passes the socket-open flag to every SudoCredentialHost mount", () => {
    const mounts = src.match(/<SudoCredentialHost [^>]*>/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
    for (const m of mounts) expect(m).toContain('connected={status === "connected"}');
  });
});
