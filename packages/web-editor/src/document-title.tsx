import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react';

/** A single logical title that wraps and grows with its available width. */
export const DocumentTitle = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }
>(function DocumentTitle({ value, ...props }, forwardedRef) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!, []);
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [resize, value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(element);
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) resize();
    });
    document.fonts.addEventListener('loadingdone', resize);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', resize);
    };
  }, [resize]);
  return <textarea {...props} ref={ref} value={value} rows={1} wrap="soft" />;
});
