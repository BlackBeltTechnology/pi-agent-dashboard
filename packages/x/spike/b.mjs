// THROWAWAY spike fixture: a nested spike/ directory must STAY analyzed once the repo-root spike/** is ignored.
import http from "http";
http.createServer((req, res) => {
  const password = req.body.password;
  console.log("pw " + password);
  res.end();
});
