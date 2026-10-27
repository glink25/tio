import { useLayoutEffect, useState, type CSSProperties } from 'react';

/** Keep input dialogs inside the visual viewport when the soft keyboard opens or pans it. */
export function useMobileDialogPosition(centered: boolean): CSSProperties | undefined {
  const measure = (): CSSProperties | undefined => {
    if (!centered || typeof window === 'undefined' || !matchMedia('(max-width: 767px)').matches)
      return undefined;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    return {
      top: (viewport?.offsetTop ?? 0) + height / 2,
      left: (viewport?.offsetLeft ?? 0) + width / 2,
      right: 'auto',
      bottom: 'auto',
      width: Math.max(0, width - 32),
      maxHeight: Math.max(0, height - 32),
      transform: 'translate(-50%, -50%)',
    };
  };
  const [style, setStyle] = useState(measure);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setStyle(measure());
    update();
    if (!centered) return;
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
    // Only the placement flag changes the measurement policy.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [centered]);
  return style;
}
