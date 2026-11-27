import { useT } from '@tio/i18n';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PhotoSlider } from 'react-photo-view';

import { ImageViewerLoading, type PreviewImage } from './image-viewer';
import { Button, IconButton, useOverlayOpen, useReducedMotion } from './index';
import type { MediaResolver } from './media';

import 'react-photo-view/dist/react-photo-view.css';

type ImageResource =
  | { status: 'ready'; url: string; width: number; height: number }
  | { status: 'failed' };

export default function ImageSlider({
  stage,
  images,
  initialIndex,
  resolve,
}: {
  stage: HTMLDivElement;
  images: readonly PreviewImage[];
  initialIndex: number;
  resolve?: MediaResolver;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [resources, setResources] = useState<Record<number, ImageResource>>({});
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const open = useOverlayOpen();
  const reducedMotion = useReducedMotion();
  const t = useT();
  const source = images[index];
  const attempt = attempts[index] ?? 0;
  const resource = resources[index];
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      setStageSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  useEffect(() => {
    if (!open || !source || resource) return;
    let active = true;
    void (async () => {
      try {
        const url = resolve
          ? await resolve(source.ref)
          : /^https?:\/\//i.test(source.ref)
            ? source.ref
            : '';
        if (!url) throw new Error('Missing image');
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Missing image size');
        if (active) {
          setResources((previous) => ({
            ...previous,
            [index]: {
              status: 'ready',
              url,
              width: image.naturalWidth,
              height: image.naturalHeight,
            },
          }));
        }
      } catch {
        if (active) setResources((previous) => ({ ...previous, [index]: { status: 'failed' } }));
      }
    })();
    return () => {
      active = false;
    };
  }, [open, source, index, resolve, attempt, resource]);

  const retry = () => {
    setResources(({ [index]: _, ...previous }) => previous);
    setAttempts((previous) => ({ ...previous, [index]: attempt + 1 }));
  };
  const download = async () => {
    if (resource?.status !== 'ready' || saving) return;
    setSaving(true);
    setDownloadFailed(false);
    let downloadUrl: string | undefined;
    try {
      const response = await fetch(resource.url);
      if (!response.ok) throw new Error('Image download failed');
      const blob = await response.blob();
      downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const extension = /^image\/(\w+)/.exec(blob.type)?.[1];
      const name = source?.name || 'image';
      link.download = extension && !/\.[\w]+$/.test(name) ? `${name}.${extension}` : name;
      link.click();
    } catch {
      setDownloadFailed(true);
    } finally {
      if (downloadUrl) {
        const url = downloadUrl;
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setSaving(false);
    }
  };

  const error = (
    <div
      className="grid h-full content-center justify-items-center gap-3 px-4 text-center"
      role="alert"
    >
      <span>{t('imageViewer.loadFailed')}</span>
      <Button
        type="button"
        className="tio-image-control"
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          retry();
        }}
      >
        {t('common.retry')}
      </Button>
    </div>
  );
  return (
    <>
      <PhotoSlider
        visible={open}
        images={images.map((image, i) => {
          const item = resources[i];
          const key = `${i}:${attempts[i] ?? 0}:${item?.status ?? 'loading'}`;
          if (item?.status !== 'ready') {
            return {
              key,
              width: Math.min(360, stageSize.width || 360),
              height: 140,
              render: () =>
                item?.status === 'failed' && i === index ? error : <ImageViewerLoading />,
            };
          }
          const fit = Math.min(1, stageSize.width / item.width, stageSize.height / item.height);
          const width = Math.max(1, Math.floor(item.width * fit));
          const height = Math.max(1, Math.floor(item.height * fit));
          return {
            key: `${key}:${width}x${height}`,
            width,
            height,
            render: ({ attrs }) => (
              <img
                {...attrs}
                src={item.url}
                alt={image.name ?? ''}
                className="PhotoView__Photo"
                draggable={false}
                onError={() =>
                  setResources((previous) => ({ ...previous, [i]: { status: 'failed' } }))
                }
              />
            ),
          };
        })}
        index={index}
        onIndexChange={setIndex}
        // The surrounding dialog owns Escape, system Back and focus restoration.
        onClose={() => {}}
        speed={reducedMotion ? () => 0 : undefined}
        loop={false}
        maskClosable={false}
        photoClosable={false}
        pullClosable={false}
        bannerVisible={false}
        portalContainer={stage}
        overlayRender={({ onIndexChange, scale, onScale }) =>
          open && (
            <ImageViewerControls
              stage={stage}
              index={index}
              count={images.length}
              scale={scale}
              onScale={onScale}
              onIndexChange={onIndexChange}
            />
          )
        }
      />
      {downloadFailed && (
        <p
          role="alert"
          className="absolute right-4 bottom-[calc(max(1rem,var(--tio-safe-bottom))+3.5rem)] z-10 rounded-lg bg-black/85 px-3 py-2 text-sm"
        >
          {t('imageViewer.downloadFailed')}
        </p>
      )}
      <IconButton
        label={t('database.download')}
        className="tio-image-control absolute right-[max(1rem,var(--tio-safe-right))] bottom-[max(1rem,var(--tio-safe-bottom))] z-10 size-11"
        disabled={resource?.status !== 'ready' || saving}
        onClick={() => void download()}
      >
        <Download size={20} />
      </IconButton>
    </>
  );
}

