// E2: all 8 reserved scope/prefix cases. Each registration must THROW; the
// entry records the outcomes on globalThis and then fails (as the loader
// would mark any plugin whose registration was rejected).
const CASES = [
  ["browser", "/ws/e2-r1/"],
  ["terminal", "/ws/e2-r2/"],
  ["live", "/ws/e2-r3/"],
  ["bridge", "/ws/e2-r4/"],
  ["e2-r5", "/ws"],
  ["e2-r6", "/ws/terminal/"],
  ["e2-r7", "/live/"],
  ["e2-r8", "/ws/bridge"],
];
export default async (ctx) => {
  const results = [];
  for (const [scope, prefix] of CASES) {
    try {
      ctx.registerWsRoute(scope, { pathPrefix: prefix, admitOrigins: [], handleUpgrade: () => {} });
      results.push({ scope, prefix, threw: false });
    } catch {
      results.push({ scope, prefix, threw: true });
    }
  }
  globalThis.__e2Results = results;
  const notThrown = results.filter((r) => !r.threw);
  if (notThrown.length > 0) {
    throw new Error("reserved cases that did NOT throw: " + JSON.stringify(notThrown));
  }
  throw new Error("all 8 reserved cases threw (expected)");
};
