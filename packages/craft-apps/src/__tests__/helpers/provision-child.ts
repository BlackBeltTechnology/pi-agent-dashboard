// Child process for the concurrent-install test (X7): provisions once, prints the report.
import { provision } from "../../provision.js";

const [app, apiBase, home] = process.argv.slice(2);
provision(app, {
  env: { CRAFT_HOME: home },
  platform: "linux",
  arch: "x64",
  glibcVersion: () => "2.99",
  apiBase,
  log: () => {},
}).then(
  (r) => process.stdout.write(`${JSON.stringify(r)}\n`),
  (e) => {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  },
);
