import { useLayoutEffect, useRef } from 'react';

import { motion } from './motion';

const activationDistance = 8;
const velocityWindow = 100;

const surfaces = [
  '.tio-modal-layer[data-state="open"]:not([data-covered]) > :is(.tio-dialog, .tio-drawer)',
  ':is(.tio-menu, .tio-popover)[data-state="open"]',
  ':is([data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"])[data-state="open"]',
].join(', ');

export function isTopPanel(panel?: HTMLElement) {
  const visible = [...document.querySelectorAll<HTMLElement>(surfaces)].filter(
    (element) => !element.closest('[aria-hidden="true"], [hidden], [inert]'),
  );
  return visible.at(-1) === panel;
}

export function inSwipeEdge(host: 'ios' | 'android', x: number) {
  return host === 'android' ? x >= 24 && x <= 56 : x <= 48;
}

interface PanelSwipe {
  enabled: boolean;
  direction: -1 | 1;
  opening?: boolean;
  canStart: (x: number, target: Element, panel: HTMLElement) => boolean;
  isActive: (panel: HTMLElement) => boolean;
  canCommit?: () => boolean;
  onPreview?: (visible: boolean) => void;
  commit: () => void;
}

/** Drive the panel and scrim together without rendering on each touch sample. */
export function usePanelSwipe(layer: HTMLDivElement | null, options: PanelSwipe) {
  const latest = useRef(options);
  latest.current = options;
  const { enabled } = options;
  useLayoutEffect(() => {
    if (!enabled || !layer) return;
    const panel = layer.querySelector<HTMLElement>('[data-tio-swipe-panel]');
    const scrim = layer.querySelector<HTMLElement>(':scope > .tio-overlay');
    if (!panel || !scrim) return;
    let gesture:
      | {
          id: number;
          x: number;
          y: number;
          time: number;
          width: number;
          locked: boolean;
          samples: { time: number; distance: number }[];
        }
      | undefined;
    let settling: { complete: boolean; width: number; animations: Animation[] } | undefined;
    let committed = false;

    const show = (distance: number, width: number) => {
      const { opening, direction } = latest.current;
      const visible = opening ? distance : width - distance;
      layer.style.setProperty(
        '--tio-swipe-offset',
        `${opening ? visible - width : direction * distance}px`,
      );
      layer.style.setProperty('--tio-swipe-opacity', String(visible / width));
    };
    const stopSettling = () => {
      const previous = settling;
      settling = undefined;
      previous?.animations.forEach((animation) => animation.cancel());
    };
    const clear = () => {
      stopSettling();
      if (layer.dataset.swipe === undefined) return;
      layer.removeAttribute('data-swipe');
      layer.style.removeProperty('--tio-swipe-offset');
      layer.style.removeProperty('--tio-swipe-opacity');
      latest.current.onPreview?.(false);
    };
    if (layer.dataset.swipe === 'finished') clear();

    const settle = (complete: boolean, distance: number, velocity: number, width: number) => {
      const fromTransform = getComputedStyle(panel).transform;
      const fromOpacity = getComputedStyle(scrim).opacity;
      stopSettling();
      const target = complete ? width : 0;
      const remaining = Math.abs(target - distance);
      const animation = motion.panel.open;
      const duration = complete
        ? Math.min(
            animation,
            Math.max(
              140,
              (remaining / width) * animation,
              remaining / Math.max(1, Math.abs(velocity)),
            ),
          )
        : Math.max(200, (1 - distance / width) * animation);
      const finish = () => {
        // The target styles are already in place when the animation releases them.
        stopSettling();
        if (!complete || !latest.current.isActive(panel)) {
          clear();
          return;
        }
        committed = true;
        layer.setAttribute('data-swipe', 'finished');
        latest.current.commit();
      };
      show(target, width);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || remaining < 1) {
        finish();
        return;
      }
      layer.setAttribute('data-swipe', 'settling');
      const timing: KeyframeAnimationOptions = {
        duration,
        easing: complete ? 'ease-out' : 'ease',
        fill: 'forwards',
      };
      const pending = {
        complete,
        width,
        animations: [
          panel.animate(
            [{ transform: fromTransform }, { transform: getComputedStyle(panel).transform }],
            timing,
          ),
          scrim.animate(
            [{ opacity: fromOpacity }, { opacity: getComputedStyle(scrim).opacity }],
            timing,
          ),
        ],
      };
      settling = pending;
      void Promise.all(pending.animations.map((animation) => animation.finished)).then(
        () => {
          if (settling === pending) finish();
        },
        () => {
          if (settling === pending) clear();
        },
      );
    };
    const cancel = () => {
      const active = gesture;
      gesture = undefined;
      if (!latest.current.isActive(panel)) {
        if (!committed) clear();
      } else if (active?.locked) {
        settle(false, active.samples.at(-1)?.distance ?? 0, 0, active.width);
      } else if (settling?.complete) {
        const visible = Number(getComputedStyle(scrim).opacity);
        const progress = latest.current.opening ? visible : 1 - visible;
        settle(false, progress * settling.width, 0, settling.width);
      }
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      if (settling !== undefined || committed || !latest.current.isActive(panel)) return;
      const touch = event.touches[0];
      if (
        !(event.target instanceof Element) ||
        !latest.current.canStart(touch.clientX, event.target, panel)
      )
        return;
      const selection = panel.ownerDocument.getSelection();
      const selecting =
        selection?.type === 'Range' &&
        (latest.current.opening ||
          panel.contains(selection.anchorNode) ||
          panel.contains(selection.focusNode));
      if (
        event.target.closest(
          'input, textarea, select, .cm-editor, [contenteditable]:not(.bn-editor), [draggable="true"], [data-tio-no-swipe]',
        ) ||
        selecting
      )
        return;
      const width = panel.offsetWidth;
      if (!width) return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        width,
        locked: false,
        samples: [{ time: event.timeStamp, distance: 0 }],
      };
    };
    const move = (event: TouchEvent) => {
      const active = gesture;
      if (!active) return;
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        touch.identifier !== active.id ||
        !event.cancelable ||
        !latest.current.isActive(panel)
      ) {
        cancel();
        return;
      }
      const x = (touch.clientX - active.x) * latest.current.direction;
      if (!active.locked) {
        const y = Math.abs(touch.clientY - active.y);
        if (Math.max(Math.abs(x), y) < activationDistance) return;
        if (x <= y || event.timeStamp - active.time > 250) {
          gesture = undefined;
          return;
        }
        active.locked = true;
        layer.setAttribute('data-swipe', 'dragging');
        latest.current.onPreview?.(true);
      }
      event.preventDefault();
      const distance = Math.min(active.width, Math.max(0, x));
      while (active.samples.length > 1 && active.samples[0].time < event.timeStamp - velocityWindow)
        active.samples.shift();
      active.samples.push({ time: event.timeStamp, distance });
      show(distance, active.width);
    };
    const end = (event: TouchEvent) => {
      const active = gesture;
      if (!active) return;
      const touch = Array.from(event.changedTouches).find(
        (touch) => touch.identifier === active.id,
      );
      if (!touch) return;
      gesture = undefined;
      if (!active.locked) return;
      event.preventDefault();
      if (!latest.current.isActive(panel)) {
        clear();
        return;
      }
      const last = active.samples.at(-1)!;
      // WebView can coalesce the last moves before reporting the release position.
      const distance = Math.min(
        active.width,
        Math.max(0, (touch.clientX - active.x) * latest.current.direction),
      );
      const first = active.samples.find(
        (sample) => sample.time >= event.timeStamp - velocityWindow,
      );
      const velocity = first
        ? (distance - first.distance) / Math.max(1, event.timeStamp - first.time)
        : 0;
      const complete =
        (distance >= active.width / 2 || (distance >= 24 && velocity >= 0.5)) &&
        (latest.current.canCommit?.() ?? true);
      settle(complete, last.distance, velocity, active.width);
    };
    document.addEventListener('touchstart', start, { capture: true, passive: true });
    document.addEventListener('touchmove', move, { capture: true, passive: false });
    document.addEventListener('touchend', end, { capture: true, passive: false });
    document.addEventListener('touchcancel', cancel, true);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      document.removeEventListener('touchstart', start, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel);
      if (!committed) clear();
    };
  }, [enabled, layer]);
}

