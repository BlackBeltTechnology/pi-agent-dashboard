import React, { useEffect, useRef } from "react";
import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { useZoomPan } from "../../hooks/useZoomPan.js";

const BACKDROP_ID = "lightbox-backdrop";

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape dismissal routes through the shared escape-stack so an Escape closes
  // only the lightbox, not a dialog/overlay stacked beneath it.
  // See change: fix-stacked-escape-closes-layers.
  useEscapeDismiss(true, onClose);

  // Backdrop click still dismisses (document listener for portal compat).
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.dataset?.testid === BACKDROP_ID) {
        onCloseRef.current();
      }
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  const { state, handlers } = useZoomPan({ minScale: 0.25, maxScale: 10 });

  return (
    <DialogPortal>
      <div
        data-testid="lightbox-backdrop"
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 cursor-zoom-out"
      >
        <div
          className="relative max-w-[90vw] max-h-[90vh] cursor-grab active:cursor-grabbing"
          onWheel={handlers.onWheel}
          onPointerDown={handlers.onPointerDown}
          onPointerMove={handlers.onPointerMove}
          onPointerUp={handlers.onPointerUp}
          onTouchMove={handlers.onTouchMove as unknown as React.TouchEventHandler}
          onTouchEnd={handlers.onTouchEnd as unknown as React.TouchEventHandler}
          onDoubleClick={handlers.onDoubleClick}
          style={{ touchAction: "none" }}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain select-none"
            style={{
              transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
              transformOrigin: "0 0",
            }}
            draggable={false}
          />
        </div>
      </div>
    </DialogPortal>
  );
}
