import { useT } from '@tio/i18n';
import { LoaderCircle, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { IconButton, Modal } from './index';
import type { MediaResolver } from './media';

const ImageSlider = lazy(() => import('./image-slider'));

export type PreviewImage = { ref: string; name?: string };

export function ImageViewer({
  images,
  initialIndex = 0,
  resolve,
  close,
  restoreFocus,
}: {
  images: readonly PreviewImage[];
  initialIndex?: number;
  resolve?: MediaResolver;
  close: () => void;
  restoreFocus: () => void;
}) {
  const t = useT();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!stage) return;
    // PhotoSlider handles zoom. Prevent the browser from zooming or scrolling the page as well.
    const preventDefault = (event: Event) => event.preventDefault();
    const options = { capture: true, passive: false };
    const events = ['wheel', 'gesturestart', 'gesturechange'];
    for (const event of events) stage.addEventListener(event, preventDefault, options);
    return () => {
      for (const event of events) stage.removeEventListener(event, preventDefault, options);
    };
  }, [stage]);

  return (
    <Modal
      title={t('imageViewer.title')}
      layout="image"
      hideHeader
      dismissOnOutside={false}
      className="tio-image-viewer"
      close={close}
      restoreFocus={restoreFocus}
    >
      <div ref={setStage} className="relative h-full w-full touch-none overscroll-none">
        <IconButton
          label={t('common.close')}
          className="tio-image-control absolute top-[max(1rem,var(--tio-safe-top))] right-[max(1rem,var(--tio-safe-right))] z-20 size-11"
          onClick={close}
        >
          <X size={22} />
        </IconButton>
        {stage && (
          <Suspense fallback={<ImageViewerLoading />}>
            <ImageSlider
              stage={stage}
              images={images}
              initialIndex={initialIndex}
              resolve={resolve}
            />
          </Suspense>
        )}
      </div>
    </Modal>
  );
}

export function ImageViewerLoading() {
  const t = useT();
  return (
    <output
      className="pointer-events-none grid h-full place-items-center"
      aria-label={t('imageViewer.loading')}
    >
      <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
    </output>
  );
}
