import { writeFileSync, appendFileSync } from "node:fs";
const ROOTS = ["/tmp/skill-spike/granted"];
const FILTER = process.env.SPIKE_FILTER === "1";
const log = (s: string) => appendFileSync("/tmp/skill-spike/log.txt", s + "\n");
export default function (pi: any) {
  pi.on("input", (e: any) => {
    log(`input source=${e.source} text=${JSON.stringify(e.text.slice(0, 80))}`);
    const m = /^\/skill:([a-z0-9-]+)/.exec(e.text);
    if (FILTER && m && m[1] !== "granted") { log(`input REFUSED ${m[1]}`); return { action: "handled" }; }
    return { action: "continue" };
  });
  pi.on("before_agent_start", (e: any) => {
    const names = e.systemPromptOptions.skills.map((s: any) => s.name);
    log(`bas skills before=${JSON.stringify(names)}`);
    if (FILTER) {
      const keep = e.systemPromptOptions.skills.filter((s: any) => ROOTS.some((r) => s.filePath.startsWith(r + "/")));
      e.systemPromptOptions.skills.splice(0, e.systemPromptOptions.skills.length, ...keep);
    }
  });
  pi.on("before_provider_request", (e: any) => {
    writeFileSync(`/tmp/skill-spike/payload-${process.env.SPIKE_TAG}.json`, JSON.stringify(e.payload));
    log("payload written; exiting before HTTP");
    process.exit(0);
  });
}
