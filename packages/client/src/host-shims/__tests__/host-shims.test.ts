/**
 * Host shim export parity (task 6.3). The shims are what the import map resolves a runtime plugin's
 * bare `react` / `react-dom` / runtime imports to; a missing name = a plugin `import {x}` SyntaxError
 * in the browser, a different object = two React copies.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_IMPORT_MAP_IMPORTS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-import-map.js";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import { describe, expect, it } from "vitest";
import * as publicSurface from "../../../../dashboard-plugin-runtime/src/public.js";
import * as reactShim from "../react.js";
import * as reactDomShim from "../react-dom.js";
import * as reactDomClientShim from "../react-dom-client.js";
import * as reactJsxShim from "../react-jsx-runtime.js";
import * as runtimeShim from "../runtime.js";

const named = (ns: object) => Object.keys(ns).filter((k) => k !== "default" && k !== "__esModule" && k !== "module.exports").sort();

function expectParity(shim: Record<string, unknown>, pkg: Record<string, unknown>) {
  expect(named(shim)).toEqual(named(pkg));
  for (const k of named(pkg)) expect(shim[k], k).toBe(pkg[k]);
}

describe("host shims", () => {
  it("react re-exports every named export of react (same instances)", () => {
    expectParity(reactShim, React);
    expect(typeof reactShim.default).toBe("object");
  });
  it("react/jsx-runtime", () => expectParity(reactJsxShim, JsxRuntime));
  it("react-dom", () => expectParity(reactDomShim, ReactDom));
  it("react-dom/client", () => expectParity(reactDomClientShim, ReactDomClient));

  it("runtime shim names == public.ts names (and never the ./host surface)", () => {
    expect(named(runtimeShim)).toEqual(named(publicSurface));
    expect(named(runtimeShim)).toContain("bumpSlotClaimsVersion");
    expect(named(runtimeShim)).not.toContain("getSlotClaimsVersion");
    expect(named(runtimeShim)).not.toContain("setSender");
  });

  it("every import-map target has a shim source (and no shim is unmapped)", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const names = Object.values(HOST_IMPORT_MAP_IMPORTS).map((u) => u.replace(/^\/host\//, "").replace(/\.js$/, ""));
    for (const n of names) expect(existsSync(path.join(dir, "..", `${n}.ts`)), n).toBe(true);
    expect(names.sort()).toEqual(["react", "react-dom", "react-dom-client", "react-jsx-runtime", "runtime"]);
  });
});
