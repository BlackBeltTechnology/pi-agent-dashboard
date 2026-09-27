/**
 * The diagnosing / refused state of a multi-request viewer (video, audio, PDF),
 * rendered from `useMediaDenial`. See change: surface-denial-remedy-in-previews (D2).
 */
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DenialNotice } from "./DenialNotice.js";
import type { useMediaDenial } from "./use-media-denial.js";

export function MediaDenialNotice({
  media,
  url,
  path,
}: {
  media: ReturnType<typeof useMediaDenial>;
  url: string;
  path: string;
}) {
  const { phase } = media;
  if (phase.kind !== "failed") {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-sm text-[var(--text-tertiary)]">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    );
  }
  return (
    <DenialNotice
      result={phase.failure}
      url={url}
      path={path}
      onAsk={media.ask}
      asked={phase.asked}
      multiRequest
      admittedCheckOnly={phase.admittedCheckOnly}
    />
  );
}
