import type { DocumentCover, DocumentIcon } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, Popover } from '@tio/ui';
import {
  Component,
  cloneElement,
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

const EmojiPicker = lazy(() => import('./emoji-picker'));
const ImagePanel = lazy(() => import('./image-panel'));
const Gallery = lazy(() => import('./gallery'));
type Tab = 'emoji' | 'icons' | 'upload' | 'link' | 'presets' | 'unsplash';
class PanelBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert" className="p-4 text-muted">
        {this.props.message}
      </p>
    ) : (
      this.props.children
    );
  }
}
export interface MediaPickerProps {
  kind: 'icon' | 'cover';
  present: boolean;
  label: string;
  trigger: ReactNode;
  upload: (file: File) => Promise<string>;
  onSelect: (value: DocumentIcon | DocumentCover | null) => void;
}
export function MediaPicker({ kind, present, label, trigger, upload, onSelect }: MediaPickerProps) {
  const t = useT();
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(kind === 'icon' ? 'emoji' : 'presets');
  const tabs: Tab[] =
    kind === 'icon'
      ? ['emoji', 'icons', 'upload', 'link']
      : ['presets', 'upload', 'link', 'unsplash'];
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const change = (value: DocumentIcon | DocumentCover | null) => {
    const scope = anchor.current?.closest('.tio-editor');
    onSelect(value);
    setOpen(false);
    requestAnimationFrame(() => {
      if (anchor.current?.isConnected) anchor.current.focus();
      else scope?.querySelector<HTMLTextAreaElement>('.tio-page-title')?.focus();
    });
  };
  const selectUrl = (url: string) =>
    change(kind === 'icon' ? { type: 'image', url } : { type: 'image', url, positionY: 0.5 });
  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTab(kind === 'icon' ? 'emoji' : 'presets');
      }}
      trigger={cloneElement(trigger as ReactElement<{ ref: typeof anchor }>, { ref: anchor })}
      className="flex w-[480px] flex-col overflow-hidden p-0"
    >
      {open && (
        <>
          <div className="flex shrink-0 items-center border-b border-line px-3">
            <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 overflow-x-auto">
              {tabs.map((value, index) => (
                <button
                  key={value}
                  ref={(el) => {
                    if (el) tabRefs.current.set(value, el);
                    else tabRefs.current.delete(value);
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-${value}`}
                  aria-controls={`${id}-panel`}
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  className={`shrink-0 border-b-2 px-1.5 py-3 text-xs sm:px-2 sm:text-sm ${tab === value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                            tabs.length;
                    setTab(tabs[next]);
                    tabRefs.current.get(tabs[next])?.focus();
                  }}
                >
                  {t(`media.tab.${value}`)}
                </button>
              ))}
            </div>
            {present && (
              <Button
                className="ml-2 shrink-0 px-1 py-2 text-xs text-muted"
                onClick={() => change(kind === 'icon' ? '' : null)}
              >
                {t(kind === 'icon' ? 'document.removeIcon' : 'document.removeCover')}
              </Button>
            )}
          </div>
          <div
            role="tabpanel"
            id={`${id}-panel`}
            aria-labelledby={`${id}-${tab}`}
            className="max-h-[min(460px,65dvh)] min-h-0 overflow-y-auto"
          >
            <PanelBoundary key={tab} message={t('document.iconLoadFailed')}>
              <Suspense
                fallback={<output className="block p-4 text-muted">{t('status.loading')}</output>}
              >
                {tab === 'emoji' ? (
                  <EmojiPicker onSelect={change} />
                ) : tab === 'upload' || tab === 'link' ? (
                  <ImagePanel key={tab} mode={tab} upload={upload} onSelect={selectUrl} />
                ) : (
                  <Gallery mode={tab} onSelect={change} />
                )}
              </Suspense>
            </PanelBoundary>
          </div>
        </>
      )}
    </Popover>
  );
}
