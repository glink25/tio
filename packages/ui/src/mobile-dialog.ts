import { useLayoutEffect, useState, type CSSProperties } from 'react';

/** CSS owns the full-screen shell. Visual viewport measurements only clear focused inputs. */
export function useMobileDialogPosition(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const active = document.activeElement;
      const editing =
        active instanceof HTMLElement &&
        active.matches(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]',
        );
      const obscured = viewport
        ? Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)
        : 0;
      const keyboard = media.matches && editing && obscured > 0 && viewport?.scale === 1;
      setStyle(
        keyboard
          ? ({
              '--tio-keyboard-bottom': `${obscured}px`,
              '--tio-visible-top': `${viewport.offsetTop}px`,
              '--tio-visible-height': `${viewport.height}px`,
            } as CSSProperties)
          : undefined,
      );
      cancelAnimationFrame(frame);
      if (keyboard)
        frame = requestAnimationFrame(() =>
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
        );
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, []);
  return style;
}
