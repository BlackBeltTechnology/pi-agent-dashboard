import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { UPSTREAM_PROVENANCE } from "../src/provenance";

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

describe("toolchain (task 1.3, 1.7, 1.8)", () => {
  it("declares each singleton as peer + dev and never as a plain dependency", () => {
    for (const name of SINGLETONS) {
      expect(pkg.peerDependencies?.[name], `${name} peer`).toBeTruthy();
      expect(pkg.devDependencies?.[name], `${name} dev`).toBeTruthy();
      expect(pkg.dependencies?.[name], `${name} must not be a plain dependency`).toBeUndefined();
    }
  });

  it("pins the upstream provenance in a single constant", () => {
    expect(UPSTREAM_PROVENANCE.repository).toBe("henriquefps/open-forms");
    expect(UPSTREAM_PROVENANCE.version).toBe("1.0.7");
    expect(UPSTREAM_PROVENANCE.license).toBe("Apache-2.0");
  });
});
