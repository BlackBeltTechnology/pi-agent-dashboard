// Repo-facing re-export of the kb engine fingerprint lib (design D1,
// change fix-kb-eval-measurement-integrity). The ONE implementation lives in
// packages/kb/bin/lib/engine-fingerprint.mjs so the shipped `bin` also carries
// it (the tarball ships bin/, not the repo's scripts/) — the bin shim and the
// CI freshness gate must share bytes, not reimplement them.
export {
  FINGERPRINT_FILE,
  FINGERPRINT_MALFORMED,
  computeDistHash,
  computeSrcHash,
  computeTsconfigHash,
  fingerprintPackage,
  readCommittedFingerprint,
  tsconfigChain,
  writeFingerprint,
} from "../../packages/kb/bin/lib/engine-fingerprint.mjs";
