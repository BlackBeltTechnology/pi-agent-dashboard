// @vitest-environment node
/**
 * B1 (review r1) — archive validation/extraction must not block the host event
 * loop. A slow `tar` shim stands in for a large archive: while the guard runs, a
 * 10 ms ticker must keep firing. A synchronous implementation freezes it for the
 * shim's whole runtime. See change: improve-kb-settings-sources-and-search (D6).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractArchiveSafely } from "../archive-guard.js";

const dirs: string[] = [];
const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function shimTar(): string {
  const bin = mkdtempSync(join(tmpdir(), "kb-tar-shim-"));
  dirs.push(bin);
  const script = `#!/bin/sh
case "$*" in
  *-tvf*) sleep 1; echo "-rw-r--r-- 0/0 3 2020-01-01 00:00 a.md" ;;
  *-tf*)  sleep 1; echo "a.md" ;;
  *-xOf*) sleep 1 ;;
  *-xf*)  sleep 1; prev=""; d=""; for a in "$@"; do [ "$prev" = "-C" ] && d="$a"; prev="$a"; done; printf hi > "$d/a.md" ;;
esac
`;
  const p = join(bin, "tar");
  writeFileSync(p, script);
  chmodSync(p, 0o755);
  return bin;
}

describe("archive guard is non-blocking", () => {
  it("B1 the event loop keeps ticking through list → expand-check → extract", async () => {
    process.env.PATH = `${shimTar()}${delimiter}${savedPath ?? ""}`;
    const work = mkdtempSync(join(tmpdir(), "kb-arch-"));
    dirs.push(work);
    const archive = join(work, "x.tar");
    writeFileSync(archive, "not a real tar — the shim never reads it");
    const out = join(work, "out");
    mkdirSync(out);

    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const t0 = Date.now();
    try {
      await extractArchiveSafely("tar", archive, out);
    } finally {
      clearInterval(timer);
    }
    const elapsed = Date.now() - t0;
    expect(existsSync(join(out, "a.md"))).toBe(true);
    expect(readFileSync(join(out, "a.md"), "utf8")).toBe("hi");
    expect(elapsed).toBeGreaterThanOrEqual(3500); // 4 shimmed calls × ~1 s actually ran
    expect(ticks).toBeGreaterThanOrEqual(100); // a blocked loop registers ~0
  }, 30_000);
});
