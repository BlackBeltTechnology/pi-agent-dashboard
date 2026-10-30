/**
 * Child process for `bridge-tls-trust-store.test.ts`: a minimal REMOTE bridge.
 *
 * Runs the real `createRemoteUpgradePreparer` (ticket mint over `fetch`) and the
 * real `ConnectionManager` (`ws` dial) against `argv[2]` with `PI_DASHBOARD_TOKEN`
 * from the environment, so Node's own trust store (`NODE_EXTRA_CA_CERTS`, read at
 * process start — the reason this is a child) decides the outcome. Prints one JSON
 * line `{connected}` and exits.
 *
 * `PI_TEST_RESOLVE_HOST` names a host (the fixture leaf's SAN) that resolves to
 * 127.0.0.1, so a fixture certificate can be validated by name without DNS.
 *
 * See change: prove-vault-bridge-tls (task 6.4, test-plan #X4).
 */
import dns from "node:dns";
import { ConnectionManager } from "../../connection.js";
import { createRemoteUpgradePreparer } from "../../remote-upgrade-preparer.js";

const resolveHost = process.env.PI_TEST_RESOLVE_HOST;
if (resolveHost) {
  const original = dns.lookup;
  (dns as { lookup: unknown }).lookup = (
    hostname: string,
    a: unknown,
    b?: unknown,
  ) => {
    const cb = (typeof a === "function" ? a : b) as (...args: unknown[]) => void;
    const opts = (typeof a === "object" && a !== null ? a : {}) as { all?: boolean };
    if (hostname === resolveHost) {
      if (opts.all) cb(null, [{ address: "127.0.0.1", family: 4 }]);
      else cb(null, "127.0.0.1", 4);
      return undefined;
    }
    return (original as (...args: unknown[]) => unknown)(hostname, a, b);
  };
}

const endpoint = process.argv[2] as string;
const prepare = createRemoteUpgradePreparer({
  env: process.env,
  log: { log: (...a) => console.error(...a), error: (...a) => console.error(...a) },
  record: () => {},
  isPinned: () => true,
});
const cm = new ConnectionManager({ url: endpoint, prepareConnect: () => prepare(endpoint) });
cm.send({ type: "session_register", sessionId: "s1", cwd: "/tmp", source: "tui", pid: process.pid } as never);
cm.connect();

const deadline = Date.now() + 4000;
const timer = setInterval(() => {
  if (cm.isConnected || Date.now() > deadline) {
    clearInterval(timer);
    console.log(JSON.stringify({ connected: cm.isConnected }));
    // Give the buffered register frame a moment to flush before exiting.
    setTimeout(() => process.exit(0), 300);
  }
}, 50);
