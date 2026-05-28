/**
 * Repo-lint: `editor-keeper/keeper.cjs` MUST require only Node built-in
 * modules. No TS loader, jiti, tsx, npm package — the keeper has to run
 * under bare node from a daemonised parent. Task 7.8.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const KEEPER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "keeper.cjs",
);

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "fs/promises", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "stream/promises", "string_decoder",
  "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm",
  "wasi", "worker_threads", "zlib",
]);

describe("keeper.cjs is CJS-pure (task 7.8)", () => {
  it("only requires Node built-in modules", () => {
    const src = readFileSync(KEEPER_PATH, "utf8");
    const re = /require\(\s*["']([^"']+)["']\s*\)/g;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      // Strip optional `node:` prefix.
      const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
      if (NODE_BUILTINS.has(bare)) continue;
      // Relative paths are not allowed either (keeper.cjs must be a leaf).
      offenders.push(spec);
    }
    expect(offenders).toEqual([]);
  });
});
