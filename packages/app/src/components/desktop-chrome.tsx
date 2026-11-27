import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { platform } from '../platform';
import type { DesktopChromeState } from '../services/desktop-chrome';

const DesktopChromeContext = createContext<{
  state?: DesktopChromeState;
  sidebarListeners?: Set<() => void>;
}>({});

export function DesktopChromeProvider({ children }: { children: ReactNode }) {
  const chrome = platform().desktopChrome;
  const [state, setState] = useState<DesktopChromeState>();
  const [sidebarListeners] = useState(() => new Set<() => void>());
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
        if (action === 'sidebar') sidebarListeners.forEach((toggle) => toggle());
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
  }, [chrome, sidebarListeners]);

  const overlay = state?.layout === 'overlay' && state.height > 0;
  useLayoutEffect(() => {
    if (!overlay) return;
    const { style } = document.documentElement;
    const metrics = {
      '--tio-window-chrome-top': state.height,
      '--tio-window-chrome-left': state.left,
      '--tio-window-chrome-right': state.right,
    };
    for (const [name, value] of Object.entries(metrics)) style.setProperty(name, `${value}px`);
    return () => {
      for (const name of Object.keys(metrics)) style.removeProperty(name);
    };
  }, [overlay, state]);

  return (
    <DesktopChromeContext.Provider value={{ state, sidebarListeners }}>
      {overlay &&
        createPortal(<DesktopDragRegion className="tio-modal-drag-region" modal />, document.body)}
      {children}
    </DesktopChromeContext.Provider>
  );
}

export function useDesktopChrome(title: string, sidebar?: { label: string; toggle(): void }) {
  const chrome = platform().desktopChrome;
  const { state, sidebarListeners } = useContext(DesktopChromeContext);
  const toggleSidebar = useEffectEvent(() => sidebar?.toggle());
  const sidebarLabel = sidebar?.label;
  useEffect(() => {
    if (!sidebarLabel || !sidebarListeners) return;
    const toggle = () => toggleSidebar();
    sidebarListeners.add(toggle);
    return () => {
      sidebarListeners.delete(toggle);
    };
  }, [sidebarLabel, sidebarListeners]);

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

export function DesktopDragRegion({ className, modal }: { className?: string; modal?: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-tauri-drag-region
      className={className}
      onPointerDown={modal ? (event) => event.stopPropagation() : undefined}
    />
  );
}
