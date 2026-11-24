// Test-only preload (`NODE_OPTIONS=--import <this file>`, `LP_CLOCK_FILE=<path>`): shifts the clock of the tier-5 PID STORE only.
//
// The pid store decides supersede (a mint in the last 20 min of a 12 h lifetime issues a NEW pid) and expiry from `Date.now()`,
// which a browser spec cannot wait out. This preload re-reads an offset (ms) from LP_CLOCK_FILE every 50 ms and adds it to
// `Date.now()` ONLY for callers whose stack passes through `preview-path-store` — auth, sessions, sockets and every other
// module keep the real clock. Offset 0 (or no file) is a pass-through. See change: serve-live-previews-on-capability-origin (F15).
import fs from "node:fs";

const file = process.env.LP_CLOCK_FILE;
if (file) {
  const realNow = Date.now.bind(Date);
  let offset = 0;
  const refresh = () => {
    try {
      offset = Number(fs.readFileSync(file, "utf8").trim()) || 0;
    } catch {
      offset = 0;
    }
  };
  refresh();
  setInterval(refresh, 50).unref();
  Date.now = function now() {
    if (offset === 0) return realNow();
    return (new Error().stack ?? "").includes("preview-path-store") ? realNow() + offset : realNow();
  };
}
