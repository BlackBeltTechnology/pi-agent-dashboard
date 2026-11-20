/**
 * The bound open at the primitive level: without `decidedReal` it is unchanged (no extra `realpath` on the
 * opened path, same bytes, the no-decision sites untouched); with it, a file renamed over after `fs.open`
 * returns is refused on `(dev, ino)` with the handle closed and nothing read.
 *
 * See change: close-local-listener-and-egress-gaps (D2; test-plan #E28, #E29).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContainmentBindingRefused, openStateChecked, readFileStateChecked } from "../lib/dashboard-state-guard.js";

let dir: string;
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-binding-unit-")));
  process.env.HOME = path.join(dir, "home");
  fs.mkdirSync(process.env.HOME);
  fs.writeFileSync(path.join(dir, "a"), "ORIGINAL");
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("T.28 no `decidedReal` → behaviour unchanged", () => {
  it("opens and reads exactly as before, with zero `realpath` of the opened path", async () => {
    const target = path.join(dir, "a");
    fs.symlinkSync(target, path.join(dir, "link")); // no binding: a link is followed, as it always was
    const realpath = vi.spyOn(fsp, "realpath");
    const fh = await openStateChecked(target, "r");
    expect((await fh.readFile("utf-8")).toString()).toBe("ORIGINAL");
    await fh.close();
    expect((await readFileStateChecked(target)).toString()).toBe("ORIGINAL");
    expect(await readFileStateChecked(target, "utf-8")).toBe("ORIGINAL");
    expect(await readFileStateChecked(path.join(dir, "link"), "utf-8")).toBe("ORIGINAL");
    const onTarget = realpath.mock.calls.filter(([p]) => [target, path.join(dir, "link")].includes(String(p)));
    expect(onTarget, "the binding's realpath of the opened path must not run").toEqual([]);
  });

  it("`live-server/live-static.ts` and `lib/eml.ts` take no part in the binding", () => {
    for (const rel of ["../live-server/live-static.ts", "../lib/eml.ts"]) {
      expect(fs.readFileSync(path.join(import.meta.dirname, rel), "utf8"), rel).not.toContain("decidedReal");
    }
  });
});

describe("T.29 a file renamed over after the open is refused by the handle identity", () => {
  it("(dev, ino) of the handle ≠ stat(real): ContainmentBindingRefused, handle closed, nothing read", async () => {
    const real = path.join(dir, "a");
    const realOpen = fsp.open.bind(fsp);
    const seen = { reads: 0, closes: 0, opened: false };
    vi.spyOn(fsp, "open").mockImplementation((async (p: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
      const fh = await (realOpen as (...a: unknown[]) => Promise<Awaited<ReturnType<typeof fsp.open>>>)(p, ...rest);
      if (String(p) === real) {
        // After the open returned: a different regular file takes the same path (same real path, new inode).
        fs.writeFileSync(`${real}.new`, "REPLACED!");
        fs.renameSync(`${real}.new`, real);
        seen.opened = true;
        for (const m of ["read", "readFile", "createReadStream"] as const) {
          const orig = (fh[m] as (...a: unknown[]) => unknown).bind(fh);
          (fh as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
            seen.reads++;
            return orig(...a);
          };
        }
        const close = fh.close.bind(fh);
        fh.close = (() => {
          seen.closes++;
          return close();
        }) as typeof fh.close;
      }
      return fh;
    }) as never);
    const err = await readFileStateChecked(real, "utf-8", { decidedReal: real }).catch((e) => e);
    expect(seen.opened).toBe(true);
    expect(fs.realpathSync(real)).toBe(real); // the realpath half of the check still passes: only the identity differs
    expect(err).toBeInstanceOf(ContainmentBindingRefused);
    expect(seen.reads).toBe(0);
    expect(seen.closes).toBe(1);
  });
});
