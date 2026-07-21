// ---------------------------------------------------------------------------
// ImagePreviewStrip — error banner + image thumbnail grid with remove-X.
//
// Shared between CommandInput and the OpenSpec Explore dialog. Accepts
// the state produced by useImagePaste; emits a remove callback per
// thumbnail. Clicking a thumbnail opens the ImageLightbox overlay just
// like CommandInput did before the extraction.
//
// The component renders NOTHING when there are no images and no error —
// safe to place unconditionally in any container.
// ---------------------------------------------------------------------------

import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ImageLightbox } from "./ImageLightbox.js";

interface Props {
	images: ImageContent[];
	error: string | null;
	onRemove: (index: number) => void;
}

export function ImagePreviewStrip({ images, error, onRemove }: Props) {
	const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);

	if (images.length === 0 && !error) return null;

	return (
		<>
			{error && (
				<div className="mb-2 text-xs text-red-400 bg-red-900/20 px-3 py-1 rounded">
					{error}
				</div>
			)}
			{images.length > 0 && (
				<div className="mb-2 flex gap-2 flex-wrap">
					{images.map((img, i) => (
						<div key={i} className="relative group">
							<img
								src={`data:${img.mimeType};base64,${img.data}`}
								alt={`Attachment ${i + 1}`}
								className="h-16 w-16 object-cover rounded border border-[var(--border-secondary)] cursor-pointer"
								onClick={() =>
									setLightboxSrc({
										src: `data:${img.mimeType};base64,${img.data}`,
										alt: `Attachment ${i + 1}`,
									})
								}
							/>
							<button
								onClick={() => onRemove(i)}
								className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
								title={i18nT("common.removeImage", undefined, "Remove image")}
							>
								<Icon path={mdiClose} size={0.45} />
							</button>
						</div>
					))}
				</div>
			)}
			{lightboxSrc && (
				<ImageLightbox
					src={lightboxSrc.src}
					alt={lightboxSrc.alt}
					onClose={() => setLightboxSrc(null)}
				/>
			)}
		</>
	);
}
