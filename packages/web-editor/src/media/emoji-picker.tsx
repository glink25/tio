import { useT, useTranslation } from '@tio/i18n';
import { LoadingIndicator } from '@tio/ui';
import { useTheme } from '@tio/ui';
import { useEffect, useRef, useState } from 'react';

export default function EmojiPicker({ onSelect }: { onSelect: (icon: string) => void }) {
  const t = useT();
  const { i18n } = useTranslation();
  const theme = useTheme();
  const locale = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const container = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    let disposed = false;
    let picker: HTMLElement | undefined;
    setStatus('loading');
    void Promise.all([
      import('emoji-mart'),
      import('@emoji-mart/data'),
      locale === 'zh'
        ? import('@emoji-mart/data/i18n/zh.json')
        : import('@emoji-mart/data/i18n/en.json'),
    ])
      .then(([{ Picker }, { default: data }, { default: translations }]) => {
        if (disposed) return;
        picker = new Picker({
          data,
          i18n: translations,
          locale,
          theme,
          autoFocus: true,
          dynamicWidth: true,
          previewPosition: 'none',
          skinTonePosition: 'search',
          onEmojiSelect: (emoji: { native: string }) => select.current(emoji.native),
        }) as unknown as HTMLElement;
        picker.style.width = '100%';
        picker.style.setProperty('--shadow', 'none');
        picker.style.setProperty('--rgb-accent', theme === 'dark' ? '222, 222, 221' : '37, 37, 37');
        container.current?.appendChild(picker);
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      picker?.remove();
    };
  }, [locale, theme]);
  return (
    <>
      {status !== 'ready' && (
        <p role={status === 'error' ? 'alert' : 'status'} className="p-3 text-sm text-muted">
          {status === 'error' ? t('document.iconLoadFailed') : <LoadingIndicator />}
        </p>
      )}
      <div ref={container} data-history="native" />
    </>
  );
}