/** Native panels own their visual state from entry through gesture or programmatic exit. */
export function useNativePanelMotion(
  layer: HTMLDivElement | null,
  side: 'left' | 'right' | undefined,
  open: boolean,
  skipEnter: boolean,
  onReady?: () => void,
) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  useLayoutEffect(() => {
    if (!layer) return;
    const panel = layer.querySelector<HTMLElement>(':scope > [data-tio-swipe-panel]');
    const scrim = layer.querySelector<HTMLElement>(':scope > .tio-overlay');
    if (!panel || !scrim) return;
    if (!side) {
      layer.removeAttribute('data-motion-ready');
      panel.style.removeProperty('transform');
      scrim.style.removeProperty('opacity');
      return;
    }
    if (open && layer.dataset.swipe === 'finished') {
      layer.removeAttribute('data-swipe');
      layer.style.removeProperty('--tio-swipe-offset');
      layer.style.removeProperty('--tio-swipe-opacity');
    }
    if (!open && layer.dataset.swipe === 'finished') return;
    const edge = side === 'left' ? 'translateX(-100%)' : 'translateX(100%)';
    const rest = 'translateX(0)';
    const ready = layer.hasAttribute('data-motion-ready');
    const fromTransform = ready ? getComputedStyle(panel).transform : edge;
    const fromOpacity = ready ? getComputedStyle(scrim).opacity : '0';
    const toTransform = open ? rest : edge;
    const toOpacity = open ? '1' : '0';
    layer.setAttribute('data-motion-ready', '');
    panel.style.transform = open ? '' : toTransform;
    scrim.style.opacity = open ? '' : toOpacity;
    if (open) readyCallback.current?.();
    if ((open && skipEnter) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timing = { duration: motion.panel.open, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
    const animations = [
      panel.animate([{ transform: fromTransform }, { transform: toTransform }], timing),
      scrim.animate([{ opacity: fromOpacity }, { opacity: toOpacity }], timing),
    ];
    return () => {
      // Keep the visible frame when an opening or closing is interrupted.
      if (animations.some((animation) => animation.playState === 'running')) {
        panel.style.transform = getComputedStyle(panel).transform;
        scrim.style.opacity = getComputedStyle(scrim).opacity;
      }
      animations.forEach((animation) => animation.cancel());
    };
  }, [layer, open, side, skipEnter]);
}
