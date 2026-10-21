// Deep React path: not an import-map specifier, so it would be bundled.
import { jsxDEV } from "react/jsx-dev-runtime";

export const Bad = () => jsxDEV("div", { children: "x" }, undefined, false, undefined, undefined);
