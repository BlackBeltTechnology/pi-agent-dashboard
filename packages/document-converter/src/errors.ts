/**
 * Typed errors for the facade. Every engine failure surfaces as one of these so
 * callers never parse stderr strings.
 */

/** Stable error codes the engine + facade emit. */
export type DocConverterErrorCode =
  | "DOCKER_UNAVAILABLE" // docker binary missing or daemon down
  | "ENGINE_NONZERO" // engine process exited non-zero
  | "BAD_RESPONSE" // engine stdout was not the expected JSON envelope
  | "INPUT_NOT_FOUND" // input file missing
  | "OCR_LANG_UNSUPPORTED" // canonical lang not supported by chosen engine
  | "OCR_ENGINE_UNKNOWN" // unknown OCR engine
  | "UNSUPPORTED_FORMAT" // extension not routable to a command
  | "INGEST_FAILED"
  | "PRODUCE_FAILED"
  | "FILL_FAILED"
  | "PROFILE_FAILED"
  | "INTERNAL";

export interface DocConverterErrorInit {
  code: DocConverterErrorCode;
  message: string;
  /** Engine stderr, when the failure came from the engine process. */
  stderr?: string;
  /** Engine process exit code, when applicable. */
  exitCode?: number;
}

/** The single error type the facade rejects with. */
export class DocConverterError extends Error {
  readonly code: DocConverterErrorCode;
  readonly stderr?: string;
  readonly exitCode?: number;

  constructor(init: DocConverterErrorInit) {
    super(init.message);
    this.name = "DocConverterError";
    this.code = init.code;
    this.stderr = init.stderr;
    this.exitCode = init.exitCode;
  }
}
