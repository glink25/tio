import type { DocumentIcon } from '@tio/core';

import { builtinIcons, useMediaUrl, type MediaResolver } from './media';
export { builtinIcons, coverPresets, useMediaUrl, type MediaResolver } from './media';
export { EditHistoryContext, useDraftHistory, type EditHistory } from './edit-history';
import * as Dialog from '@radix-ui/react-dialog';
import { useT } from '@tio/i18n';
import { clsx, type ClassValue } from 'clsx';
import { X, FileText, Database } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  forwardRef,
  useEffect,
  useState,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
export { MentionContext, MentionLabel, MentionPicker } from './mentions';
export const PortalContext = createContext<HTMLElement | undefined>(undefined);
import { twMerge } from 'tailwind-merge';

import { useOverlayOpen } from './motion';
export { OverlayPresence, useOverlayOpen, useReducedMotion, motion } from './motion';

import { useMobileDialogPosition } from './mobile-dialog';
import { registerOverlay } from './overlay-history';
import { useOverlayInteraction } from './overlay-interaction';
import { ChoiceSelect } from './select';
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
  layout = 'default',
  trackHistory = true,
  header,
  footer,
  hideHeader = false,
  restoreFocus,
}: {
  restoreFocus?: () => void;
  layout?: 'default' | 'workspace';
  hideHeader?: boolean;
  trackHistory?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  sheet?: boolean;
  mobilePlacement?: 'sheet' | 'center';
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const open = useOverlayOpen();
  useOverlayBack(close, trackHistory && open);
  const position = useMobileDialogPosition();
  const interaction = useOverlayInteraction(open, close, restoreFocus);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal container={useContext(PortalContext)}>
        <Dialog.Overlay className="tio-overlay fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content
          {...interaction}
          onEscapeKeyDown={(event) => {
            // Floating controls are portalled; their Escape must not dismiss the containing dialog.
            const floating = [
              ...document.querySelectorAll(
                '.tio-popover[data-state="open"], .tio-select[data-state="open"], .tio-menu[data-state="open"]',
              ),
            ];
            if (floating.some((element) => !element.closest('[aria-hidden="true"]')))
              event.preventDefault();
          }}
          {...{ inert: !open ? '' : undefined }}
          data-motion={sheet ? 'left' : mobilePlacement}
          data-placement={sheet ? 'sidebar' : layout === 'workspace' ? 'full' : mobilePlacement}
          data-wide={wide || undefined}
          data-layout={layout}
          data-headerless={hideHeader || undefined}
          style={position}
          aria-describedby={undefined}
          className="tio-dialog fixed z-50 flex min-h-0 min-w-0 flex-col overflow-hidden border border-line bg-panel text-ink shadow-xl outline-none"
        >
          {hideHeader ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <div
              className={cn(
                'tio-dialog-header flex shrink-0 items-center justify-between gap-4',
                layout === 'workspace'
                  ? 'shrink-0 items-start border-b border-line px-4 py-3 md:items-center md:px-6'
                  : 'px-4 py-3 md:px-5 md:py-4',
              )}
            >
              {header ? (
                <>
                  <Dialog.Title className="sr-only">{title}</Dialog.Title>
                  {header}
                </>
              ) : (
                <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              )}
              <Dialog.Close asChild>
                <IconButton label={t('common.close')} className="p-1">
                  <X size={20} />
                </IconButton>
              </Dialog.Close>
            </div>
          )}
          {description && (
            <Dialog.Description className="shrink-0 px-4 pb-3 text-sm text-muted md:px-5">
              {description}
            </Dialog.Description>
          )}
          <div
            className={cn(
              'tio-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain',
              layout === 'default' && !hideHeader && 'px-4 pb-4 md:px-5 md:pb-5',
            )}
          >
            {children}
          </div>
          {footer && (
            <div className="tio-dialog-footer shrink-0 border-t border-line bg-panel px-4 py-3 md:px-6">
              {footer}
            </div>
          )}
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
  const position = useMobileDialogPosition();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const open = useOverlayOpen();
  useOverlayBack(close, open);
  const { ref: attachInteraction, ...interaction } = useOverlayInteraction(open, close);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      setPortalContainer(node);
      attachInteraction(node);
    },
    [attachInteraction],
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal container={useContext(PortalContext)}>
        <Dialog.Overlay className="tio-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content
          {...{ inert: !open ? '' : undefined }}
          style={position}
          {...interaction}
          ref={attach}
          aria-describedby={undefined}
          className="tio-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-hidden bg-panel shadow-xl"
        >
          <header className="tio-drawer-header z-10 flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 py-3 md:px-6">
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
            <div className="tio-drawer-body min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
              {children}
            </div>
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
    <ChoiceSelect
      label={t('common.language')}
      value={value}
      className="w-36"
      search={false}
      options={[
        { id: 'zh', text: '简体中文', label: '简体中文' },
        { id: 'en', text: 'English', label: 'English' },
      ]}
      onValueChange={(language) => {
        if (language === 'zh' || language === 'en') onChange(language);
      }}
    />
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
export { LoadingSkeleton, LoadingIndicator, SidebarSkeleton, readingLayout } from './skeleton';
export { EmptyStateIllustration } from './empty-state-illustration';

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
export function useOverlayBack(close: () => void, enabled = true) {
  const open = useOverlayOpen();
  enabled = enabled && open;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!enabled) return;
    return registerOverlay(() => closeRef.current());
  }, [enabled]);
}

export { ReferencePicker, ReferenceIcon, type ReferenceOption } from './reference-picker';

export {
  OptionsPanel,
  type OptionsPanelProps,
  type ChoiceOption,
  type ChoiceTab,
} from './options-panel';
export { ChoiceSelect, SelectInput } from './select';

export { usePagedOptions } from './use-paged-options';

export { SettingsGroup, SettingsRow, SettingsAction } from './settings';

export {
  InteractionBoundary,
  useInteractionExit,
  useInteractionOwner,
  interactionHasKind,
  registerInteraction,
  interactionScopeAt,
  interactionOwner,
  claimInteraction,
  withinInteraction,
} from './interaction';
