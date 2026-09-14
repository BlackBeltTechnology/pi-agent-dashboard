// E2 pin: valid-shape prefixes that NEST under reserved core namespaces.
export default async (ctx) => {
  const errors = [];
  for (const [scope, prefix] of [
    ["nested-terminal", "/ws/terminal/x/"],
    ["nested-bridge", "/ws/bridge/"],
  ]) {
    try {
      ctx.registerWsRoute(scope, { pathPrefix: prefix, admitOrigins: [], handleUpgrade: () => {} });
      errors.push(`${prefix}: did NOT throw`);
    } catch (e) {
      errors.push(`${prefix}: ${e.message}`);
    }
  }
  globalThis.__nestedReservedErrors = errors;
  throw new Error("nested-reserved fixture always fails (registrations must throw)");
};
