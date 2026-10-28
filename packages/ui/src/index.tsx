import type { DocumentIcon } from '@tio/core';

import { builtinIcons, useMediaUrl, type MediaResolver } from './media';
export { builtinIcons, coverPresets, useMediaUrl, type MediaResolver } from './media';
export { EditHistoryContext, useDraftHistory, type EditHistory } from './edit-history';
import * as Dialog from '@radix-ui/react-dialog';
import { useT } from '@tio/i18n';
import { clsx, type ClassValue } from 'clsx';
import { X, Languages, FileText, Database } from 'lucide-react';
import {
  createContext,
  useContext,
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
export { MentionContext, MentionLabel, MentionPicker } from './mentions';
export const PortalContext = createContext<HTMLElement | undefined>(undefined);
import { twMerge } from 'tailwind-merge';

import { useMobileDialogPosition } from './mobile-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'ghost' | 'primary' | 'outline' }
>(function Button({ className, variant = 'ghost', ...props }, ref) {
  return (
    <button
      ref={ref}
      data-variant={variant}
      className={cn(
        'tio-button inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary'
          ? 'bg-accent text-on-accent hover:bg-accent-strong'
          : variant === 'outline'
            ? 'border border-line bg-panel hover:bg-surface'
            : 'text-secondary hover:bg-surface-hover',
        className,
      )}
      {...props}
    />
  );
});
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }
>(function IconButton({ label, children, ...props }, ref) {
  return (
    <Button ref={ref} aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
});
export function Modal({
  title,
  description,
  close,
  children,
  wide = false,
  sheet = false,
  mobilePlacement = 'sheet',
}: {
  wide?: boolean;
  sheet?: boolean;
  mobilePlacement?: 'sheet' | 'center';
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
}) {
  const t = useT();
  useOverlayBack(close);
  const position = useMobileDialogPosition(mobilePlacement === 'center');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal container={useContext(PortalContext)}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content
          style={position}
          aria-describedby={undefined}
          className={cn(
            'tio-dialog fixed z-50 overflow-y-auto border border-line bg-panel p-5 text-ink shadow-xl outline-none',
            sheet
              ? 'inset-y-0 left-0 w-[min(320px,90vw)]'
              : wide
                ? 'inset-0 md:inset-auto md:top-[6dvh] md:left-1/2 md:max-h-[88dvh] md:w-[min(1100px,92vw)] md:-translate-x-1/2 md:rounded-xl'
                : 'bottom-0 left-0 max-h-[90dvh] w-full rounded-t-xl md:top-[12dvh] md:bottom-auto md:left-1/2 md:max-h-[76dvh] md:w-[min(550px,calc(100%-24px))] md:-translate-x-1/2 md:rounded-xl',
            mobilePlacement === 'center' && 'max-md:rounded-xl',
          )}
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('common.close')} className="p-1">
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="mb-5 text-sm text-muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Drawer({
  title,
  close,
  children,
  actions,
  closeLabel,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
}) {
  const t = useT();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  useOverlayBack(close);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal container={useContext(PortalContext)}>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content
          ref={setPortalContainer}
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-panel shadow-xl"
        >
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-6 py-3">
            <Dialog.Title className="text-sm text-secondary">{title}</Dialog.Title>
            <div className="flex items-center gap-2">
              {actions}
              <Dialog.Close asChild>
                <IconButton label={closeLabel ?? t('database.closeRecord')} className="p-1">
                  <X size={20} />
                </IconButton>
              </Dialog.Close>
            </div>
          </header>
          <PortalContext.Provider value={portalContainer ?? undefined}>
            {children}
          </PortalContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function LanguageSwitcher({
  value,
  onChange,
}: {
  value: 'en' | 'zh';
  onChange: (value: 'en' | 'zh') => void;
}) {
  const t = useT();

  return (
    <Select
      value={value}
      onValueChange={(language) => {
        if (language === 'zh' || language === 'en') onChange(language);
      }}
    >
      <SelectTrigger
        aria-label={t('common.language')}
        title={t('common.language')}
        className="w-36 gap-1.5 px-2 text-xs"
      >
        <Languages size={15} aria-hidden className="shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="zh">简体中文</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}
export function ObjectIcon({
  type,
  icon,
  size = 18,
  resolve,
}: {
  type: string;
  icon?: DocumentIcon;
  resolve?: MediaResolver;
  size?: number;
}) {
  const url = useMediaUrl(
    typeof icon === 'object' && icon.type === 'image' ? icon.url : undefined,
    resolve,
  );
  const [failed, setFailed] = useState('');
  const style = { width: size, height: size, flexShrink: 0 };
  if (typeof icon === 'object') {
    if (icon.type === 'builtin') {
      const Icon = builtinIcons[icon.name];
      return <Icon size={size} style={style} strokeWidth={1.7} aria-hidden />;
    }
    if (url && failed !== url)
      return (
        <img
          src={url}
          alt=""
          style={style}
          className="rounded-sm object-cover"
          onError={() => setFailed(url)}
        />
      );
  }
  if (typeof icon === 'string' && icon)
    return (
      <span
        className="inline-flex items-center justify-center leading-none"
        style={{ ...style, fontSize: size }}
        aria-hidden
      >
        {icon}
      </span>
    );
  const Component = type === 'database' ? Database : FileText;
  return <Component size={size} style={style} strokeWidth={1.7} aria-hidden />;
}
export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface p-4 text-sm text-muted">
      {children}
    </div>
  );
}

export { useTheme, ThemeSwitcher, ThemeContext } from './theme';

export {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Popover,
  Tooltip,
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  Notifications,
  NotificationContext,
  useNotify,
  toast,
  useMobile,
} from './overlays';
// One stack per document: Back removes only surfaces above the destination entry.
const overlays: { key: string; close: () => void }[] = [];
function dismissOverlayHistory() {
  const index = overlays.findIndex((entry) => entry.key === history.state?.tioOverlay);
  for (const entry of overlays.slice(index + 1).reverse()) entry.close();
}
export function useOverlayBack(close: () => void) {
  useEffect(() => {
    const key = crypto.randomUUID();
    if (!overlays.length) window.addEventListener('popstate', dismissOverlayHistory);
    overlays.push({ key, close });
    history.pushState({ ...history.state, tioOverlay: key }, '');
    return () => {
      const index = overlays.findIndex((entry) => entry.key === key);
      if (index >= 0) overlays.splice(index, 1);
      if (!overlays.length) window.removeEventListener('popstate', dismissOverlayHistory);
      if (history.state?.tioOverlay === key) history.back();
    };
    // Overlay lifetime is independent of callback identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export { ReferencePicker, type ReferenceOption } from './reference-picker';
