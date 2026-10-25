/**
 * The committed TLS fixture CA and leaf (server package) as test data for bridge-side TLS tests.
 * Read-only. See change: prove-vault-bridge-tls (task 6.4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of the committed fixture PEMs. */
const FIXTURES_DIR = fileURLToPath(new URL("../../../../server/src/tls/__tests__/fixtures/", import.meta.url));

/** Leaf key + certificate for `host` (a fixture name such as `a.test`). */
export function fixtureLeaf(host: string): { key: Buffer; cert: Buffer } {
  return {
    key: fs.readFileSync(path.join(FIXTURES_DIR, `leaf-${host}-key.pem`)),
    cert: fs.readFileSync(path.join(FIXTURES_DIR, `leaf-${host}.pem`)),
  };
}
