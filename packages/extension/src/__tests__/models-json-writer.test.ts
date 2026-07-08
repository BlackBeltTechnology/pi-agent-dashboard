/**
 * Tests for models-json-writer.ts — persists dashboard-managed custom
 * providers into pi-native `~/.pi/agent/models.json` (merge-not-clobber),
 * so pi's ModelRegistry.create loads them for every consumer.
 *
 * Spec: openspec/changes/add-agent-role-model-tools/
 *       specs/custom-provider-model-registry/spec.md
 *
 * HOME is overridden by the vitest globalSetup to a tmp dir.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  loadModelsJson,
  mergeManagedProviders,
  persistManagedProviders,
  type ManagedProviderEntry,
} from "../models-json-writer.js";

const MODELS = () => join(homedir(), ".pi", "agent", "models.json");

function reset() {
  if (existsSync(MODELS())) rmSync(MODELS());
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
}

const bence: ManagedProviderEntry = {
  baseUrl: "http://192.168.10.203:20128/v1",
  api: "anthropic-messages",
  apiKey: "$BENCE_KEY",
  models: [
    { id: "claude-x", name: "claude-x", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  ],
};

beforeEach(reset);
afterEach(reset);

describe("mergeManagedProviders (pure)", () => {
  it("upserts a managed provider into an empty config", () => {
    const out = mergeManagedProviders({}, { "bence-proxy": bence }, ["bence-proxy"]);
    expect(out.providers["bence-proxy"].baseUrl).toBe(bence.baseUrl);
    expect(out.providers["bence-proxy"].models).toHaveLength(1);
    expect(out.providers["bence-proxy"].models[0].id).toBe("claude-x");
  });

  it("preserves hand-authored providers not in managedNames", () => {
    const current = { providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama3.1:8b" }] } } };
    const out = mergeManagedProviders(current, { "bence-proxy": bence }, ["bence-proxy"]);
    expect(out.providers.ollama).toEqual(current.providers.ollama);
    expect(out.providers["bence-proxy"]).toBeDefined();
  });

  it("removes a stale managed provider (in managedNames, absent from managed)", () => {
    const current = { providers: { "old-proxy": { baseUrl: "x", models: [] }, ollama: { baseUrl: "y", models: [] } } };
    const out = mergeManagedProviders(current, { "bence-proxy": bence }, ["bence-proxy", "old-proxy"]);
    expect(out.providers["old-proxy"]).toBeUndefined(); // stale managed removed
    expect(out.providers.ollama).toBeDefined(); // hand-authored kept
    expect(out.providers["bence-proxy"]).toBeDefined();
  });

  it("preserves non-providers top-level keys", () => {
    const current = { $schema: "x", providers: {} };
    const out = mergeManagedProviders(current, { "bence-proxy": bence }, ["bence-proxy"]);
    expect(out.$schema).toBe("x");
  });
});

describe("persistManagedProviders (IO, atomic)", () => {
  it("writes and reloads managed providers", () => {
    persistManagedProviders({ "bence-proxy": bence }, ["bence-proxy"]);
    const back = loadModelsJson() as any;
    expect(back.providers["bence-proxy"].models[0].id).toBe("claude-x");
  });

  it("does not clobber a hand-authored models.json", () => {
    writeFileSync(MODELS(), JSON.stringify({ providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [{ id: "llama3.1:8b" }] } } }, null, 2));
    persistManagedProviders({ "bence-proxy": bence }, ["bence-proxy"]);
    const back = loadModelsJson() as any;
    expect(back.providers.ollama.models[0].id).toBe("llama3.1:8b");
    expect(back.providers["bence-proxy"]).toBeDefined();
  });

  it("loadModelsJson tolerates missing file and malformed JSON", () => {
    expect(loadModelsJson()).toEqual({});
    writeFileSync(MODELS(), "{ not json");
    expect(loadModelsJson()).toEqual({});
  });
});
