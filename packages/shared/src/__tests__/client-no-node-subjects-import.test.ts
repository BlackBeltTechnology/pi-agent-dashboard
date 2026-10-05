/**
 * The browser client MUST NOT import the Node-only access-subject modules
 * (`forbidden-subjects`, `canonical-subject` import node:fs/os/path). The Access
 * page reads `via` from the API instead.
 * See change: ask-agent-file-access-in-chat — test-plan #E34.
 */
import * as fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = path.resolve(__dirname, "../../../client/src");
const FORBIDDEN = /from\s+["'][^"']*\/(forbidden-subjects|canonical-subject)(\.js)?["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("client import guard (#E34)", () => {
  it("no client source imports forbidden-subjects / canonical-subject", () => {
    const offenders = walk(CLIENT_SRC).filter((f) => FORBIDDEN.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
