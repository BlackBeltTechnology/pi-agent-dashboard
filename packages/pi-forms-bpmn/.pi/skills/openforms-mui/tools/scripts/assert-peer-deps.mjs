// Guards the D14 singleton contract: the React/MUI/Emotion packages must be
// declared as BOTH peerDependencies and devDependencies, and must NEVER appear
// as plain runtime `dependencies` — otherwise a consuming project loads a second
// React instance and hooks fail with an invalid hook call.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const SINGLETONS = [
  "react",
  "react-dom",
  "@mui/material",
  "@mui/x-date-pickers",
  "@emotion/react",
  "@emotion/styled",
];

const errors = [];
for (const name of SINGLETONS) {
  if (pkg.dependencies?.[name]) {
    errors.push(`${name} is a plain dependency — it must be peer + dev only`);
  }
  if (!pkg.peerDependencies?.[name]) {
    errors.push(`${name} is missing from peerDependencies`);
  }
  if (!pkg.devDependencies?.[name]) {
    errors.push(`${name} is missing from devDependencies`);
  }
}

if (errors.length > 0) {
  console.error("peer-dependency contract violated:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("peer-dependency contract satisfied for:", SINGLETONS.join(", "));
