import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { run } from "../cli.js";
import { importPptx } from "../pptx/import.js";
import { basicDeck, buildPptx, rectShape } from "./helpers/pptx.js";

it("smoke", async () => {
  rmSync("/tmp/pp/sl", { recursive: true, force: true });
  const spec = basicDeck(3);
  spec.slides[1].shapes += rectShape(600000, 5500000, 3000000, 400000, "F66D03", "roundRect");
  writeFileSync("/tmp/pp/sl.pptx", buildPptx(spec));
  await importPptx({ input: "/tmp/pp/sl.pptx", out: "/tmp/pp/sl", env: { PATH: "" } });
  const deck = JSON.parse(readFileSync("/tmp/pp/sl/deck.json", "utf8"));
  deck.overrides.slides.s02 = { effects: [{ id: "slide-layer", params: { slide: "s02", mode: "free" } }] };
  writeFileSync("/tmp/pp/sl/deck.json", JSON.stringify(deck, null, 2));
  const log: string[] = [];
  const io = { stdout: (l: string) => log.push(l), stderr: (l: string) => log.push(l) };
  const b = await run(["build", "/tmp/pp/sl/deck.md", "-o", "/tmp/pp/sl/deck.html"], io);
  const s = await run(["snapshot", "/tmp/pp/sl/deck.html", "--slide", "2", "-o", "/tmp/pp/sl/s2.png"], io);
  writeFileSync("/tmp/pp/log3", JSON.stringify([b, s, log], null, 1));
}, 120000);
