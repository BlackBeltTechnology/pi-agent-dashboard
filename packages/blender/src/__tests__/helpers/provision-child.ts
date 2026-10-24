// Child process for the concurrent-commit test (E13): provisions once from a local tarball, prints the result.
// A barrier directory makes both children finish "downloading" before either commits, so exactly one loses the rename.
import * as fs from "node:fs";
import * as path from "node:path";
import type { PinSpec } from "../../pin.js";
import { provision } from "../../provision.js";

const [tgzPath, pinJson, root, barrier, peers] = process.argv.slice(2);
const pin = JSON.parse(pinJson) as PinSpec;

async function waitForPeers(): Promise<void> {
  fs.writeFileSync(path.join(barrier, `ready-${process.pid}`), "");
  const deadline = Date.now() + 20_000;
  while (fs.readdirSync(barrier).length < Number(peers) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
}

provision({
  env: { BLENDER_WASM_HOME: root },
  pin,
  log: () => {},
  fetch: async () => {
    await waitForPeers();
    return new Response(fs.readFileSync(tgzPath));
  },
}).then(
  (r) => process.stdout.write(`${JSON.stringify(r)}\n`),
  (e) => {
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  },
);
