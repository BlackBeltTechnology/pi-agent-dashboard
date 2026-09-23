import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLoginPlaneConfig } from "../lib/config.mjs";

const KC = "https://kc.example.com/realms/app";

test("unconfigured ⇒ not offered (no built-in Keycloak default)", () => {
  const r = resolveLoginPlaneConfig({}, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["issuer", "clientId"]);
});

test("issuer without clientId (or vice versa) ⇒ not offered", () => {
  assert.deepEqual(resolveLoginPlaneConfig({ issuer: KC }, {}).missing, ["clientId"]);
  assert.deepEqual(resolveLoginPlaneConfig({ clientId: "web" }, {}).missing, ["issuer"]);
});

test("plugin config activates it; browserIssuer defaults to issuer; trailing slash trimmed", () => {
  const r = resolveLoginPlaneConfig({ issuer: `${KC}/`, clientId: "web" }, {});
  assert.deepEqual(r, { ok: true, issuer: KC, browserIssuer: KC, clientId: "web" });
});

test("env overrides are still honoured (docker / e2e harnesses)", () => {
  const r = resolveLoginPlaneConfig({}, { PI_LOGIN_ISSUER: KC, PI_LOGIN_CLIENT_ID: "web", PI_LOGIN_BROWSER_ISSUER: "http://host:1/realms/app" });
  assert.deepEqual(r, { ok: true, issuer: KC, browserIssuer: "http://host:1/realms/app", clientId: "web" });
});

test("plugin config wins over env", () => {
  const r = resolveLoginPlaneConfig({ issuer: KC, clientId: "cfg" }, { PI_LOGIN_ISSUER: "http://other/realms/x", PI_LOGIN_CLIENT_ID: "env" });
  assert.equal(r.issuer, KC);
  assert.equal(r.clientId, "cfg");
});

test("a non-http(s) or malformed issuer is treated as not configured", () => {
  assert.deepEqual(resolveLoginPlaneConfig({ issuer: "not a url", clientId: "web" }, {}).missing, ["issuer"]);
  assert.deepEqual(resolveLoginPlaneConfig({ issuer: "file:///etc/x", clientId: "web" }, {}).missing, ["issuer"]);
  assert.deepEqual(resolveLoginPlaneConfig({ issuer: "   ", clientId: " " }, {}).missing, ["issuer", "clientId"]);
});
