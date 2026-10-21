/**
 * THROWAWAY spike probe (change codeql-model-pack-and-mirror, tasks 4.1-4.2). NEVER merged, never imported.
 * One guarded/unguarded pair per predicate the fixed cwd-guard model activates, plus the negative case.
 */
import { join } from "node:path";
import fs from "node:fs";
import {
  admissionAllows,
  admitCwd,
  isAllowedCwd,
  tokenAllows,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { isPortableProjectName } from "@blackbelt-technology/pi-dashboard-shared/project-name.js";
import Fastify from "fastify";

const app = Fastify();
const known = () => ["/a"];
type Q = { Querystring: { cwd?: string; name?: string } };

// 1. isAllowedCwd
app.get<Q>("/probe/isAllowedCwd/guarded", async (req) => {
  const c = req.query.cwd;
  if (isAllowedCwd(c, known)) return fs.readFileSync(`${c}/g1`);
  return null;
});
app.get<Q>("/probe/isAllowedCwd/unguarded", async (req) => fs.readFileSync(`${req.query.cwd}/u1`));

// 2. admissionAllows (after await admitCwd)
app.get<Q>("/probe/admissionAllows/guarded", async (req) => {
  const c = req.query.cwd as string;
  const admission = await admitCwd(c, known);
  if (admissionAllows(admission, c)) return fs.readFileSync(`${c}/g2`);
  return null;
});
app.get<Q>("/probe/admissionAllows/unguarded", async (req) => fs.readFileSync(`${req.query.cwd}/u2`));

// 3. tokenAllows
app.get<Q>("/probe/tokenAllows/guarded", async (req) => {
  const c = req.query.cwd as string;
  const admission = await admitCwd(c, known);
  const token = admission.kind === "admit" ? admission.token : undefined;
  if (tokenAllows(token, c)) return fs.readFileSync(`${c}/g3`);
  return null;
});
app.get<Q>("/probe/tokenAllows/unguarded", async (req) => fs.readFileSync(`${req.query.cwd}/u3`));

// 4. isPortableProjectName (the joined name)
app.get<Q>("/probe/isPortableProjectName/guarded", async (req) => {
  const name = req.query.name;
  if (isPortableProjectName(name)) return fs.readFileSync(join("/projects", name, "g4"));
  return null;
});
app.get<Q>("/probe/isPortableProjectName/unguarded", async (req) => fs.readFileSync(join("/projects", String(req.query.name), "u4")));

// 5. admitCwd as a barrier on its ARGUMENT: the raw cwd reaches admitCwd, whose body canonicalizes it.
app.get<Q>("/probe/admitCwd/argument", async (req) => {
  const admission = await admitCwd(req.query.cwd as string, known);
  return admission.kind;
});

// 6. NEGATIVE: the admitCwd result is never branched on; the later sink on `c` must stay reported.
app.get<Q>("/probe/admitCwd/unchecked", async (req) => {
  const c = req.query.cwd as string;
  await admitCwd(c, known);
  return fs.readFileSync(`${c}/neg`);
});

app.listen({ port: 1 });
