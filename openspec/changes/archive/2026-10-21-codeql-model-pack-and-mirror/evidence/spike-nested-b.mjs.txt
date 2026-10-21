// THROWAWAY spike fixture: a nested spike/ directory must STAY analyzed once the repo-root spike/** is ignored.
import { exec } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
http.createServer((req, res) => {
  res.end(fs.readFileSync(req.url));
  exec(`ls ${req.url}`);
});
