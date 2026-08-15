#!/usr/bin/env -S npx tsx
/**
 * openforms-mui CLI.
 *
 *   openforms diagnose <schema.json|url>   # print findings; exit 1 on any error
 *   openforms preview  <schema.json|url> [--reference] [--port N]
 *
 * `diagnose` starts no server. `preview` starts the Vite three-panel harness.
 * Both accept a local path or a URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSchema } from "../src/schema/normalize.js";
import { diagnose } from "../src/schema/diagnose.js";
import type { Diagnostic, FormSchemaJSON } from "../src/schema/types.js";

async function loadSchema(source: string): Promise<FormSchemaJSON> {
  let text: string;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`failed to fetch schema: HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = readFileSync(resolve(source), "utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("schema is not valid JSON");
  }
  return normalizeSchema(parsed as Partial<FormSchemaJSON>).schema;
}

function printFindings(findings: Diagnostic[]): void {
  if (findings.length === 0) {
    process.stdout.write("No findings.\n");
    return;
  }
  for (const f of findings) {
    process.stdout.write(`[${f.severity.toUpperCase()}] ${f.code}  ${f.path}\n    ${f.message}\n`);
  }
}

async function runDiagnose(source: string): Promise<number> {
  const schema = await loadSchema(source);
  const { diagnostics: normDiags } = normalizeSchema(schema);
  const findings = [...normDiags, ...diagnose(schema)];
  printFindings(findings);
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

async function runPreview(source: string, reference: boolean, port: number): Promise<void> {
  // Validate the schema up front so a bad file fails fast without a stack trace.
  await loadSchema(source);
  const absSchema = /^https?:\/\//.test(source) ? source : resolve(source);
  const { createServer } = await import("vite");
  const { harnessPlugin } = await import("./vite-plugin.js");
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname),
    plugins: [(await import("@vitejs/plugin-react")).default(), harnessPlugin(absSchema, reference)],
    server: { port },
  });
  await server.listen();
  const info = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
  process.stdout.write(`OpenForms preview running at ${info}\n`);
  if (reference) process.stdout.write("Reference mode ON (upstream 1.0.7 loaded in an isolated frame).\n");
  // Do NOT resolve/exit: the dev server must stay alive until interrupted.
  await new Promise<void>(() => {});
}

async function main(): Promise<void> {
  const [cmd, source, ...rest] = process.argv.slice(2);
  if (!cmd || (cmd !== "diagnose" && cmd !== "preview")) {
    process.stderr.write("usage: openforms <diagnose|preview> <schema.json|url> [--reference] [--port N]\n");
    process.exit(2);
  }
  if (!source) {
    process.stderr.write(`error: ${cmd} requires a schema path or URL\n`);
    process.exit(2);
  }
  try {
    if (cmd === "diagnose") {
      process.exit(await runDiagnose(source));
    } else {
      const reference = rest.includes("--reference");
      const portIdx = rest.indexOf("--port");
      const port = portIdx >= 0 ? Number(rest[portIdx + 1]) : 5173;
      await runPreview(source, reference, port); // blocks until interrupted
    }
  } catch (e) {
    // Clear, stack-free error for bad input (harness spec).
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

void main();
