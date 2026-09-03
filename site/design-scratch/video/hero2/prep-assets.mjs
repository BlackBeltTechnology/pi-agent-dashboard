#!/usr/bin/env node
/**
 * Build the 1920x1200 scene plates from design-scratch/shots/out.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: never `-resize WxH!`.
 *
 * The shots pipeline lets a scenario return a Playwright Locator, and when it
 * does, the PNG is clipped to that ELEMENT rather than the viewport. So the
 * corpus is not uniformly 2880x1800 — `openspec` comes out 1880x1800
 * (ratio 1.04) because it clips to the `openspec-board` testid. A forced
 * `-resize 1920x1200!` silently stretched that plate ~53% horizontally.
 *
 * Cover-fit instead: scale until the frame is filled, then crop. `-gravity
 * north` because every dashboard surface puts its content at the top — the
 * board columns, the transcript head, the toolbar — and its dead space at the
 * bottom. Cropping from the north keeps the part worth showing.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const SHOTS = ["sessions", "chat", "diff-commit", "openspec", "editor"];
const W = 1920, H = 1200;
const SRC = new URL("../../shots/out/", import.meta.url).pathname;
const OUT = new URL("./assets/", import.meta.url).pathname;

mkdirSync(OUT, { recursive: true });

const id = (f) => execFileSync("magick",
  ["identify", "-format", "%w %h", f], { encoding: "utf8" }).split(" ").map(Number);

for (const name of SHOTS) {
  for (const [theme, dir] of [["dark", "desktop"], ["light", "desktop-light"]]) {
    const src = `${SRC}${dir}/${name}.png`;
    const dst = `${OUT}${name}-${theme}.png`;
    const [w, h] = id(src);
    const ratio = w / h;

    execFileSync("magick", [
      src,
      "-resize", `${W}x${H}^`,        // ^ = cover (fill), NOT ! (stretch)
      "-gravity", "north",
      "-extent", `${W}x${H}`,
      "-strip", "-quality", "92",
      dst,
    ]);

    const cropped = Math.abs(ratio - W / H) > 0.01;
    console.log(
      `${name.padEnd(12)} ${theme.padEnd(5)} ${String(w + "x" + h).padEnd(10)} ` +
      `ratio=${ratio.toFixed(3)}${cropped ? "  → cover-cropped (element clip, not viewport)" : ""}`);
  }
}
