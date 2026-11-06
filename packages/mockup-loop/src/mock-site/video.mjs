#!/usr/bin/env node
// @ts-check
// mock-video bin — see headless.mjs. See change: add-mock-site-exact-env.
import { main } from "./headless.mjs";

const { code, out } = await main("video", process.argv.slice(2));
(code ? process.stderr : process.stdout).write(out + "\n");
process.exit(code);
