/**
 * Every `events.on("<name>")` listener in the bridge is under a reserved prefix
 * (refused by the server seams) or in a reviewed benign list. A new privileged
 * listener outside the prefixes fails here.
 * See change: harden-trust-and-credential-boundaries (D3; T-E26).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isReservedEventType } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, it } from "vitest";
import { forwardedBusChannels } from "../flow-event-wiring.js";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENIGN = new Set(["flow:rediscover", "flow:complete", "flow:get-available-models"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") out.push(...walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe("pi.events listener coverage", () => {
  it("every literal listener is reserved or reviewed-benign", () => {
    const forwarded = new Set(forwardedBusChannels());
    const unlisted: string[] = [];
    let seen = 0;
    for (const f of walk(src)) {
      for (const m of fs.readFileSync(f, "utf-8").matchAll(/\bevents\.on\(\s*["'`]([^"'`]+)["'`]/g)) {
        seen++;
        const name = m[1]!;
        if (!isReservedEventType(name) && !BENIGN.has(name) && !forwarded.has(name)) unlisted.push(`${path.relative(src, f)}: ${name}`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(unlisted).toEqual([]);
  });
});
