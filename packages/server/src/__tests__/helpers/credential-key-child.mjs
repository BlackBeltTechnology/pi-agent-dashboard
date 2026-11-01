// Child process for X6 (concurrent key creation). Runs the REAL credential-key module under tsx against a
// FAKE file-backed keychain worker (no real keychain). Env: CHILD_ID, CHILD_FILE_ID, CHILD_OTHER_FILE_ID,
// CHILD_WORKER_ENTRY, CHILD_BARRIER (file whose existence releases the start), CHILD_ROOT (src dir of the server).
// Prints one JSON line: { kid, created, decodedOther, logs }.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CHILD_ROOT;
const mod = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const key = await mod("auth/credential-key.ts");
const lj = await mod("auth/locked-json-file.ts");

const home = process.env.HOME;
const file = (id) =>
  id === "vault" ? path.join(home, ".pi", "dashboard", "vault.json") : path.join(home, ".pi", "agent", "plugin-credentials.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(20); } return false; };

const logs = [];
await waitFor(() => fs.existsSync(process.env.CHILD_BARRIER), 20_000);
await key.initCredentialKey({ env: {}, workerEntry: process.env.CHILD_WORKER_ENTRY, log: (l) => logs.push(l) });

// A credential write: resolve the key, then write through the singleton codec under the store lock.
await key.ensureCredentialKeyForWrite();
const id = process.env.CHILD_FILE_ID;
const codec = key.getCredentialCodec(id);
await lj.withLockedJsonFile(file(id), () => lj.writeJsonAtomic(file(id), { writer: process.env.CHILD_ID }, undefined, codec), { codec });

// Decode the OTHER process's file with this process's key.
const otherId = process.env.CHILD_OTHER_FILE_ID;
await waitFor(() => fs.existsSync(file(otherId)), 20_000);
const other = lj.readJsonChecked(file(otherId), "child", key.getCredentialCodec(otherId));
const st = key.getCredentialKeyState();
process.stdout.write(`${JSON.stringify({ kid: st.kid, created: st.created, decodedOther: other.data?.writer ?? null, locked: other.locked ?? null, logs })}\n`);
