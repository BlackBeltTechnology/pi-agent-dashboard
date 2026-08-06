/**
 * Repo-level invariant: the engines range that `buildEnginesRangeMessage`
 * prints MUST match root `package.json#engines.node` verbatim.
 *
 * The Node-version lockstep contract claims "when `engines.node` changes, only
 * `node-version.ts` changes". That is false for a THIRD cap site: the hardcoded
 * `Required: >=22.19.0 <27` literal inside `buildEnginesRangeMessage`. It is a
 * string, so the `major >= N` arithmetic scan (`node-cap-single-source.test.ts`)
 * cannot see it, and a stale literal would tell the user to install a Node the
 * manifest actually accepts. This test closes that hole so the next cap raise
 * cannot forget the literal.
 *
 * See change: fix-pi-install-node26-and-omit-dev-build (test-plan #E10).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { buildEnginesRangeMessage } from "../auth/node-guard.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const ROOT_PKG_JSON = path.join(REPO_ROOT, "package.json");

function readEnginesRange(): string {
  const pkg = JSON.parse(fs.readFileSync(ROOT_PKG_JSON, "utf8"));
  const range = pkg?.engines?.node;
  if (typeof range !== "string") {
    throw new Error(`engines.node missing or not a string in ${ROOT_PKG_JSON}`);
  }
  return range;
}

describe("engines-range message matches package.json#engines.node", () => {
  it("emits the manifest range verbatim after `Required:`", () => {
    const range = readEnginesRange();
    const msg = buildEnginesRangeMessage("v99.0.0");
    const m = msg.match(/Required:\s*(.+?)\s*\(see package\.json#engines\.node\)/);

    expect(
      m,
      "buildEnginesRangeMessage no longer emits a `Required: <range> " +
        "(see package.json#engines.node)` line — update this lint together " +
        "with the message shape.",
    ).not.toBeNull();

    expect(
      (m as RegExpMatchArray)[1],
      `The engines range hardcoded in buildEnginesRangeMessage ` +
        `(packages/server/src/auth/node-guard.ts) has drifted from root ` +
        `package.json#engines.node ("${range}"). The lockstep contract does ` +
        `not cover this literal — edit it by hand when raising the cap.`,
    ).toBe(range);
  });
});