function ImageViewerControls({
  stage,
  index,
  count,
  scale,
  onScale,
  onIndexChange,
}: {
  stage: HTMLDivElement;
  index: number;
  count: number;
  scale: number;
  onScale: (scale: number) => void;
  onIndexChange: (index: number) => void;
}) {
  const t = useT();
  const gesture = useRef({
    time: -Infinity,
    axis: 'vertical',
    shifted: false,
    distance: 0,
    moved: false,
    pinchStartScale: undefined as number | undefined,
  });
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      const current = gesture.current;
      const pinch = event.ctrlKey || event.metaKey;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const { deltaX, deltaY } = event;
      if (!deltaX && !deltaY) return;
      if (!pinch) {
        if (event.timeStamp - current.time > 160 || event.shiftKey !== current.shifted) {
          current.axis =
            event.shiftKey || Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
          current.shifted = event.shiftKey;
          current.distance = 0;
          current.moved = false;
        }
        current.time = event.timeStamp;
      }
      if (pinch || current.axis === 'vertical') {
        if (current.pinchStartScale !== undefined) {
          event.stopPropagation();
        } else if (
          !(event.target instanceof Element && event.target.closest('.PhotoView__Photo'))
        ) {
          onScale(scale - (deltaY * unit) / 200);
        }
        return;
      }
      event.stopPropagation();
      if (count < 2 || current.moved) return;
      current.distance += (event.shiftKey && !deltaX ? deltaY : deltaX) * unit;
      if (Math.abs(current.distance) < 48) return;
      current.moved = true;
      const next = index + Math.sign(current.distance);
      if (next >= 0 && next < count) onIndexChange(next);
    };

    // WebKit may deliver a native gesture instead of Ctrl+wheel for trackpad pinch.
    const startPinch = () => {
      gesture.current.pinchStartScale = scale;
    };
    const changePinch = (event: Event) => {
      const factor = (event as Event & { scale?: number }).scale;
      const start = gesture.current.pinchStartScale;
      if (start !== undefined && factor !== undefined && factor > 0) onScale(start * factor);
    };
    const endPinch = () => {
      gesture.current.pinchStartScale = undefined;
    };
    const options = { capture: true, passive: false };
    stage.addEventListener('wheel', wheel, options);
    stage.addEventListener('gesturestart', startPinch, options);
    stage.addEventListener('gesturechange', changePinch, options);
    stage.addEventListener('gestureend', endPinch, options);
    return () => {
      stage.removeEventListener('wheel', wheel, true);
      stage.removeEventListener('gesturestart', startPinch, true);
      stage.removeEventListener('gesturechange', changePinch, true);
      stage.removeEventListener('gestureend', endPinch, true);
    };
  }, [stage, index, count, scale, onIndexChange, onScale]);

  if (count < 2) return null;
  return (
    <div className="tio-image-control absolute bottom-[max(1rem,var(--tio-safe-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 p-0.5">
      <IconButton
        label={t('imageViewer.previous')}
        className="size-10 rounded-full text-white hover:bg-white/15 hover:text-white disabled:opacity-30"
        disabled={index === 0}
        onClick={() => onIndexChange(index - 1)}
      >
        <ChevronLeft size={20} />
      </IconButton>
      <output
        className="min-w-11 text-center text-sm tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        {index + 1} / {count}
      </output>
      <IconButton
        label={t('imageViewer.next')}
        className="size-10 rounded-full text-white hover:bg-white/15 hover:text-white disabled:opacity-30"
        disabled={index === count - 1}
        onClick={() => onIndexChange(index + 1)}
      >
        <ChevronRight size={20} />
      </IconButton>
    </div>
  );
}
