import { useLayoutEffect, useState, type CSSProperties } from 'react';

/** Geometry only: CSS owns placement, sizing and safe-area padding. */
export function useMobileDialogPosition(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const viewport = window.visualViewport;
    const update = () => {
      setStyle(
        media.matches
          ? ({
              '--tio-viewport-top': `${viewport?.offsetTop ?? 0}px`,
              '--tio-viewport-left': `${viewport?.offsetLeft ?? 0}px`,
              '--tio-viewport-width': `${viewport?.width ?? window.innerWidth}px`,
              '--tio-viewport-height': `${viewport?.height ?? window.innerHeight}px`,
            } as CSSProperties)
          : undefined,
      );
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, []);
  return style;
}
