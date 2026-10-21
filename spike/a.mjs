// THROWAWAY spike fixture: a ROOT spike/ fixture: reported on control, absent once spike/** is ignored.
import { exec } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
http.createServer((req, res) => {
  res.end(fs.readFileSync(req.url));
  exec(`ls ${req.url}`);
});
