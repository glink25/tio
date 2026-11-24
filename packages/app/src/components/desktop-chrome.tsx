import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react';

import { platform } from '../platform';
import type { DesktopChromeState } from '../services/desktop-chrome';

export function useDesktopChrome(title: string, sidebar?: { label: string; toggle(): void }) {
  const chrome = platform().desktopChrome;
  const [state, setState] = useState<DesktopChromeState>();
  const toggleSidebar = useEffectEvent(() => sidebar?.toggle());
  const sidebarLabel = sidebar?.label;

  useEffect(() => {
    if (!chrome) return;
    let active = true;
    let revision = 0;
    let animation = 0;
    let unsubscribe: (() => void) | undefined;
    const update = () => {
      const requested = ++revision;
      void chrome
        .state()
        .then((value) => {
          if (active && revision === requested) setState(value);
        })
        .catch(() => {});
    };
    update();
    void chrome
      .subscribe((action) => {
        if (action === 'sidebar') toggleSidebar();
        if (action === 'layout') {
          cancelAnimationFrame(animation);
          animation = requestAnimationFrame(update);
        }
      })
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      cancelAnimationFrame(animation);
      unsubscribe?.();
    };
  }, [chrome]);

  useEffect(() => {
    void chrome?.title(title, sidebarLabel).catch(() => {});
  }, [chrome, title, sidebarLabel]);

  return {
    layout: state?.layout,
    compact: state?.center !== undefined,
    style:
      state?.layout === 'overlay'
        ? ({
            '--tio-chrome-height': `${state.height}px`,
            ...(state.center !== undefined && {
              '--tio-chrome-row': `${state.height}px`,
              '--tio-caption-center': `${state.center}px`,
            }),
            '--tio-caption-left': `${state.left}px`,
            '--tio-caption-right': `${state.right}px`,
          } as CSSProperties)
        : undefined,
  };
}

export function DesktopDragRegion({ className }: { className?: string }) {
  return <div aria-hidden="true" data-tauri-drag-region className={className} />;
}
