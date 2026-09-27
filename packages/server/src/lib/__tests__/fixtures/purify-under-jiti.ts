// Fixture: run by purify-jiti.test.ts under the server's real loader
// (`node --import jiti-register`). Prints the sanitized SVG or `ERR <msg>`.
import { loadPurify } from "../../purify.js";

try {
  const purify = await loadPurify();
  console.log(purify.sanitize("<svg><script>alert(1)</script><g/></svg>", { USE_PROFILES: { svg: true } }));
} catch (e) {
  console.log(`ERR ${e instanceof Error ? e.message : String(e)}`);
}
