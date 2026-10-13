/** Absolute paths shared by the subprocess-driving tests. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The CLI entry run through tsx in a subprocess. */
export const CLI = fileURLToPath(new URL("../../bin/photocraft.ts", import.meta.url));
/** Absolute tsx loader: subprocess tests may change cwd and must still resolve it. */
export const TSX = createRequire(import.meta.url).resolve("tsx");
