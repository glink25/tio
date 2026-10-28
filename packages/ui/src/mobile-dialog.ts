import { useLayoutEffect, useState, type CSSProperties } from 'react';

/** Geometry only: CSS owns placement, sizing and safe-area padding. */
export function useMobileDialogPosition(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const viewport = window.visualViewport;
    const update = () => {
      const layoutHeight = document.documentElement.clientHeight;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      setStyle(
        media.matches
          ? ({
              '--tio-layout-height': `${layoutHeight}px`,
              '--tio-viewport-top': `${viewportTop}px`,
              '--tio-viewport-left': `${viewport?.offsetLeft ?? 0}px`,
              '--tio-viewport-width': `${viewport?.width ?? window.innerWidth}px`,
              '--tio-viewport-height': `${viewportHeight}px`,
              '--tio-viewport-obscured': `${Math.max(0, layoutHeight - viewportTop - viewportHeight)}px`,
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
